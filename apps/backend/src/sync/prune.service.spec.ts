import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoneException, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { PruneService, RETENTION_DAYS } from './prune.service.js';
import { SyncService } from './sync.service.js';
import { lockUserWrites } from './user-lock.js';

const prisma = new PrismaService();
const sync = new SyncService(prisma);
const prune = new PruneService(prisma);
const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await prisma.appliedOp.deleteMany({});
  await prisma.taskTag.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.user.create({
    data: { id: USER, email: 'a@b.c', passwordHash: 'x' },
  });
  await prisma.user.create({
    data: { id: OTHER, email: 'q@r.s', passwordHash: 'x' },
  });
});

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

type Table = 'task' | 'project' | 'tag' | 'task_tag';

function create(table: Table, id: string, fields: Record<string, unknown>) {
  return {
    opId: uuidv7(),
    kind: 'create' as const,
    table,
    id,
    fields,
    ts: new Date().toISOString(),
  };
}

function remove(table: Table, id: string) {
  return {
    opId: uuidv7(),
    kind: 'delete' as const,
    table,
    id,
    baseVersion: 1,
  };
}

/** Deletes rows through the protocol, then backdates the tombstones: the
 *  seq and version come from a real delete, only the age is staged. */
async function age(table: Table, ids: string[], days: number) {
  const where = { id: { in: ids } };
  const data = { deletedAt: daysAgo(days) };
  if (table === 'task') await prisma.task.updateMany({ where, data });
  else if (table === 'project')
    await prisma.project.updateMany({ where, data });
  else if (table === 'tag') await prisma.tag.updateMany({ where, data });
  else await prisma.taskTag.updateMany({ where, data });
}

async function watermark(userId: string): Promise<bigint> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.prunedThroughSeq;
}

describe('PruneService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deletes a tombstone older than the window and raises the watermark to its seq', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', id, { title: 'old', rank: 'a0' }),
        remove('task', id),
      ],
    });
    await age('task', [id], RETENTION_DAYS + 1);
    const { seq } = await prisma.task.findUniqueOrThrow({ where: { id } });

    expect(await prune.prune(new Date())).toBe(1);

    expect(await prisma.task.count({ where: { id } })).toBe(0);
    expect(await watermark(USER)).toBe(seq);
  });

  it('keeps a tombstone younger than the window', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', id, { title: 'recent', rank: 'a0' }),
        remove('task', id),
      ],
    });
    await age('task', [id], RETENTION_DAYS - 1);

    expect(await prune.prune(new Date())).toBe(0);

    expect(await prisma.task.count({ where: { id } })).toBe(1);
    expect(await watermark(USER)).toBe(0n);
  });

  // F13: the window is "older than 90 days" — a strict inequality — so a
  // tombstone exactly at the cutoff has not crossed it yet and stays. `now`
  // is passed to both the backdating and prune(now) so the two agree on
  // exactly where the cutoff sits.
  it('keeps a tombstone exactly at the retention cutoff', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', id, { title: 'boundary', rank: 'a0' }),
        remove('task', id),
      ],
    });
    const now = new Date();
    await prisma.task.updateMany({
      where: { id },
      data: { deletedAt: new Date(now.getTime() - RETENTION_DAYS * DAY) },
    });

    expect(await prune.prune(now)).toBe(0);

    expect(await prisma.task.count({ where: { id } })).toBe(1);
    expect(await watermark(USER)).toBe(0n);
  });

  // Review Focus 2: a foreign key into a tombstone. Deleting it anyway would
  // abort the user's whole pruning transaction on every run.
  it('keeps a tombstone a live row still references, and prunes a parent with its subtask', async () => {
    const project = uuidv7();
    const inProject = uuidv7();
    const parent = uuidv7();
    const child = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('project', project, { name: 'gone', rank: 'a0' }),
        create('task', inProject, {
          title: 'live',
          rank: 'a0',
          projectId: project,
        }),
        create('task', parent, { title: 'parent', rank: 'a0' }),
        create('task', child, { title: 'child', rank: 'a0', parentId: parent }),
        remove('project', project),
        remove('task', child),
        remove('task', parent),
      ],
    });
    await age('project', [project], RETENTION_DAYS + 1);
    await age('task', [parent, child], RETENTION_DAYS + 1);

    expect(await prune.prune(new Date())).toBe(2);

    expect(await prisma.project.count({ where: { id: project } })).toBe(1);
    expect(
      await prisma.task.count({ where: { id: { in: [parent, child] } } }),
    ).toBe(0);
  });

  // ADR 0013 end to end: a client that missed pruned deletions is told, and
  // since 0 brings it back without looping.
  it('makes an older cursor stale and lets since 0 recover', async () => {
    const seed = await sync.sync(USER, {
      since: 0,
      ops: [create('task', uuidv7(), { title: 'live', rank: 'a0' })],
    });
    const id = uuidv7();
    await sync.sync(USER, {
      since: seed.cursor,
      ops: [
        create('task', id, { title: 'old', rank: 'a0' }),
        remove('task', id),
      ],
    });
    await age('task', [id], RETENTION_DAYS + 1);
    await prune.prune(new Date());

    await expect(
      sync.sync(USER, { since: seed.cursor, ops: [] }),
    ).rejects.toBeInstanceOf(GoneException);
    const snapshot = await sync.sync(USER, { since: 0, ops: [] });
    await expect(
      sync.sync(USER, { since: snapshot.cursor, ops: [] }),
    ).resolves.toMatchObject({ changes: [] });
  });

  // Review Focus 4: seq is instance-wide, the watermark is not.
  it('leaves a quiet user’s cursor alone when another user is pruned', async () => {
    const mine = await sync.sync(USER, {
      since: 0,
      ops: [create('task', uuidv7(), { title: 'mine', rank: 'a0' })],
    });
    const theirs = uuidv7();
    await sync.sync(OTHER, {
      since: 0,
      ops: [
        create('task', theirs, { title: 'theirs', rank: 'a0' }),
        remove('task', theirs),
      ],
    });
    await age('task', [theirs], RETENTION_DAYS + 1);

    await prune.prune(new Date());

    expect(await watermark(USER)).toBe(0n);
    await expect(
      sync.sync(USER, { since: mine.cursor, ops: [] }),
    ).resolves.toMatchObject({ cursor: mine.cursor });
  });

  // Review finding 1: children: { none: {} } is what keeps a tombstoned
  // parent whose child is still live. Without it, ON DELETE SET NULL nulls
  // the child's parentId with no seq bump — silent, no re-sync trigger.
  it('keeps a tombstoned parent whose child is still live', async () => {
    const parent = uuidv7();
    const child = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', parent, { title: 'parent', rank: 'a0' }),
        create('task', child, { title: 'child', rank: 'a0', parentId: parent }),
        remove('task', parent),
      ],
    });
    await age('task', [parent], RETENTION_DAYS + 1);

    expect(await prune.prune(new Date())).toBe(0);

    expect(await prisma.task.count({ where: { id: parent } })).toBe(1);
    const childRow = await prisma.task.findUniqueOrThrow({
      where: { id: child },
    });
    expect(childRow.parentId).toBe(parent);
  });

  // Review finding 2: TaskTag.tagId is ON DELETE RESTRICT (unlike
  // Task.projectId/parentId, which are SET NULL) — deleting a referenced tag
  // without the tasks: { none: {} } guard would throw and abort the whole
  // user's run, not just corrupt one row.
  it('keeps a tombstoned tag a live TaskTag still references', async () => {
    const task = uuidv7();
    const tag = uuidv7();
    const taskTag = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', task, { title: 'task', rank: 'a0' }),
        create('tag', tag, { name: 'tag' }),
        create('task_tag', taskTag, { taskId: task, tagId: tag }),
        remove('tag', tag),
      ],
    });
    await age('tag', [tag], RETENTION_DAYS + 1);

    await expect(prune.prune(new Date())).resolves.toBe(0);

    expect(await prisma.tag.count({ where: { id: tag } })).toBe(1);
    expect(await prisma.taskTag.count({ where: { id: taskTag } })).toBe(1);
  });

  // FR-007: the watermark only ever rises. A tombstone pruned in this run
  // must not pull an already-higher watermark back down to its own seq.
  it('never lowers a watermark already ahead of the tombstone it prunes', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', id, { title: 'old', rank: 'a0' }),
        remove('task', id),
      ],
    });
    await age('task', [id], RETENTION_DAYS + 1);
    const { seq } = await prisma.task.findUniqueOrThrow({ where: { id } });
    const ahead = seq + 1000n;
    await prisma.user.update({
      where: { id: USER },
      data: { prunedThroughSeq: ahead },
    });

    expect(await prune.prune(new Date())).toBe(1);

    expect(await watermark(USER)).toBe(ahead);
  });

  // FR-008: each user is pruned under the same per-user write lock as their
  // writes, so a write transaction in flight makes pruning wait rather than
  // run concurrently with it.
  it('waits for a write transaction holding the same user lock', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', id, { title: 'old', rank: 'a0' }),
        remove('task', id),
      ],
    });
    await age('task', [id], RETENTION_DAYS + 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await lockUserWrites(tx, USER);
        await gate;
      },
      { timeout: 10_000 },
    );
    // Give the holder time to actually acquire the advisory lock before
    // racing prune against it.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pruned = prune.prune(new Date());
    try {
      const timedOut = Symbol('timed out');
      const raced = await Promise.race([
        pruned.then(() => 'settled' as const),
        new Promise((resolve) => setTimeout(() => resolve(timedOut), 200)),
      ]);
      expect(raced).toBe(timedOut);
    } finally {
      release();
      await holder;
    }

    await expect(pruned).resolves.toBe(1);
  });

  // FR-005: all four synchronised tables are pruned, not just task. An
  // unreferenced tombstone of each must go in one run.
  it('prunes old unreferenced tombstones of every table, not just task', async () => {
    const project = uuidv7();
    const tag = uuidv7();
    const task = uuidv7();
    const taskTag = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('project', project, { name: 'gone', rank: 'a0' }),
        create('tag', tag, { name: 'gone' }),
        create('task', task, { title: 'gone', rank: 'a0' }),
        create('task_tag', taskTag, { taskId: task, tagId: tag }),
        remove('task_tag', taskTag),
        remove('tag', tag),
        remove('task', task),
        remove('project', project),
      ],
    });
    await age('task_tag', [taskTag], RETENTION_DAYS + 1);
    await age('tag', [tag], RETENTION_DAYS + 1);
    await age('task', [task], RETENTION_DAYS + 1);
    await age('project', [project], RETENTION_DAYS + 1);

    expect(await prune.prune(new Date())).toBe(4);

    expect(await prisma.taskTag.count({ where: { id: taskTag } })).toBe(0);
    expect(await prisma.tag.count({ where: { id: tag } })).toBe(0);
    expect(await prisma.task.count({ where: { id: task } })).toBe(0);
    expect(await prisma.project.count({ where: { id: project } })).toBe(0);
  });

  // F12: one user's pruning failing must not stop every other user's from
  // running — today it does, for good, on every run, because nothing in
  // prune()'s loop catches it. The failing user is chosen by id, not by
  // iteration position, since findMany's row order is not something this
  // test controls.
  it('keeps pruning other users when one of them fails', async () => {
    const failing = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', failing, { title: 'boom', rank: 'a0' }),
        remove('task', failing),
      ],
    });
    await age('task', [failing], RETENTION_DAYS + 1);

    const ok = uuidv7();
    await sync.sync(OTHER, {
      since: 0,
      ops: [
        create('task', ok, { title: 'fine', rank: 'a0' }),
        remove('task', ok),
      ],
    });
    await age('task', [ok], RETENTION_DAYS + 1);
    const { seq } = await prisma.task.findUniqueOrThrow({ where: { id: ok } });

    const sabotaged = prisma.$extends({
      query: {
        taskTag: {
          aggregate({ args, query }) {
            const where = args.where as { userId?: string } | undefined;
            if (where?.userId === USER) {
              return Promise.reject(new Error('simulated pruning failure'));
            }
            return query(args);
          },
        },
      },
    });
    const flaky = new PruneService(sabotaged as unknown as PrismaService);
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(flaky.prune(new Date())).resolves.toBe(1);

    expect(await prisma.task.count({ where: { id: ok } })).toBe(0);
    expect(await watermark(OTHER)).toBe(seq);
    // The failing user's tombstone is untouched, and the failure was logged
    // with enough to find it — the user id and the error itself.
    expect(await prisma.task.count({ where: { id: failing } })).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(USER, expect.any(Error));
  });

  it('prunes at startup and once a day after that', () => {
    vi.useFakeTimers();
    const service = new PruneService(prisma);
    const run = vi.spyOn(service, 'prune').mockResolvedValue(0);

    service.onApplicationBootstrap();
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DAY);
    expect(run).toHaveBeenCalledTimes(2);

    service.onApplicationShutdown();
    vi.advanceTimersByTime(DAY);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // F16: onApplicationBootstrap fires prune() without awaiting it — a
  // rejection with no .catch is an unhandled rejection, and Node's default
  // for one of those is to crash the process. It must be caught, logged,
  // and never thrown back out of bootstrap itself.
  it('logs a bootstrap pruning failure instead of throwing or leaving it unhandled', async () => {
    const service = new PruneService(prisma);
    vi.spyOn(service, 'prune').mockRejectedValue(
      new Error('simulated bootstrap failure'),
    );
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));

    service.onApplicationShutdown();
  });
});
