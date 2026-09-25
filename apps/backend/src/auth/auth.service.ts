import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

const scrypt = promisify(scryptCb);

const TOKEN_TTL_MS = 15 * 60_000;
const KEY_LEN = 64;
// Fixed dummy salt/hash for an unknown address in login(): scrypt is ~80ms
// of synchronous CPU, so a known address (one scrypt call) and an unknown
// one (previously: none) were two orders of magnitude apart in response
// time — enough to enumerate every account on the instance from outside,
// even though the response body and status were already identical. Running
// scrypt against this fixed pair, unconditionally, is what makes the two
// paths cost the same. The values themselves are arbitrary: they only need
// a fixed length and to never equal a real hash, and a real hash matching
// 64 zero bytes has negligible probability.
const DUMMY_SALT = '0'.repeat(32);
const DUMMY_HASH = '0'.repeat(KEY_LEN * 2);

// A generic message for every rejection this module can throw — a wrong
// password and an unknown address (login), a missing header, a malformed
// token, a bad signature and an expired token (verify, via the guard) — so
// none of them is distinguishable to a client. Distinguishing them is what
// turns an auth endpoint into an oracle.
const INVALID_CREDENTIALS = 'invalid credentials';
const INVALID_TOKEN = 'invalid token';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async register(id: string, email: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString('hex');
    const hash = ((await scrypt(password, salt, KEY_LEN)) as Buffer).toString('hex');
    await this.prisma.user.create({
      data: { id, email: normalizeEmail(email), passwordHash: `${salt}:${hash}` },
    });
  }

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    const failure = new UnauthorizedException(INVALID_CREDENTIALS);

    // Unknown address: still pay for one scrypt call, against a fixed dummy
    // salt, so this branch costs the same as a known address with a wrong
    // password. See DUMMY_SALT/DUMMY_HASH above.
    const [salt, expected] =
      user !== null ? user.passwordHash.split(':') : [DUMMY_SALT, DUMMY_HASH];
    if (salt === undefined || expected === undefined) throw failure;

    const actual = ((await scrypt(password, salt, KEY_LEN)) as Buffer).toString('hex');
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(expected, 'hex');
    // hashesMatch is computed as its own statement, unconditionally, before
    // the null check below — not folded into one `||` chain — so an unknown
    // address still runs timingSafeEqual instead of short-circuiting past
    // it. The gap this closes is nanoseconds against scrypt's ~80ms, but
    // it's the same asymmetry C1 was about: user === null must not be a
    // branch that skips work a known-but-wrong-password login always does.
    const hashesMatch = a.length === b.length && timingSafeEqual(a, b);
    if (user === null || !hashesMatch) throw failure;

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
    // Exactly two segments. Ignoring extras (the original split-and-take-
    // first-two behaviour) would let "payload.mac.anything" verify — not
    // forgeable without the secret, but it turns one account into an
    // unbounded set of distinct valid token strings, which forecloses any
    // future revocation by value.
    const parts = token.split('.');
    if (parts.length !== 2) throw new UnauthorizedException(INVALID_TOKEN);
    const [payload, mac] = parts;
    if (payload === undefined || mac === undefined) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }

    const expected = createHmac('sha256', this.config.jwtSecret)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub: string;
      exp: number;
    };
    // Positive check: claims.exp < Date.now() reads as false when exp is
    // absent (undefined < number is false), so a token minted without one
    // would never expire. A non-numeric exp is invalid outright.
    if (typeof claims.exp !== 'number' || claims.exp < Date.now()) {
      throw new UnauthorizedException(INVALID_TOKEN);
    }
    return claims.sub;
  }
}
