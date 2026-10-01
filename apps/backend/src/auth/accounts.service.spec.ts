import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/app-config.js';
import { AccountsService, issueResetCode } from './accounts.service.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { lockUserWrites } from '../sync/user-lock.js';
import { resetDatabase } from '../testing/reset-database.js';

const prisma = new PrismaService();
const config = {
  jwtSecret: 'test-secret-at-least-32-characters-long',
} as AppConfig;
const auth = new AuthService(prisma, config);
const sessions = new SessionService(prisma, config, auth);
const accounts = new AccountsService(prisma, auth, sessions);

const PASSWORD = 'correct horse battery!1';
const t0 = new Date('2026-10-01T00:00:00Z');
const minutes = (m: number): Date => new Date(t0.getTime() + m * 60_000);
const days = (d: number): Date => new Date(t0.getTime() + d * 86_400_000);

let owner: string;

// Other specs delete users without clearing synced rows; leave none behind.
afterAll(() => resetDatabase(prisma));

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase(prisma);
  owner = (await accounts.register('o@e.test', PASSWORD)).userId;
});

const join = async (email: string): Promise<string> => {
  const { token } = await accounts.invite(owner);
  return (await accounts.register(email, PASSWORD, token)).userId;
};

describe('register', () => {
  it('makes the first account the owner, and closes after it', async () => {
    expect(
      await prisma.user.findUnique({ where: { id: owner } }),
    ).toMatchObject({ isOwner: true });
    await expect(accounts.register('b@e.test', PASSWORD)).rejects.toThrow(
      'registration is closed',
    );
  });

  // Review Focus 3.
  it('lets exactly one of several parallel registrations on an empty instance win', async () => {
    await prisma.user.deleteMany({});
    // scrypt calls queue on the thread pool and would stagger the arrivals;
    // the race is in the transaction, so make every call reach it at once.
    vi.spyOn(auth, 'hashPassword').mockResolvedValue('s:h');
    // Open the pool's connections first, or they connect one after another.
    await Promise.all(
      Array.from(
        { length: 8 },
        () => prisma.$queryRaw`SELECT pg_sleep(0.05)::text`,
      ),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        accounts.register(`r${String(i)}@e.test`, PASSWORD),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it('refuses a closed-instance registration without hashing', async () => {
    const spy = vi.spyOn(auth, 'hashPassword');
    await expect(accounts.register('b@e.test', PASSWORD)).rejects.toThrow(
      'registration is closed',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a weak password', async () => {
    await expect(accounts.register('b@e.test', 'password')).rejects.toThrow(
      /a password needs/,
    );
  });
});

describe('invitations', () => {
  it('are for the owner only', async () => {
    const other = await join('b@e.test');
    await expect(accounts.invite(other)).rejects.toThrow('owner only');
  });

  it('register once, and the row keeps only a hash', async () => {
    const { token } = await accounts.invite(owner);
    await accounts.register('b@e.test', PASSWORD, token);
    await expect(
      accounts.register('c@e.test', PASSWORD, token),
    ).rejects.toThrow('invalid invitation');
    const rows = await prisma.invitation.findMany({});
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]).toMatchObject({ createdBy: owner });
    expect(rows[0]?.usedAt).not.toBeNull();
  });

  it('expire after 7 days', async () => {
    const { token } = await accounts.invite(owner, undefined, t0);
    await expect(
      accounts.register('b@e.test', PASSWORD, token, days(8)),
    ).rejects.toThrow('invalid invitation');
    await accounts.register('b@e.test', PASSWORD, token, days(6));
  });

  it('bound to an address refuse another, and still work for theirs', async () => {
    const { token } = await accounts.invite(owner, 'X@e.test');
    await expect(
      accounts.register('y@e.test', PASSWORD, token),
    ).rejects.toThrow('invalid invitation');
    await accounts.register('x@e.test', PASSWORD, token);
  });

  it('are not spent by a registration that fails', async () => {
    const { token } = await accounts.invite(owner);
    await expect(
      accounts.register('o@e.test', PASSWORD, token),
    ).rejects.toThrow();
    await accounts.register('b@e.test', PASSWORD, token);
  });

  it('refuse an unknown token', async () => {
    await expect(
      accounts.register('b@e.test', PASSWORD, 'nope'),
    ).rejects.toThrow('invalid invitation');
  });
});

describe('setPasswordFor', () => {
  it('sets the password and revokes the target sessions', async () => {
    const target = await join('b@e.test');
    await sessions.start(target);
    await accounts.setPasswordFor(owner, target, 'another pass phrase!2');
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    await expect(
      auth.login('b@e.test', 'another pass phrase!2'),
    ).resolves.toEqual({ userId: target });
  });

  it('refuses a non-owner, an unknown target and a weak password', async () => {
    const target = await join('b@e.test');
    await expect(
      accounts.setPasswordFor(target, owner, 'another pass phrase!2'),
    ).rejects.toThrow('owner only');
    await expect(
      accounts.setPasswordFor(owner, owner, 'another pass phrase!2'),
    ).rejects.toThrow('use /auth/password');
    await expect(
      accounts.setPasswordFor(owner, uuidv7(), 'another pass phrase!2'),
    ).rejects.toThrow('no such user');
    await expect(
      accounts.setPasswordFor(owner, target, 'weak'),
    ).rejects.toThrow(/a password needs/);
  });
});

describe('reset codes', () => {
  it('set the password once, within 15 minutes, and revoke sessions', async () => {
    await sessions.start(owner);
    const code = await issueResetCode(prisma, owner, t0);
    await accounts.reset(code, 'another pass phrase!2', minutes(14));
    expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(0);
    await auth.login('o@e.test', 'another pass phrase!2');
    await expect(
      accounts.reset(code, 'third pass phrase!3', minutes(14)),
    ).rejects.toThrow('invalid code');
    const rows = await prisma.resetCode.findMany({});
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('expire after 15 minutes', async () => {
    const code = await issueResetCode(prisma, owner, t0);
    await expect(
      accounts.reset(code, 'another pass phrase!2', minutes(16)),
    ).rejects.toThrow('invalid code');
  });

  it('refuse a weak password without spending the code', async () => {
    const code = await issueResetCode(prisma, owner, t0);
    await expect(accounts.reset(code, 'weak', minutes(1))).rejects.toThrow(
      /a password needs/,
    );
    await accounts.reset(code, 'another pass phrase!2', minutes(1));
  });

  it('leave one valid code at a time', async () => {
    const first = await issueResetCode(prisma, owner, t0);
    const second = await issueResetCode(prisma, owner, t0);
    await expect(
      accounts.reset(first, 'another pass phrase!2', minutes(1)),
    ).rejects.toThrow('invalid code');
    await accounts.reset(second, 'another pass phrase!2', minutes(1));
  });

  it('refuse an unknown code', async () => {
    await expect(
      accounts.reset('nope', 'another pass phrase!2'),
    ).rejects.toThrow('invalid code');
  });
});

describe('deleteAccount', () => {
  it('refuses a wrong password', async () => {
    await expect(
      accounts.deleteAccount(owner, 'wrong pass phrase!9'),
    ).rejects.toThrow('invalid credentials');
  });

  const seed = async (u: string): Promise<void> => {
    const task = uuidv7();
    const project = uuidv7();
    const tag = uuidv7();
    const protocol = { seq: 0n, version: 1 };
    await prisma.project.create({
      data: { id: project, userId: u, name: 'p', rank: 'a', ...protocol },
    });
    await prisma.tag.create({
      data: { id: tag, userId: u, name: 't', ...protocol },
    });
    await prisma.task.create({
      data: {
        id: task,
        userId: u,
        title: 't',
        rank: 'a',
        projectId: project,
        ...protocol,
      },
    });
    await prisma.task.create({
      data: {
        id: uuidv7(),
        userId: u,
        title: 'sub',
        rank: 'a',
        parentId: task,
        ...protocol,
      },
    });
    await prisma.taskTag.create({
      data: { id: uuidv7(), userId: u, taskId: task, tagId: tag, ...protocol },
    });
    await prisma.taskOccurrence.create({
      data: { id: uuidv7(), userId: u, taskId: task, ...protocol },
    });
    await prisma.appliedOp.create({
      data: { opId: uuidv7(), userId: u, status: 'applied' },
    });
    await sessions.start(u);
    await issueResetCode(prisma, u);
  };

  const counts = async (userId: string): Promise<number[]> =>
    Promise.all(
      [
        prisma.task,
        prisma.project,
        prisma.tag,
        prisma.taskTag,
        prisma.taskOccurrence,
        prisma.appliedOp,
        prisma.session,
        prisma.resetCode,
      ].map((model) =>
        (model as { count(a: object): Promise<number> }).count({
          where: { userId },
        }),
      ),
    );

  it('purges the user and everything they own, and nothing of anyone else', async () => {
    const u = await join('b@e.test');
    await seed(u);
    await seed(owner);
    const kept = await counts(owner);
    expect(kept.every((n) => n > 0)).toBe(true);

    await accounts.deleteAccount(u, PASSWORD);

    expect(await prisma.user.findUnique({ where: { id: u } })).toBeNull();
    expect(await counts(u)).toEqual(Array<number>(8).fill(0));
    expect(await counts(owner)).toEqual(kept);
    expect(await prisma.user.count()).toBe(1);
  });

  // A /sync in flight holds this lock and may still insert rows that point at
  // the user; deleting underneath it would 500 that sync on a foreign key.
  it('waits for a transaction holding the per-user write lock', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await lockUserWrites(tx, owner);
        signalLocked();
        await gate;
      },
      { timeout: 10_000 },
    );
    await locked;

    const deleted = accounts.deleteAccount(owner, PASSWORD);
    try {
      const timedOut = Symbol('timed out');
      const raced = await Promise.race([
        deleted.then(() => 'settled' as const),
        new Promise((resolve) => setTimeout(() => resolve(timedOut), 300)),
      ]);
      expect(raced).toBe(timedOut);
    } finally {
      release();
      await holder;
    }

    await expect(deleted).resolves.toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
  });

  it('takes the unspent invitations of a deleted owner with them', async () => {
    const { token } = await accounts.invite(owner);
    await accounts.deleteAccount(owner, PASSWORD);
    expect(await prisma.invitation.count()).toBe(0);
    const fresh = await accounts.register('n@e.test', PASSWORD);
    expect(fresh.owner).toBe(true);
    await expect(
      accounts.register('m@e.test', PASSWORD, token),
    ).rejects.toThrow('invalid invitation');
  });

  it('keeps the owner while another user exists, deletes them alone', async () => {
    const u = await join('b@e.test');
    await expect(accounts.deleteAccount(owner, PASSWORD)).rejects.toThrow(
      'the owner cannot be deleted',
    );
    await accounts.deleteAccount(u, PASSWORD);
    await accounts.deleteAccount(owner, PASSWORD);
    expect(await prisma.user.count()).toBe(0);
  });
});
