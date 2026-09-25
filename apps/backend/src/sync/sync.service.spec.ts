import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { PrismaService } from '../prisma/prisma.service.js';
import { SyncService } from './sync.service.js';

const prisma = new PrismaService();
const service = new SyncService(prisma);
// User.id is @db.Uuid — the brief's '0192-user' shorthand (borrowed from
// apply-op.spec.ts, which never touches Postgres) does not parse as one.
const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(async () => {
  await prisma.appliedOp.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.user.create({
    data: { id: USER, email: 'a@b.c', passwordHash: 'x' },
  });
});

function createTask(title: string) {
  return {
    opId: uuidv7(), kind: 'create' as const, table: 'task' as const,
    id: uuidv7(), fields: { title, rank: 'a0' },
    ts: new Date().toISOString(),
  };
}

describe('SyncService', () => {
  it('applies a create and returns it in the next pull', async () => {
    const op = createTask('call the bank');

    const first = await service.sync(USER, { since: 0, ops: [op] });
    expect(first.results[0]?.status).toBe('applied');

    const second = await service.sync(USER, { since: 0, ops: [] });
    expect(second.changes.map((c) => c.id)).toContain(op.id);
  });

  // Review Focus 1: a client retries after a lost response.
  it('treats a redelivered batch as a duplicate, not a second create', async () => {
    const op = createTask('call the bank');

    await service.sync(USER, { since: 0, ops: [op] });
    const again = await service.sync(USER, { since: 0, ops: [op] });

    expect(again.results[0]?.status).toBe('duplicate');
    expect(await prisma.task.count({ where: { userId: USER } })).toBe(1);
  });

  it('advances the cursor so a second pull returns nothing new', async () => {
    const first = await service.sync(USER, { since: 0, ops: [createTask('a')] });
    const second = await service.sync(USER, { since: first.cursor, ops: [] });

    expect(second.changes).toHaveLength(0);
    expect(second.cursor).toBeGreaterThanOrEqual(first.cursor);
  });

  it('returns a tombstone rather than dropping a deleted row', async () => {
    const op = createTask('doomed');
    const created = await service.sync(USER, { since: 0, ops: [op] });

    const del = {
      opId: uuidv7(), kind: 'delete' as const, table: 'task' as const,
      id: op.id, baseVersion: 1,
    };
    await service.sync(USER, { since: created.cursor, ops: [del] });

    const pull = await service.sync(USER, { since: created.cursor, ops: [] });
    const change = pull.changes.find((c) => c.id === op.id);
    expect(change?.row.deletedAt).not.toBeNull();
  });

  // Review Focus 5: `since` is client-supplied and reaches a SQL comparison.
  it('rejects a negative cursor instead of passing it to the database', async () => {
    await expect(service.sync(USER, { since: -1, ops: [] })).rejects.toThrow();
  });

  it('never returns another user’s rows', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'x@y.z', passwordHash: 'x' },
    });
    const theirs = createTask('not yours');
    await service.sync(OTHER, { since: 0, ops: [theirs] });

    const mine = await service.sync(USER, { since: 0, ops: [] });
    expect(mine.changes.map((c) => c.id)).not.toContain(theirs.id);
  });
});
