import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SyncService } from './sync.service.js';

const prisma = new PrismaService();
const service = new SyncService(prisma);
// User.id is @db.Uuid — the brief's '0192-user' shorthand (borrowed from
// apply-op.spec.ts, which never touches Postgres) does not parse as one.
const USER = '11111111-1111-1111-1111-111111111111';

beforeEach(async () => {
  // taskTag/task/project/tag before user: userId is ON DELETE RESTRICT on
  // every one of them, so a leftover row from an earlier test would block
  // deleting the user that owned it.
  await prisma.appliedOp.deleteMany({});
  await prisma.taskTag.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.tag.deleteMany({});
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

  // C2: seq is a BigInt on every row Prisma returns, and BigInt has no
  // JSON.stringify representation — the first sync works, every pull after
  // it 500s the moment a controller actually calls res.json() on it.
  it('serializes the response as JSON and never exposes server bookkeeping in a row', async () => {
    const op = createTask('serializable');
    await service.sync(USER, { since: 0, ops: [op] });
    const pull = await service.sync(USER, { since: 0, ops: [] });

    expect(() => JSON.stringify(pull)).not.toThrow();
    const change = pull.changes.find((c) => c.id === op.id);
    expect(change?.row).not.toHaveProperty('userId');
    expect(change?.row).not.toHaveProperty('createdAt');
    expect(change?.row).not.toHaveProperty('updatedAt');
    expect(change?.row).not.toHaveProperty('seq');
  });

  // C1, part 1: a field that is not a column must be rejected before it
  // ever reaches Prisma — applyOp has no idea what the schema is, so this is
  // a check the service owes, not the conflict engine.
  it('rejects a field that is not a column, without touching the database', async () => {
    const bogus = {
      opId: uuidv7(), kind: 'create' as const, table: 'task' as const,
      id: uuidv7(), fields: { title: 'x', sneaky: 'nope' },
      ts: new Date().toISOString(),
    };

    const result = await service.sync(USER, { since: 0, ops: [bogus] });

    expect(result.results[0]).toMatchObject({ status: 'rejected' });
    expect(await prisma.task.count({ where: { id: bogus.id } })).toBe(0);
  });

  // C1, part 2: a Prisma error (here, a foreign key pointing at a project
  // that does not exist) must reject only the operation that caused it. The
  // transaction it happened in rolls back in full — neither the row nor the
  // appliedOp record survive — and the rest of the batch still applies.
  //
  // M2: appliedOp is now written *before* the row write, in the same
  // transaction, specifically so this failure (which fires during the row
  // write) happens after a real appliedOp insert. If that write were moved
  // out of the transaction — its own statement, run unconditionally before
  // or after — it would already have committed independently by the time
  // the row write fails here, and `appliedOp.count` below would see it.
  it('rejects an operation Prisma refuses, and still applies the rest of the batch', async () => {
    const bad = {
      opId: uuidv7(), kind: 'create' as const, table: 'task' as const,
      id: uuidv7(), fields: { title: 'orphaned', rank: 'a0', projectId: uuidv7() },
      ts: new Date().toISOString(),
    };
    const good = createTask('unrelated');

    const { results } = await service.sync(USER, { since: 0, ops: [bad, good] });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'applied' });
    expect(await prisma.task.count({ where: { id: bad.id } })).toBe(0);
    expect(await prisma.appliedOp.count({ where: { opId: bad.opId } })).toBe(0);
    expect(await prisma.task.count({ where: { id: good.id } })).toBe(1);
  });

  it('applies a batch of several operations, aligning results to their operations', async () => {
    const ops = [createTask('one'), createTask('two'), createTask('three')];

    const { results } = await service.sync(USER, { since: 0, ops });

    expect(results.map((r) => r.opId)).toEqual(ops.map((o) => o.opId));
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(await prisma.task.count({ where: { userId: USER } })).toBe(3);
  });

  // M3: both the correct path and a findFirst that dropped its userId
  // scope end in `rejected` here, so `status` alone cannot tell them apart
  // — a findFirst that ignored userId would resolve `current` to the real
  // row and let applyOp proceed to 'applied', which the update's own
  // userId scope (a separate defense) then turns into a Prisma
  // "record not found" and a *different*, generic reason. Asserting the
  // specific reason is what makes this test see that difference instead of
  // reading as coverage while passing either way.
  it('does not let one user modify another user’s row', async () => {
    const op = createTask('mine');
    await service.sync(USER, { since: 0, ops: [op] });

    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'x@y.z', passwordHash: 'x' },
    });
    const hijack = {
      opId: uuidv7(), kind: 'set' as const, table: 'task' as const,
      id: op.id, field: 'title', value: 'hijacked', ts: new Date().toISOString(),
    };

    const result = await service.sync(OTHER, { since: 0, ops: [hijack] });

    expect(result.results[0]).toMatchObject({ status: 'rejected', reason: 'no such row' });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: op.id } })).title).toBe('mine');
  });

  it('surfaces conflict, superseded and rejected through the service', async () => {
    const op = createTask('base');
    await service.sync(USER, { since: 0, ops: [op] });

    const stale = {
      opId: uuidv7(), kind: 'set' as const, table: 'task' as const,
      id: op.id, field: 'title', value: 'stale',
      ts: new Date(Date.now() - 60_000).toISOString(),
    };
    const conflictOp = {
      opId: uuidv7(), kind: 'delete' as const, table: 'task' as const,
      id: op.id, baseVersion: 99,
    };
    const dupCreate = { ...op, opId: uuidv7() };

    const { results } = await service.sync(USER, { since: 0, ops: [stale, conflictOp, dupCreate] });

    expect(results[0]).toMatchObject({ status: 'superseded' });
    expect(results[1]).toMatchObject({ status: 'conflict', currentVersion: 1 });
    expect(results[2]).toMatchObject({ status: 'rejected' });
  });

  // C3/M6: TABLES iterates task before project, so a project created before
  // a task gives project the *lower* seq while still landing second in the
  // per-table scan order. Only changesSince's final sort can put it first
  // — creating task before project here would let a missing (or reverted)
  // sort go unnoticed, since insertion order would already be ascending.
  it('orders changes by seq across two different tables in one pull', async () => {
    const project = {
      opId: uuidv7(), kind: 'create' as const, table: 'project' as const,
      id: uuidv7(), fields: { name: 'first', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    const task = createTask('second');

    await service.sync(USER, { since: 0, ops: [project, task] });
    const pull = await service.sync(USER, { since: 0, ops: [] });

    const relevant = pull.changes.filter((c) => c.id === task.id || c.id === project.id);
    expect(relevant.map((c) => c.table)).toEqual(['project', 'task']);
    expect(relevant[0]!.seq).toBeLessThan(relevant[1]!.seq);
  });

  // I5: a redelivered op that never actually mutated anything (conflict,
  // rejected, superseded) must replay its real outcome, not a bare
  // "duplicate" — the client's outbox rule drops "duplicate" silently, the
  // same as "applied", so a masked conflict would make the client believe
  // an edit went through that never did.
  it('replays a redelivered conflict rather than reporting a bare duplicate', async () => {
    const op = createTask('for conflict');
    await service.sync(USER, { since: 0, ops: [op] });

    const del = {
      opId: uuidv7(), kind: 'delete' as const, table: 'task' as const,
      id: op.id, baseVersion: 99,
    };
    const first = await service.sync(USER, { since: 0, ops: [del] });
    const again = await service.sync(USER, { since: 0, ops: [del] });

    expect(first.results[0]).toMatchObject({ status: 'conflict', currentVersion: 1 });
    expect(again.results[0]).toMatchObject({ status: 'conflict', currentVersion: 1 });
  });

  // M8: pins the cursor formula itself. change_seq is not transactional, so
  // reading it directly (the round-2 formula) always reflects at least the
  // live global position — including another user's unrelated write — even
  // on a pull that returns nothing for this user at all. The cursor must
  // come from what the scans actually delivered.
  it('does not advance the cursor past since when a pull returns nothing', async () => {
    const OTHER = '33333333-3333-3333-3333-333333333333';
    await prisma.user.create({ data: { id: OTHER, email: 'q@r.s', passwordHash: 'x' } });
    await service.sync(OTHER, { since: 0, ops: [createTask('theirs, not mine')] });

    const pull = await service.sync(USER, { since: 0, ops: [] });

    expect(pull.changes).toHaveLength(0);
    expect(pull.cursor).toBe(0);
  });

  // Project.archivedAt is in the schema and the design doc's ER diagram,
  // and POST /sync is the only write path — it fell out of the allow-list
  // when the allow-list was introduced, which made archiving a project
  // impossible.
  it('lets a project be archived', async () => {
    const create = {
      opId: uuidv7(), kind: 'create' as const, table: 'project' as const,
      id: uuidv7(), fields: { name: 'old work', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, { since: 0, ops: [create] });

    const archive = {
      opId: uuidv7(), kind: 'set' as const, table: 'project' as const,
      id: create.id, field: 'archivedAt', value: new Date().toISOString(),
      ts: new Date().toISOString(),
    };
    const result = await service.sync(USER, { since: 0, ops: [archive] });

    expect(result.results[0]).toMatchObject({ status: 'applied' });
  });

  // A value Prisma's own input validation rejects reaches this path from
  // the wire: the contract's `value` is untyped and `WRITABLE_FIELDS`
  // checks column names, not value types. This must be an honest
  // `rejected` — retrying with the same string will fail the same way —
  // and, per C1, the rest of the batch must still apply.
  it('rejects a value Prisma refuses on its own terms, and still applies the rest of the batch', async () => {
    const op = createTask('base');
    await service.sync(USER, { since: 0, ops: [op] });

    const badValue = {
      opId: uuidv7(), kind: 'set' as const, table: 'task' as const,
      id: op.id, field: 'priority', value: 'high', ts: new Date().toISOString(),
    };
    const good = createTask('unrelated');

    const { results } = await service.sync(USER, { since: 0, ops: [badValue, good] });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'applied' });
  });

  // A retryable Prisma error (a transaction timeout, a deadlock) is not
  // the data's fault, so it must not become `rejected` — it has to escape
  // as a 5xx the client's transport retries. Injected through the same
  // $extends seam M9 below uses: no test-only code in production, a real
  // error class instance, and it is visible to $transaction's tx because
  // query extensions propagate into interactive transactions (verified
  // directly against this Prisma version before relying on it here).
  it('rethrows a retryable Prisma error instead of reporting it as rejected', async () => {
    const flakyPrisma = prisma.$extends({
      query: {
        task: {
          async create() {
            throw new Prisma.PrismaClientKnownRequestError('simulated transaction timeout', {
              code: 'P2028',
              clientVersion: Prisma.prismaVersion.client,
            });
          },
        },
      },
    });
    const flaky = new SyncService(flakyPrisma as unknown as PrismaService);

    const op = createTask('times out');

    await expect(flaky.sync(USER, { since: 0, ops: [op] })).rejects.toThrow();
    // Rolled back before appliedOp too — a retry gets a clean second try,
    // not a `duplicate`.
    expect(await prisma.appliedOp.count({ where: { opId: op.opId } })).toBe(0);
  });

  // M9: pins RepeatableRead by constructing the actual race — a write
  // landing between two of changesSince's four per-table scans — rather
  // than reviewing that the option is set. `prisma.$extends` pauses the
  // first scan (task) after it starts, a second, genuinely concurrent
  // connection (the module-level `service`, which checks out its own
  // connection from the same pool since the first is held by the paused
  // transaction) commits a project row, and the pause is released. Under
  // RepeatableRead the transaction's snapshot was already fixed by that
  // first query, so the project scan — running after the concurrent
  // commit landed, but inside the same old snapshot — must not see it.
  it('keeps a pull snapshot-consistent against a write landing mid-scan', async () => {
    let releaseProjectScan!: () => void;
    let projectScanReached!: () => void;
    const projectScanReachedPromise = new Promise<void>((resolve) => {
      projectScanReached = resolve;
    });
    const releaseProjectScanPromise = new Promise<void>((resolve) => {
      releaseProjectScan = resolve;
    });

    // Pausing task.findMany itself (TABLES' first table, and this
    // transaction's first query) would pause it *before* Postgres ever
    // sees the query — REPEATABLE READ fixes its snapshot at the first
    // query it actually runs, not at the first one Prisma queues, so
    // pausing there let the concurrent write land before the snapshot was
    // fixed at all (confirmed: that shape of this test failed). Pausing
    // the *second* table's scan instead lets task's query complete
    // normally — fixing the snapshot — and only then holds the line
    // before project's query is issued.
    const pausedPrisma = prisma.$extends({
      query: {
        project: {
          async findMany({ args, query }) {
            projectScanReached();
            await releaseProjectScanPromise;
            return query(args);
          },
        },
      },
    });
    const paused = new SyncService(pausedPrisma as unknown as PrismaService);

    const pullPromise = paused.sync(USER, { since: 0, ops: [] });
    await projectScanReachedPromise;

    // A genuinely concurrent write, on a different pooled connection,
    // committing after the paused transaction's snapshot was already
    // fixed (by its completed task scan) but before its project scan runs.
    const project = {
      opId: uuidv7(), kind: 'create' as const, table: 'project' as const,
      id: uuidv7(), fields: { name: 'landed mid-scan', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, { since: 0, ops: [project] });

    releaseProjectScan();
    const pull = await pullPromise;

    expect(pull.changes.map((c) => c.id)).not.toContain(project.id);
  });

  // M10: not pinned even with the concurrency technique above available,
  // and for a different reason than M9 was — this isn't a tooling gap.
  // Task.id (and every other table's id) is a global primary key, so
  // `update({ where: { id } })` and `update({ where: { id, userId } })`
  // resolve to the exact same row whenever `current` was already found
  // through a correctly userId-scoped findFirst. Nothing in this protocol
  // ever changes which user owns an existing row — there is no operation
  // that reassigns one — so there is no concurrent write to race against
  // that would make the two where-clauses diverge. The clause is real
  // defense in depth (it stops relying on findFirst's scope alone), but by
  // itself, in this system, it is inert. It only diverges in combination
  // with M3 — which the M3 test above does catch: reverting both together
  // turns the cross-user `set` from `rejected` into a silent `applied`
  // that overwrites the other user's row, and that test's reason
  // assertion fails.
});
