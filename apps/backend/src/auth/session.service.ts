import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const DAY_MS = 86_400_000;
export const IDLE_MS = 30 * DAY_MS;
export const ABSOLUTE_MS = 365 * DAY_MS;
export const GRACE_MS = 30_000;
const INVALID_TOKEN = 'invalid token';

export type SessionTokens = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
};

// Strict, lowercase-only: anything looser reaches the @db.Uuid lookup and
// throws a 500 instead of the generic refusal, and case variants would give a
// token several spellings.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERATION = /^(0|[1-9]\d{0,8})$/;

type Parsed = { id: string; generation: number; mac: string };

export function parse(token: string): Parsed | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [id, gen, mac] = parts;
  if (id === undefined || gen === undefined || mac === undefined) return null;
  if (!UUID.test(id) || !GENERATION.test(gen)) return null;
  return { id, generation: Number(gen), mac };
}

/**
 * Sessions with rotating refresh tokens (plan D design, Q2, Q4, Q5). A token
 * is `<id>.<generation>.<mac>`, the mac an HMAC over a `refresh.` domain
 * prefix, the id, the generation and a per-session salt (plan departure 1):
 * nothing secret is stored, and the successor of any generation can be
 * recomputed, which is what lets a retry inside the grace window receive the
 * very pair the first call got.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  private mac(id: string, generation: number, salt: string): string {
    return createHmac('sha256', this.config.jwtSecret)
      .update(`refresh.${id}.${String(generation)}.${salt}`)
      .digest('base64url');
  }

  private tokens(
    userId: string,
    id: string,
    generation: number,
    salt: string,
    now: Date,
  ): SessionTokens {
    const access = this.auth.signWithExpiry(userId, now);
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt.toISOString(),
      refreshToken: `${id}.${String(generation)}.${this.mac(id, generation, salt)}`,
    };
  }

  async start(userId: string, now = new Date()): Promise<SessionTokens> {
    const id = uuidv7();
    const salt = randomBytes(16).toString('hex');
    await this.prisma.session.create({
      data: { id, userId, salt, lastUsedAt: now, createdAt: now },
    });
    return this.tokens(userId, id, 0, salt, now);
  }

  async refresh(
    refreshToken: string,
    now = new Date(),
  ): Promise<SessionTokens> {
    const invalid = new UnauthorizedException(INVALID_TOKEN);
    const parsed = parse(refreshToken);
    if (parsed === null) throw invalid;
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.id },
    });
    if (session === null || session.revokedAt !== null) throw invalid;
    const expected = Buffer.from(
      this.mac(session.id, parsed.generation, session.salt),
    );
    const given = Buffer.from(parsed.mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw invalid;
    }
    if (
      now.getTime() - session.createdAt.getTime() > ABSOLUTE_MS ||
      now.getTime() - session.lastUsedAt.getTime() > IDLE_MS
    ) {
      await this.revokeById(session.id, now);
      throw invalid;
    }
    if (parsed.generation === session.generation) {
      // Conditional on the generation: of two concurrent refreshes, one
      // rotates and the other finds the generation moved and takes the grace
      // path below (Review Focus 2).
      const { count } = await this.prisma.session.updateMany({
        where: {
          id: session.id,
          generation: session.generation,
          revokedAt: null,
        },
        data: {
          generation: session.generation + 1,
          rotatedAt: now,
          lastUsedAt: now,
        },
      });
      if (count === 1) {
        return this.tokens(
          session.userId,
          session.id,
          session.generation + 1,
          session.salt,
          now,
        );
      }
      return this.refresh(refreshToken, now);
    }
    if (
      parsed.generation === session.generation - 1 &&
      session.rotatedAt !== null &&
      now.getTime() - session.rotatedAt.getTime() <= GRACE_MS
    ) {
      return this.tokens(
        session.userId,
        session.id,
        session.generation,
        session.salt,
        now,
      );
    }
    // A spent token outside the window: treat as stolen, end the session for
    // whoever holds either token (reuse detection).
    await this.revokeById(session.id, now);
    throw invalid;
  }

  private async revokeById(id: string, now: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revoke(refreshToken: string): Promise<void> {
    const parsed = parse(refreshToken);
    if (parsed !== null) await this.revokeById(parsed.id, new Date());
  }

  async revokeAll(
    userId: string,
    now = new Date(),
    db: Pick<PrismaService, 'session'> = this.prisma,
  ): Promise<void> {
    await db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
}
