import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoneException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { PruneService, RETENTION_DAYS } from './prune.service.js';
import { SyncService } from './sync.service.js';

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

function create(
  table: 'task' | 'project',
  id: string,
  fields: Record<string, unknown>,
) {
  return {
    opId: uuidv7(),
    kind: 'create' as const,
    table,
    id,
    fields,
    ts: new Date().toISOString(),
  };
}

function remove(table: 'task' | 'project', id: string) {
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
async function age(table: 'task' | 'project', ids: string[], days: number) {
  const where = { id: { in: ids } };
  const data = { deletedAt: daysAgo(days) };
  if (table === 'task') await prisma.task.updateMany({ where, data });
  else await prisma.project.updateMany({ where, data });
}

async function watermark(userId: string): Promise<bigint> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return user.prunedThroughSeq;
}

describe('PruneService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes a tombstone older than the window and raises the watermark to its seq', async () => {
    const id = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [create('task', id, { title: 'old', rank: 'a0' }), remove('task', id)],
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
      ops: [create('task', id, { title: 'recent', rank: 'a0' }), remove('task', id)],
    });
    await age('task', [id], RETENTION_DAYS - 1);

    expect(await prune.prune(new Date())).toBe(0);

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
        create('task', inProject, { title: 'live', rank: 'a0', projectId: project }),
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
    expect(await prisma.task.count({ where: { id: { in: [parent, child] } } })).toBe(0);
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
      ops: [create('task', id, { title: 'old', rank: 'a0' }), remove('task', id)],
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
      ops: [create('task', theirs, { title: 'theirs', rank: 'a0' }), remove('task', theirs)],
    });
    await age('task', [theirs], RETENTION_DAYS + 1);

    await prune.prune(new Date());

    expect(await watermark(USER)).toBe(0n);
    await expect(
      sync.sync(USER, { since: mine.cursor, ops: [] }),
    ).resolves.toMatchObject({ cursor: mine.cursor });
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
});
