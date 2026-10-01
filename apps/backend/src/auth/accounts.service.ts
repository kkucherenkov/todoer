import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, normalizeEmail } from './auth.service.js';
import { passwordProblem } from './password-policy.js';
import { lockUserWrites } from '../sync/user-lock.js';
import { SessionService } from './session.service.js';

const INVITATION_TTL_MS = 7 * 86_400_000;
const RESET_TTL_MS = 15 * 60_000;
const INVALID_INVITATION = 'invalid invitation';
const REGISTRATION_CLOSED = 'registration is closed';
const INVALID_CODE = 'invalid code';

const newSecret = (): string => randomBytes(32).toString('base64url');
const digest = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

function requireStrong(password: string): void {
  const problem = passwordProblem(password);
  if (problem !== null) throw new BadRequestException(problem);
}

/**
 * One valid code at a time: earlier unspent codes of the user are spent.
 * Needs only Prisma, so the host script can call it without the rest.
 */
export async function issueResetCode(
  prisma: PrismaService,
  userId: string,
  now = new Date(),
): Promise<string> {
  const code = newSecret();
  await prisma.$transaction([
    prisma.resetCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.resetCode.create({
      data: {
        id: uuidv7(),
        userId,
        codeHash: digest(code),
        expiresAt: new Date(now.getTime() + RESET_TTL_MS),
        createdAt: now,
      },
    }),
  ]);
  return code;
}

/**
 * Who may have an account, and how one is recovered or removed (ADR 0014).
 * Invitation tokens and reset codes are stored only as SHA-256 hex: they are
 * 256 random bits, so a plain hash is enough and lookup by hash is the
 * comparison.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private async requireOwner(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.isOwner !== true) throw new ForbiddenException('owner only');
  }

  async register(
    email: string,
    password: string,
    invitation?: string,
    now = new Date(),
  ): Promise<{ userId: string; owner: boolean }> {
    requireStrong(password);
    // Refused before scrypt: an anonymous call on a closed instance must not
    // cost a hash. Checked again under the lock below.
    if (invitation === undefined && (await this.prisma.user.count()) > 0) {
      throw new ForbiddenException(REGISTRATION_CLOSED);
    }
    const address = normalizeEmail(email);
    const passwordHash = await this.auth.hashPassword(password);
    const id = uuidv7();
    // One lock for every registration and account deletion: the "is this the
    // first user" count and the insert must not interleave, or two parallel
    // calls on an empty instance would both become owner.
    const owner = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, 0)`;
      const first = (await tx.user.count()) === 0;
      if (!first) {
        if (invitation === undefined) {
          throw new ForbiddenException(REGISTRATION_CLOSED);
        }
        const { count } = await tx.invitation.updateMany({
          where: {
            tokenHash: digest(invitation),
            usedAt: null,
            expiresAt: { gt: now },
            OR: [{ email: null }, { email: address }],
          },
          data: { usedAt: now },
        });
        if (count !== 1) throw new ForbiddenException(INVALID_INVITATION);
      }
      await tx.user.create({
        data: { id, email: address, passwordHash, isOwner: first },
      });
      return first;
    });
    return { userId: id, owner };
  }

  async invite(
    ownerId: string,
    email?: string,
    now = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.requireOwner(ownerId);
    const token = newSecret();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    await this.prisma.invitation.create({
      data: {
        id: uuidv7(),
        tokenHash: digest(token),
        // Only ever the authenticated owner, never request input.
        createdBy: ownerId,
        email: email === undefined ? null : normalizeEmail(email),
        expiresAt,
        createdAt: now,
      },
    });
    return { token, expiresAt };
  }

  async setPasswordFor(
    ownerId: string,
    targetId: string,
    password: string,
  ): Promise<void> {
    await this.requireOwner(ownerId);
    if (targetId === ownerId) {
      throw new ForbiddenException('use /auth/password to change your own');
    }
    requireStrong(password);
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (target === null) throw new NotFoundException('no such user');
    await this.auth.setPassword(targetId, password);
    await this.sessions.revokeAll(targetId);
  }

  async reset(code: string, password: string, now = new Date()): Promise<void> {
    requireStrong(password);
    const passwordHash = await this.auth.hashPassword(password);
    const codeHash = digest(code);
    // Consume, set and revoke together: a code is never spent without the
    // password changing.
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.resetCode.findUnique({ where: { codeHash } });
      const { count } = await tx.resetCode.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (row === null || count !== 1) {
        throw new BadRequestException(INVALID_CODE);
      }
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash },
      });
      await this.sessions.revokeAll(row.userId, now, tx);
    });
  }

  async deleteAccount(userId: string, password: string): Promise<void> {
    if (!(await this.auth.verifyPassword(userId, password))) {
      throw new UnauthorizedException('invalid credentials');
    }
    await this.prisma.$transaction(async (tx) => {
      await lockUserWrites(tx, userId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, 0)`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user === null) return;
      if (user.isOwner && (await tx.user.count()) > 1) {
        throw new ConflictException(
          'the owner cannot be deleted while other users exist',
        );
      }
      const where = { userId };
      await tx.appliedOp.deleteMany({ where });
      await tx.taskOccurrence.deleteMany({ where });
      await tx.taskTag.deleteMany({ where });
      await tx.task.deleteMany({ where });
      await tx.status.deleteMany({ where });
      await tx.view.deleteMany({ where });
      await tx.project.deleteMany({ where });
      await tx.tag.deleteMany({ where });
      // Sessions and reset codes cascade.
      await tx.invitation.deleteMany({ where: { createdBy: userId } });
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
