import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/app-config.js';
import { AccountsService } from './accounts.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService, normalizeEmail } from './auth.service.js';
import { TooManyRequests } from './rate-limit.js';
import type { CookieJar } from './refresh-cookie.js';
import {
  IDLE_MS,
  SessionService,
  type SessionTokens,
} from './session.service.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const sessions = new SessionService(prisma, config, auth);
const req = { ip: '1.2.3.4', headers: {} };
const PASSWORD = 'correct horse battery!1';

type Cookie = { name: string; value: string; options: unknown };
/** A response that records what the controller asked it to set or clear. */
const jar = () => {
  const set: Cookie[] = [];
  const cleared: Cookie[] = [];
  return {
    set,
    cleared,
    cookie: (name: string, value: string, options: unknown) =>
      void set.push({ name, value, options }),
    clearCookie: (name: string, options: unknown) =>
      void cleared.push({ name, value: '', options }),
  } as unknown as CookieJar & { set: Cookie[]; cleared: Cookie[] };
};
const withCookie = (value: string) => ({
  ip: '1.2.3.4',
  headers: { cookie: `todoer_refresh=${value}` },
});
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: IDLE_MS,
};

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

// Body transport: the refresh token is present.
const login = (email = 'a@b.c', password = PASSWORD, r = req) =>
  controller.login({ email, password }, r, jar()) as Promise<SessionTokens>;

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
      jar(),
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
      login('a@b.c', PASSWORD, { ip: '5.6.7.8', headers: {} }),
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
      ({ refreshToken } = (await controller.refresh(
        { refreshToken },
        req,
        jar(),
      )) as SessionTokens);
    }
    for (let i = 0; i < 30; i++) {
      await expect(
        controller.refresh({ refreshToken: 'junk' }, req, jar()),
      ).rejects.toThrow(/invalid token/);
    }
    await expect(
      controller.refresh({ refreshToken }, req, jar()),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });

  it('blocks an IP after thirty invalid refreshes', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(
        controller.refresh({ refreshToken: 'junk' }, req, jar()),
      ).rejects.toThrow(/invalid token/);
    }
    await expect(
      controller.refresh({ refreshToken: 'junk' }, req, jar()),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });
});

describe('logout', () => {
  it('revokes the session of the given refresh token', async () => {
    const pair = await login();
    await controller.logout(U, { refreshToken: pair.refreshToken }, req, jar());
    await expect(
      controller.refresh({ refreshToken: pair.refreshToken }, req, jar()),
    ).rejects.toThrow(/invalid token/);
  });

  it('revokes every session with all: true', async () => {
    const a = await login();
    const b = await login();
    await controller.logout(U, { all: true }, req, jar());
    for (const p of [a, b]) {
      await expect(
        controller.refresh({ refreshToken: p.refreshToken }, req, jar()),
      ).rejects.toThrow(/invalid token/);
    }
  });

  it("ignores another user's refresh token", async () => {
    const other = uuidv7();
    await createUser(other, 'c@b.c');
    const theirs = await login('c@b.c');
    await controller.logout(
      U,
      { refreshToken: theirs.refreshToken },
      req,
      jar(),
    );
    await expect(
      controller.refresh({ refreshToken: theirs.refreshToken }, req, jar()),
    ).resolves.toBeTruthy();
  });
});

describe('password change', () => {
  const NEW = 'brand new pass#9';

  it('refuses a wrong current password', async () => {
    await expect(
      controller.changePassword(
        U,
        {
          currentPassword: 'wrong-pass1!',
          newPassword: NEW,
        },
        jar(),
      ),
    ).rejects.toThrow(/invalid credentials/);
  });

  it('blocks the sixth wrong current password with 429, without checking it', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        controller.changePassword(
          U,
          {
            currentPassword: 'wrong-pass1!',
            newPassword: NEW,
          },
          jar(),
        ),
      ).rejects.toThrow(/invalid credentials/);
    }
    const spy = vi.spyOn(auth, 'verifyPassword');
    await expect(
      controller.changePassword(
        U,
        {
          currentPassword: PASSWORD,
          newPassword: NEW,
        },
        jar(),
      ),
    ).rejects.toBeInstanceOf(TooManyRequests);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a successful change clears the counter', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(
        controller.changePassword(
          U,
          {
            currentPassword: 'wrong-pass1!',
            newPassword: NEW,
          },
          jar(),
        ),
      ).rejects.toThrow(/invalid credentials/);
    }
    await controller.changePassword(
      U,
      {
        currentPassword: PASSWORD,
        newPassword: NEW,
      },
      jar(),
    );
    for (let i = 0; i < 4; i++) {
      await expect(
        controller.changePassword(
          U,
          {
            currentPassword: 'wrong-pass1!',
            newPassword: PASSWORD,
          },
          jar(),
        ),
      ).rejects.toThrow(/invalid credentials/);
    }
    await expect(
      controller.changePassword(
        U,
        {
          currentPassword: NEW,
          newPassword: PASSWORD,
        },
        jar(),
      ),
    ).resolves.toBeTruthy();
  });

  it('refuses a weak new password, naming the rule', async () => {
    await expect(
      controller.changePassword(
        U,
        {
          currentPassword: PASSWORD,
          newPassword: 'alllowercase',
        },
        jar(),
      ),
    ).rejects.toThrow(/a digit/);
  });

  it('revokes old sessions and returns a working pair', async () => {
    const old = await login();
    const fresh = await controller.changePassword(
      U,
      {
        currentPassword: PASSWORD,
        newPassword: NEW,
      },
      jar(),
    );
    await expect(
      controller.refresh({ refreshToken: old.refreshToken }, req, jar()),
    ).rejects.toThrow(/invalid token/);
    await expect(
      controller.refresh({ refreshToken: fresh.refreshToken! }, req, jar()),
    ).resolves.toBeTruthy();
    await expect(login('a@b.c', NEW)).resolves.toBeTruthy();
  });
});

describe('accounts routes', () => {
  it('blocks the 21st registration from one address with 429', async () => {
    for (let i = 0; i < 20; i++) {
      await expect(
        controller.register({ email: 'n@b.c', password: PASSWORD }, req, jar()),
      ).rejects.toThrow('registration is closed');
    }
    await expect(
      controller.register({ email: 'n@b.c', password: PASSWORD }, req, jar()),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });

  it('refuses registration and invitations to a non-owner, and forgot with 503', async () => {
    await expect(controller.invite(U, { email: 'n@b.c' })).rejects.toThrow(
      'owner only',
    );
    await expect(
      controller.register({ email: 'n@b.c', password: PASSWORD }, req, jar()),
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

describe('the refresh cookie', () => {
  const NEW = 'brand new pass#9';

  it('login with transport cookie moves the refresh token into the cookie', async () => {
    const res = jar();
    const body = await controller.login(
      { email: 'a@b.c', password: PASSWORD, transport: 'cookie' },
      req,
      res,
    );
    expect(body).not.toHaveProperty('refreshToken');
    expect(auth.verify(body.accessToken)).toBe(U);
    expect(res.set).toHaveLength(1);
    expect(res.set[0]).toMatchObject({
      name: 'todoer_refresh',
      options: COOKIE_OPTIONS,
    });
    await expect(
      controller.refresh({}, withCookie(res.set[0]!.value), jar()),
    ).resolves.toHaveProperty('accessToken');
  });

  it('login without transport, or with body, answers in the body and leaves the jar alone', async () => {
    for (const extra of [{}, { transport: 'body' as const }]) {
      const res = jar();
      const body = await controller.login(
        { email: 'a@b.c', password: PASSWORD, ...extra },
        req,
        res,
      );
      expect(body.refreshToken).toBeTruthy();
      expect(res.set).toHaveLength(0);
    }
  });

  it('register (owner first) with transport cookie sets the cookie', async () => {
    await resetDatabase(prisma);
    const res = jar();
    const body = await controller.register(
      { email: 'o@b.c', password: PASSWORD, transport: 'cookie' },
      req,
      res,
    );
    expect(body).not.toHaveProperty('refreshToken');
    expect(res.set[0]).toMatchObject({ options: COOKIE_OPTIONS });
  });

  it('password change with transport cookie sets the cookie', async () => {
    const res = jar();
    const body = await controller.changePassword(
      U,
      { currentPassword: PASSWORD, newPassword: NEW, transport: 'cookie' },
      res,
    );
    expect(body).not.toHaveProperty('refreshToken');
    expect(res.set[0]).toMatchObject({ options: COOKIE_OPTIONS });
  });

  it('refreshes from the cookie with an empty body and rotates the cookie', async () => {
    const first = await login();
    const res = jar();
    const body = await controller.refresh(
      {},
      withCookie(first.refreshToken),
      res,
    );
    expect(body).not.toHaveProperty('refreshToken');
    expect(auth.verify(body.accessToken)).toBe(U);
    expect(res.set).toHaveLength(1);
    expect(res.set[0]!.value).not.toBe(first.refreshToken);
  });

  it('the old cookie inside the grace window gets the same successor', async () => {
    const first = await login();
    const a = jar();
    const b = jar();
    await controller.refresh({}, withCookie(first.refreshToken), a);
    await controller.refresh({}, withCookie(first.refreshToken), b);
    expect(b.set[0]!.value).toBe(a.set[0]!.value);
  });

  it('a body token wins over the cookie: body answer, jar untouched', async () => {
    const fromBody = await login();
    const fromCookie = await login();
    const res = jar();
    const body = await controller.refresh(
      { refreshToken: fromBody.refreshToken },
      withCookie(fromCookie.refreshToken),
      res,
    );
    expect(body.refreshToken).toBeTruthy();
    expect(res.set).toHaveLength(0);
    // The body token rotated; the cookie's session did not.
    const again = await controller.refresh(
      {},
      withCookie(fromCookie.refreshToken),
      jar(),
    );
    expect(again.accessToken).toBeTruthy();
  });

  it('a refresh with neither token is a 401 and counts toward the IP limit', async () => {
    await expect(controller.refresh({}, req, jar())).rejects.toThrow(
      /invalid token/,
    );
    for (let i = 0; i < 29; i++) {
      await expect(controller.refresh({}, req, jar())).rejects.toThrow(
        /invalid token/,
      );
    }
    await expect(controller.refresh({}, req, jar())).rejects.toBeInstanceOf(
      TooManyRequests,
    );
  });

  it('blocks an IP after thirty invalid cookie refreshes', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(
        controller.refresh({}, withCookie('junk'), jar()),
      ).rejects.toThrow(/invalid token/);
    }
    await expect(
      controller.refresh({}, withCookie('junk'), jar()),
    ).rejects.toBeInstanceOf(TooManyRequests);
  });

  it('logout with the cookie only revokes that session and clears the cookie', async () => {
    const pair = await login();
    const res = jar();
    await controller.logout(U, {}, withCookie(pair.refreshToken), res);
    expect(res.cleared).toHaveLength(1);
    expect(res.cleared[0]).toMatchObject({
      name: 'todoer_refresh',
      options: { path: '/api/v1/auth' },
    });
    await expect(
      controller.refresh({ refreshToken: pair.refreshToken }, req, jar()),
    ).rejects.toThrow(/invalid token/);
  });

  it('logout all clears the cookie', async () => {
    const res = jar();
    await controller.logout(U, { all: true }, req, res);
    expect(res.cleared).toHaveLength(1);
  });

  it("logout with another user's cookie clears it but revokes nothing", async () => {
    await createUser(uuidv7(), 'c@b.c');
    const theirs = await login('c@b.c');
    const res = jar();
    await controller.logout(U, {}, withCookie(theirs.refreshToken), res);
    expect(res.cleared).toHaveLength(1);
    await expect(
      controller.refresh({ refreshToken: theirs.refreshToken }, req, jar()),
    ).resolves.toBeTruthy();
  });
});
