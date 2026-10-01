import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from './accounts.service.js';
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
  private readonly passwordByUser = new RateLimiter(5, WINDOW_MS);
  private readonly registerByIp = new RateLimiter(20, WINDOW_MS);
  private readonly resetByIp = new RateLimiter(20, WINDOW_MS);
  private readonly deleteByIp = new RateLimiter(20, WINDOW_MS);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
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
    // Not reserved up front: an HMAC check and one lookup are cheap, so only
    // invalid refreshes (401) count and a busy legitimate client is never
    // limited.
    try {
      return await this.sessions.refresh(body.refreshToken);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.refreshByIp.fail(ip, now);
      }
      throw error;
    }
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
    // A stolen token must not allow unlimited guessing of the password.
    // Reserved before the scrypt call, like login, and released on success.
    const now = Date.now();
    AuthController.check(now, [this.passwordByUser, userId]);
    this.passwordByUser.fail(userId, now);
    if (!(await this.auth.verifyPassword(userId, body.currentPassword))) {
      throw new UnauthorizedException('invalid credentials');
    }
    this.passwordByUser.clear(userId);
    const problem = passwordProblem(body.newPassword);
    if (problem !== null) throw new BadRequestException(problem);
    await this.auth.setPassword(userId, body.newPassword);
    await this.sessions.revokeAll(userId);
    return this.sessions.start(userId);
  }

  @Post('register')
  async register(
    @Body() body: Credentials & { invitation?: string },
    @Req() req: Client,
  ): Promise<SessionTokens> {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    AuthController.check(now, [this.registerByIp, ip]);
    // Reserved up front: registration costs a scrypt call.
    this.registerByIp.fail(ip, now);
    try {
      const { userId } = await this.accounts.register(
        body.email,
        body.password,
        body.invitation,
      );
      return await this.sessions.start(userId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('that address is already registered');
      }
      throw error;
    }
  }

  @Post('invites')
  @UseGuards(AuthGuard)
  async invite(
    @CurrentUser() userId: string,
    @Body() body: { email?: string },
  ): Promise<{ token: string; expiresAt: string }> {
    const { token, expiresAt } = await this.accounts.invite(userId, body.email);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  @Post('users/:id/password')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async setUserPassword(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { password: string },
  ): Promise<void> {
    await this.accounts.setPasswordFor(userId, id, body.password);
  }

  @Post('forgot')
  forgot(): never {
    throw new ServiceUnavailableException(
      'mail is not configured on this instance — ask its owner to reset your password',
    );
  }

  @Post('reset')
  @HttpCode(204)
  async reset(
    @Body() body: { code: string; password: string },
    @Req() req: Client,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    AuthController.check(now, [this.resetByIp, ip]);
    // Reserved up front, like login; every attempt counts toward the budget.
    this.resetByIp.fail(ip, now);
    await this.accounts.reset(body.code, body.password);
  }

  @Delete('account')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async deleteAccount(
    @CurrentUser() userId: string,
    @Body() body: { password: string },
    @Req() req: Client,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    AuthController.check(now, [this.deleteByIp, ip]);
    // Reserved up front: the password check costs a scrypt call.
    this.deleteByIp.fail(ip, now);
    await this.accounts.deleteAccount(userId, body.password);
  }
}
