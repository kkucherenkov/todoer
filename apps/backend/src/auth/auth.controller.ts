import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { AuthService, normalizeEmail } from './auth.service.js';
import { passwordProblem } from './password-policy.js';
import { RateLimiter, TooManyRequests } from './rate-limit.js';
import {
  parse,
  SessionService,
  type SessionTokens,
} from './session.service.js';

type Credentials = { email: string; password: string };
type Client = { ip?: string };

const WINDOW_MS = 15 * 60_000;

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  // ponytail: in-process counters, see RateLimiter.
  private readonly loginByAddress = new RateLimiter(5, WINDOW_MS);
  private readonly loginByIp = new RateLimiter(20, WINDOW_MS);
  private readonly refreshByIp = new RateLimiter(30, WINDOW_MS);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  // Checked before any work, so a blocked request neither costs a scrypt call
  // nor reveals whether its password was right.
  private static check(now: number, ...limits: [RateLimiter, string][]): void {
    for (const [limiter, key] of limits) {
      const wait = limiter.retryAfter(key, now);
      if (wait !== null) throw new TooManyRequests(wait);
    }
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: Credentials,
    @Req() req: Client,
  ): Promise<SessionTokens> {
    const ip = req.ip ?? 'unknown';
    const address = normalizeEmail(body.email);
    const now = Date.now();
    AuthController.check(
      now,
      [this.loginByAddress, address],
      [this.loginByIp, ip],
    );
    // Reserved before the work: scrypt is slow, so a burst of parallel
    // requests would otherwise all pass the check above before any failure
    // is recorded. Only the address key is released on success; the IP key
    // keeps counting every attempt.
    this.loginByAddress.fail(address, now);
    this.loginByIp.fail(ip, now);
    const { userId } = await this.auth.login(body.email, body.password);
    this.loginByAddress.clear(address);
    return this.sessions.start(userId);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: { refreshToken: string },
    @Req() req: Client,
  ): Promise<SessionTokens> {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    AuthController.check(now, [this.refreshByIp, ip]);
    // Reserved up front, like login; successes keep counting toward the IP
    // budget (30 per window), which a legitimate client stays well under.
    this.refreshByIp.fail(ip, now);
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @CurrentUser() userId: string,
    @Body() body: { refreshToken?: string; all?: boolean },
  ): Promise<void> {
    if (body.all === true) return this.sessions.revokeAll(userId);
    const token = body.refreshToken ?? '';
    const parsed = parse(token);
    if (parsed === null) return;
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.id },
    });
    if (session?.userId === userId) await this.sessions.revoke(token);
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() userId: string,
    @Body() body: { currentPassword: string; newPassword: string },
  ): Promise<SessionTokens> {
    if (!(await this.auth.verifyPassword(userId, body.currentPassword))) {
      throw new UnauthorizedException('invalid credentials');
    }
    const problem = passwordProblem(body.newPassword);
    if (problem !== null) throw new BadRequestException(problem);
    await this.auth.setPassword(userId, body.newPassword);
    await this.sessions.revokeAll(userId);
    return this.sessions.start(userId);
  }

  // Open registration: plan A has no owner-first or invitation gate (ADR
  // 0014's rules are plan D). Acceptable on a self-hosted local instance,
  // and load-bearing for Task 8's walking-skeleton.sh, which posts here.
  @Post('register')
  async register(@Body() body: Credentials): Promise<SessionTokens> {
    const id = uuidv7();
    try {
      await this.auth.register(id, body.email, body.password);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('that address is already registered');
      }
      throw error;
    }
    return this.sessions.start(id);
  }
}
