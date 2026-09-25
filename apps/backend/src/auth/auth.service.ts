import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TOKEN_TTL_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async register(id: string, email: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    await this.prisma.user.create({
      data: { id, email, passwordHash: `${salt}:${hash}` },
    });
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // The same message for an unknown address and a wrong password: telling
    // them apart turns the endpoint into a way to enumerate accounts.
    const failure = new UnauthorizedException('invalid credentials');
    if (user === null) throw failure;

    const [salt, expected] = user.passwordHash.split(':');
    if (salt === undefined || expected === undefined) throw failure;

    const actual = scryptSync(password, salt, 64).toString('hex');
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw failure;

    return { accessToken: this.sign(user.id) };
  }

  sign(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({ sub: userId, exp: Date.now() + TOKEN_TTL_MS }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.config.jwtSecret)
      .update(payload)
      .digest('base64url');
    return `${payload}.${mac}`;
  }

  verify(token: string): string {
    const [payload, mac] = token.split('.');
    if (payload === undefined || mac === undefined) {
      throw new UnauthorizedException('malformed token');
    }
    const expected = createHmac('sha256', this.config.jwtSecret)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('bad signature');
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub: string;
      exp: number;
    };
    if (claims.exp < Date.now()) throw new UnauthorizedException('expired');
    return claims.sub;
  }
}
