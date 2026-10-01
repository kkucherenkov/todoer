import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/app-config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TooManyRequests } from './rate-limit.js';
import { SessionService } from './session.service.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const sessions = new SessionService(prisma, config, auth);
const req = { ip: '1.2.3.4' };
const PASSWORD = 'correct horse battery!1';

let controller: AuthController;
let U: string;

const login = (email = 'a@b.c', password = PASSWORD, r = req) =>
  controller.login({ email, password }, r);

beforeEach(async () => {
  vi.restoreAllMocks();
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.resetCode.deleteMany({});
  await prisma.user.deleteMany({});
  controller = new AuthController(auth, sessions, prisma);
  U = uuidv7();
  await auth.register(U, 'a@b.c', PASSWORD);
});

describe('login and refresh', () => {
  it('returns a session pair whose access token verifies', async () => {
    const pair = await login();
    expect(auth.verify(pair.accessToken)).toBe(U);
    expect(pair.refreshToken).toBeTruthy();
    expect(Number.isNaN(Date.parse(pair.accessExpiresAt))).toBe(false);
  });

  it('refreshes into a new pair', async () => {
    const first = await login();
    const next = await controller.refresh(
      { refreshToken: first.refreshToken },
      req,
    );
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(auth.verify(next.accessToken)).toBe(U);
  });
});

describe('rate limits', () => {
  it('blocks the sixth login with 429 whatever the password, without checking it', async () => {
    for (let i = 0; i < 5; i++)
      await expect(login('a@b.c', 'wrong-pass1!')).rejects.toThrow();
    const spy = vi.spyOn(auth, 'login');
    await expect(login()).rejects.toBeInstanceOf(TooManyRequests);
    await expect(login('a@b.c', 'wrong-pass1!')).rejects.toBeInstanceOf(
      TooManyRequests,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('holds against a burst of parallel wrong passwords', async () => {
    const spy = vi.spyOn(auth, 'login');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => login('a@b.c', 'wrong-pass1!')),
    );
    expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
    const blocked = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof TooManyRequests,
    );
    expect(blocked).toHaveLength(5);
  });

  it('counts an address regardless of case and padding', async () => {
    for (let i = 0; i < 5; i++)
      await expect(login('A@b.c', 'wrong-pass1!')).rejects.toThrow();
    await expect(login(' a@b.c ')).rejects.toBeInstanceOf(TooManyRequests);
  });

  it('a success clears the address key but not the IP key', async () => {
    for (let i = 0; i < 19; i++) {
      await expect(
        login(`n${String(i)}@b.c`, 'wrong-pass1!'),
      ).rejects.toThrow();
    }
    await login();
    await expect(login('a@b.c', 'wrong-pass1!')).rejects.toBeInstanceOf(
      TooManyRequests,
    );
  });

  it('does not block another address from the same IP', async () => {
    await auth.register(uuidv7(), 'b@b.c', PASSWORD);
    for (let i = 0; i < 5; i++)
      await expect(login('a@b.c', 'wrong-pass1!')).rejects.toThrow();
    await expect(login('b@b.c')).resolves.toHaveProperty('refreshToken');
  });

  it('blocks an IP after twenty failures', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(
        login(`n${String(i)}@b.c`, 'wrong-pass1!'),
      ).rejects.toThrow();
    }
    await expect(login()).rejects.toBeInstanceOf(TooManyRequests);
    await expect(
      login('a@b.c', PASSWORD, { ip: '5.6.7.8' }),
    ).resolves.toBeTruthy();
  });

  it('a successful login clears the address counter', async () => {
    for (let i = 0; i < 4; i++)
      await expect(login('a@b.c', 'wrong-pass1!')).rejects.toThrow();
    await login();
    for (let i = 0; i < 4; i++)
      await expect(login('a@b.c', 'wrong-pass1!')).rejects.toThrow();
    await expect(login()).resolves.toBeTruthy();
  });

  it('blocks an IP after thirty invalid refreshes', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(
        controller.refresh({ refreshToken: 'junk' }, req),
      ).rejects.toThrow(/invalid token/);
    }
    await expect(
      controller.refresh({ refreshToken: 'junk' }, req),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });
});

describe('logout', () => {
  it('revokes the session of the given refresh token', async () => {
    const pair = await login();
    await controller.logout(U, { refreshToken: pair.refreshToken });
    await expect(
      controller.refresh({ refreshToken: pair.refreshToken }, req),
    ).rejects.toThrow(/invalid token/);
  });

  it('revokes every session with all: true', async () => {
    const a = await login();
    const b = await login();
    await controller.logout(U, { all: true });
    for (const p of [a, b]) {
      await expect(
        controller.refresh({ refreshToken: p.refreshToken }, req),
      ).rejects.toThrow(/invalid token/);
    }
  });

  it("ignores another user's refresh token", async () => {
    const other = uuidv7();
    await auth.register(other, 'c@b.c', PASSWORD);
    const theirs = await login('c@b.c');
    await controller.logout(U, { refreshToken: theirs.refreshToken });
    await expect(
      controller.refresh({ refreshToken: theirs.refreshToken }, req),
    ).resolves.toBeTruthy();
  });
});

describe('password change', () => {
  const NEW = 'brand new pass#9';

  it('refuses a wrong current password', async () => {
    await expect(
      controller.changePassword(U, {
        currentPassword: 'wrong-pass1!',
        newPassword: NEW,
      }),
    ).rejects.toThrow(/invalid credentials/);
  });

  it('refuses a weak new password, naming the rule', async () => {
    await expect(
      controller.changePassword(U, {
        currentPassword: PASSWORD,
        newPassword: 'alllowercase',
      }),
    ).rejects.toThrow(/a digit/);
  });

  it('revokes old sessions and returns a working pair', async () => {
    const old = await login();
    const fresh = await controller.changePassword(U, {
      currentPassword: PASSWORD,
      newPassword: NEW,
    });
    await expect(
      controller.refresh({ refreshToken: old.refreshToken }, req),
    ).rejects.toThrow(/invalid token/);
    await expect(
      controller.refresh({ refreshToken: fresh.refreshToken }, req),
    ).resolves.toBeTruthy();
    await expect(login('a@b.c', NEW)).resolves.toBeTruthy();
  });
});
