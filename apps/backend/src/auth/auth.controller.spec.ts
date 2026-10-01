import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/app-config.js';
import { AccountsService } from './accounts.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService, normalizeEmail } from './auth.service.js';
import { TooManyRequests } from './rate-limit.js';
import { SessionService } from './session.service.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const sessions = new SessionService(prisma, config, auth);
const req = { ip: '1.2.3.4' };
const PASSWORD = 'correct horse battery!1';

const createUser = async (id: string, email: string): Promise<void> => {
  await prisma.user.create({
    data: {
      id,
      email: normalizeEmail(email),
      passwordHash: await auth.hashPassword(PASSWORD),
    },
  });
};

let controller: AuthController;
let U: string;

const login = (email = 'a@b.c', password = PASSWORD, r = req) =>
  controller.login({ email, password }, r);

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase(prisma);
  controller = new AuthController(
    auth,
    sessions,
    prisma,
    new AccountsService(prisma, auth, sessions),
  );
  U = uuidv7();
  await createUser(U, 'a@b.c');
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
    await createUser(uuidv7(), 'b@b.c');
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

  it('does not count successful refreshes toward the IP budget', async () => {
    let { refreshToken } = await login();
    for (let i = 0; i < 31; i++) {
      ({ refreshToken } = await controller.refresh({ refreshToken }, req));
    }
    for (let i = 0; i < 30; i++) {
      await expect(
        controller.refresh({ refreshToken: 'junk' }, req),
      ).rejects.toThrow(/invalid token/);
    }
    await expect(
      controller.refresh({ refreshToken }, req),
    ).rejects.toBeInstanceOf(TooManyRequests);
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
    await createUser(other, 'c@b.c');
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

  it('blocks the sixth wrong current password with 429, without checking it', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        controller.changePassword(U, {
          currentPassword: 'wrong-pass1!',
          newPassword: NEW,
        }),
      ).rejects.toThrow(/invalid credentials/);
    }
    const spy = vi.spyOn(auth, 'verifyPassword');
    await expect(
      controller.changePassword(U, {
        currentPassword: PASSWORD,
        newPassword: NEW,
      }),
    ).rejects.toBeInstanceOf(TooManyRequests);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a successful change clears the counter', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(
        controller.changePassword(U, {
          currentPassword: 'wrong-pass1!',
          newPassword: NEW,
        }),
      ).rejects.toThrow(/invalid credentials/);
    }
    await controller.changePassword(U, {
      currentPassword: PASSWORD,
      newPassword: NEW,
    });
    for (let i = 0; i < 4; i++) {
      await expect(
        controller.changePassword(U, {
          currentPassword: 'wrong-pass1!',
          newPassword: PASSWORD,
        }),
      ).rejects.toThrow(/invalid credentials/);
    }
    await expect(
      controller.changePassword(U, {
        currentPassword: NEW,
        newPassword: PASSWORD,
      }),
    ).resolves.toBeTruthy();
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

describe('accounts routes', () => {
  it('blocks the 21st registration from one address with 429', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(
        controller.register({ email: 'n@b.c', password: PASSWORD }, req),
      ).rejects.toThrow('registration is closed');
    }
    await expect(
      controller.register({ email: 'n@b.c', password: PASSWORD }, req),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });

  it('refuses registration and invitations to a non-owner, and forgot with 503', async () => {
    await expect(controller.invite(U, { email: 'n@b.c' })).rejects.toThrow(
      'owner only',
    );
    await expect(
      controller.register({ email: 'n@b.c', password: PASSWORD }, req),
    ).rejects.toThrow('registration is closed');
    expect(() => controller.forgot()).toThrow(/mail is not configured/);
  });

  it('blocks the 21st reset from one address with 429', async () => {
    const spy = vi.spyOn(AccountsService.prototype, 'reset');
    for (let i = 0; i < 20; i++) {
      await expect(
        controller.reset({ code: 'nope', password: PASSWORD }, req),
      ).rejects.toThrow('invalid code');
    }
    await expect(
      controller.reset({ code: 'nope', password: PASSWORD }, req),
    ).rejects.toBeInstanceOf(TooManyRequests);
    expect(spy).toHaveBeenCalledTimes(20);
  });

  it('blocks the 21st account deletion from one address with 429, before the password is checked', async () => {
    const spy = vi.spyOn(AccountsService.prototype, 'deleteAccount');
    for (let i = 0; i < 20; i++) {
      await expect(
        controller.deleteAccount(U, { password: 'wrong pass phrase!9' }, req),
      ).rejects.toThrow('invalid credentials');
    }
    await expect(
      controller.deleteAccount(U, { password: PASSWORD }, req),
    ).rejects.toBeInstanceOf(TooManyRequests);
    expect(spy).toHaveBeenCalledTimes(20);
  });
});
