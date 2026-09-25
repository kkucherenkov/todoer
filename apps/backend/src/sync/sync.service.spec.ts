import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
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
    opId: uuidv7(),
    kind: 'create' as const,
    table: 'task' as const,
    id: uuidv7(),
    fields: { title, rank: 'a0' },
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
    const first = await service.sync(USER, {
      since: 0,
      ops: [createTask('a')],
    });
    const second = await service.sync(USER, { since: first.cursor, ops: [] });

    expect(second.changes).toHaveLength(0);
    expect(second.cursor).toBeGreaterThanOrEqual(first.cursor);
  });

  // Two levels is the whole hierarchy the design allows (project → task →
  // subtask), and a task that is its own parent is not a level at all: it is
  // a cycle that every future tree walk — a cascade delete, "complete
  // subtasks", a tree view — has to survive. `create` was already safe by
  // accident (the parent row does not exist yet, so the ownership check
  // rejects it); `set parentId` was not.
  it('refuses to make a task its own parent', async () => {
    const op = createTask('ouroboros');
    const created = await service.sync(USER, { since: 0, ops: [op] });

    const selfParent = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: op.id,
      field: 'parentId',
      value: op.id,
      ts: new Date().toISOString(),
    };
    // The invariant: no row can carry itself as its parent, on any write path
    // there will ever be. Two things hold it, and they are not redundant —
    // the CHECK constraint (the 20260925200000 migration) holds it for paths
    // that do not exist yet, and applyOp's rule holds it for *this* one, which
    // is what lets the refusal reach the client as this operation's own
    // `rejected` with a reason rather than as an opaque constraint error that
    // fails the whole batch.
    const { results } = await service.sync(USER, {
      since: created.cursor,
      ops: [selfParent],
    });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[0]?.reason).toMatch(/own parent/i);

    const row = await prisma.task.findUnique({ where: { id: op.id } });
    expect(row?.parentId).toBeNull();
  });

  // M17: the design allows exactly two levels, project → task → subtask, so
  // the rule is that a parent must not itself have a parent. The test that
  // matters is the third level: setting a parent on a *top-level* task passes
  // with or without the rule.
  it('refuses a third level in the task tree', async () => {
    const grandparent = createTask('grandparent');
    const parent = createTask('parent');
    const child = createTask('child');
    await service.sync(USER, { since: 0, ops: [grandparent, parent, child] });

    const secondLevel = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: parent.id,
      field: 'parentId',
      value: grandparent.id,
      ts: new Date().toISOString(),
    };
    const thirdLevel = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: child.id,
      field: 'parentId',
      value: parent.id,
      ts: new Date().toISOString(),
    };

    // A positive control in the same batch, so the rule cannot pass by
    // refusing every parent: a `create` that lands directly under a
    // top-level task is the second level, which is legal.
    const secondLevelCreate = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task' as const,
      id: uuidv7(),
      fields: { title: 'subtask', rank: 'a1', parentId: grandparent.id },
      ts: new Date().toISOString(),
    };

    const { results } = await service.sync(USER, {
      since: 0,
      ops: [secondLevel, thirdLevel, secondLevelCreate],
    });

    expect(results[0]).toMatchObject({ status: 'applied' });
    expect(results[1]).toMatchObject({ status: 'rejected' });
    expect(results[1]?.reason).toMatch(/no parent of its own/i);
    expect(results[2]).toMatchObject({ status: 'applied' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: child.id } }))
        .parentId,
    ).toBeNull();
  });

  // M17: the same one check closes every cycle, which is why it is worth
  // more than a depth rule looks. A two-node cycle needs *both* rows to have
  // a parent, and the second edge is refused because the row it would point
  // at already has one. No cycle detection, no recursive query.
  it('refuses a two-task cycle', async () => {
    const a = createTask('a');
    const b = createTask('b');
    await service.sync(USER, { since: 0, ops: [a, b] });

    const aUnderB = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: a.id,
      field: 'parentId',
      value: b.id,
      ts: new Date().toISOString(),
    };
    const bUnderA = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: b.id,
      field: 'parentId',
      value: a.id,
      ts: new Date().toISOString(),
    };

    const { results } = await service.sync(USER, {
      since: 0,
      ops: [aUnderB, bUnderA],
    });

    expect(results[0]).toMatchObject({ status: 'applied' });
    expect(results[1]).toMatchObject({ status: 'rejected' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).parentId,
    ).toBeNull();
  });

  // M17: the CHECK constraint stays as defence in depth, so what it does to
  // a client still matters. Postgres reports a check violation as SQLSTATE
  // 23514, which Prisma raises as PrismaClientUnknownRequestError — no
  // P-code at all — and isRetryable defaults an unrecognised class to
  // retryable, so a permanent, deterministic refusal escaped as a 5xx the
  // client was invited to retry forever.
  //
  // The violation is staged the only honest way left now that applyOp
  // refuses a self-parent upstream: a $extends seam rewrites the row write
  // to the shape the constraint forbids, standing in for the future write
  // path the constraint exists for. The error object is Postgres's real one,
  // not a hand-built instance, which is what makes this test see a change in
  // how Prisma reports it.
  it('reports a check-constraint violation as a rejected operation, not a 5xx', async () => {
    const parent = createTask('parent');
    const orphan = createTask('orphan');
    await service.sync(USER, { since: 0, ops: [parent, orphan] });

    const sabotaged = prisma.$extends({
      query: {
        task: {
          async update({ args, query }) {
            const where = args.where as { id?: string };
            return query({
              ...args,
              data: { ...args.data, parentId: where.id } as typeof args.data,
            });
          },
        },
      },
    });
    const service2 = new SyncService(sabotaged as unknown as PrismaService);

    const legal = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: orphan.id,
      field: 'parentId',
      value: parent.id,
      ts: new Date().toISOString(),
    };

    const { results } = await service2.sync(USER, { since: 0, ops: [legal] });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: orphan.id } }))
        .parentId,
    ).toBeNull();
    // Rolled back with the row write, so a client that fixes the operation
    // and retries is not answered with a duplicate of a rejection.
    expect(await prisma.appliedOp.count({ where: { opId: legal.opId } })).toBe(
      0,
    );
  });

  it('returns a tombstone rather than dropping a deleted row', async () => {
    const op = createTask('doomed');
    const created = await service.sync(USER, { since: 0, ops: [op] });

    const del = {
      opId: uuidv7(),
      kind: 'delete' as const,
      table: 'task' as const,
      id: op.id,
      baseVersion: 1,
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
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task' as const,
      id: uuidv7(),
      fields: { title: 'x', sneaky: 'nope' },
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
    // The trigger is a create whose id already belongs to *another* account:
    // this user's scoped read finds nothing, applyOp says applied, and
    // Postgres refuses the insert on the primary key. It has to be a
    // collision across accounts — within one account applyOp rejects it
    // before Prisma is ever reached. This test's earlier trigger (a
    // projectId pointing at a project that does not exist) no longer
    // reaches Prisma at all: I9's ownership check refuses it first, which is
    // a *recorded* rejection rather than a rolled-back transaction, so it
    // can no longer prove what the appliedOp assertion below is here for.
    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'x@y.z', passwordHash: 'x' },
    });
    const theirs = createTask('theirs');
    await service.sync(OTHER, { since: 0, ops: [theirs] });

    const bad = { ...createTask('collides'), id: theirs.id };
    const good = createTask('unrelated');

    const { results } = await service.sync(USER, {
      since: 0,
      ops: [bad, good],
    });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'applied' });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: bad.id } })).title,
    ).toBe('theirs');
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
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: op.id,
      field: 'title',
      value: 'hijacked',
      ts: new Date().toISOString(),
    };

    const result = await service.sync(OTHER, { since: 0, ops: [hijack] });

    expect(result.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'no such row',
    });
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: op.id } })).title,
    ).toBe('mine');
  });

  it('surfaces conflict, superseded and rejected through the service', async () => {
    const op = createTask('base');
    await service.sync(USER, { since: 0, ops: [op] });

    const stale = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: op.id,
      field: 'title',
      value: 'stale',
      ts: new Date(Date.now() - 60_000).toISOString(),
    };
    const conflictOp = {
      opId: uuidv7(),
      kind: 'delete' as const,
      table: 'task' as const,
      id: op.id,
      baseVersion: 99,
    };
    const dupCreate = { ...op, opId: uuidv7() };

    const { results } = await service.sync(USER, {
      since: 0,
      ops: [stale, conflictOp, dupCreate],
    });

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
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'project' as const,
      id: uuidv7(),
      fields: { name: 'first', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    const task = createTask('second');

    await service.sync(USER, { since: 0, ops: [project, task] });
    const pull = await service.sync(USER, { since: 0, ops: [] });

    const relevant = pull.changes.filter(
      (c) => c.id === task.id || c.id === project.id,
    );
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
      opId: uuidv7(),
      kind: 'delete' as const,
      table: 'task' as const,
      id: op.id,
      baseVersion: 99,
    };
    const first = await service.sync(USER, { since: 0, ops: [del] });
    const again = await service.sync(USER, { since: 0, ops: [del] });

    expect(first.results[0]).toMatchObject({
      status: 'conflict',
      currentVersion: 1,
    });
    expect(again.results[0]).toMatchObject({
      status: 'conflict',
      currentVersion: 1,
    });
  });

  // M8: pins the cursor formula itself. change_seq is not transactional, so
  // reading it directly (the round-2 formula) always reflects at least the
  // live global position — including another user's unrelated write — even
  // on a pull that returns nothing for this user at all. The cursor must
  // come from what the scans actually delivered.
  it('does not advance the cursor past since when a pull returns nothing', async () => {
    const OTHER = '33333333-3333-3333-3333-333333333333';
    await prisma.user.create({
      data: { id: OTHER, email: 'q@r.s', passwordHash: 'x' },
    });
    await service.sync(OTHER, {
      since: 0,
      ops: [createTask('theirs, not mine')],
    });

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
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'project' as const,
      id: uuidv7(),
      fields: { name: 'old work', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, { since: 0, ops: [create] });

    const archive = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'project' as const,
      id: create.id,
      field: 'archivedAt',
      value: new Date().toISOString(),
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
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: op.id,
      field: 'priority',
      value: 'high',
      ts: new Date().toISOString(),
    };
    const good = createTask('unrelated');

    const { results } = await service.sync(USER, {
      since: 0,
      ops: [badValue, good],
    });

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
            throw new Prisma.PrismaClientKnownRequestError(
              'simulated transaction timeout',
              {
                code: 'P2028',
                clientVersion: Prisma.prismaVersion.client,
              },
            );
          },
        },
      },
    });
    const flaky = new SyncService(flakyPrisma as unknown as PrismaService);

    const op = createTask('times out');

    await expect(flaky.sync(USER, { since: 0, ops: [op] })).rejects.toThrow(
      'simulated transaction timeout',
    );
    // Rolled back before appliedOp too — a retry gets a clean second try,
    // not a `duplicate`.
    expect(await prisma.appliedOp.count({ where: { opId: op.opId } })).toBe(0);
  });

  // M9: pins RepeatableRead by constructing the actual race — a write
  // landing between two of changesSince's four per-table scans — rather
  // than reviewing that the option is set. `prisma.$extends` pauses the
  // *second* scan (project), after the first (task) has already run and
  // fixed the transaction's snapshot; a second, genuinely concurrent
  // connection (the module-level `service`, which checks out its own
  // connection from the same pool since the first is held by the paused
  // transaction) commits a project row, and the pause is released. Under
  // RepeatableRead the snapshot was already fixed before that commit
  // landed, so the project scan — running after it, but inside the old
  // snapshot — must not see it.
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

    try {
      // A genuinely concurrent write, on a different pooled connection,
      // committing after the paused transaction's snapshot was already
      // fixed (by its completed task scan) but before its project scan
      // runs. Asserted as `applied` — a positive control: without it, a
      // future change that made this write silently fail (a narrower
      // allow-list, a schema change) would leave `pull.changes` empty for
      // an unrelated reason, and the negative assertion below would stay
      // green while testing nothing.
      const project = {
        opId: uuidv7(),
        kind: 'create' as const,
        table: 'project' as const,
        id: uuidv7(),
        fields: { name: 'landed mid-scan', rank: 'a0' },
        ts: new Date().toISOString(),
      };
      const written = await service.sync(USER, { since: 0, ops: [project] });
      expect(written.results[0]).toMatchObject({ status: 'applied' });

      // A second control: a fresh, unpaused pull after the write proves
      // the row really was there to be missed, not merely that this
      // user's changes happen to be empty.
      const freshPull = await service.sync(USER, { since: 0, ops: [] });
      expect(freshPull.changes.map((c) => c.id)).toContain(project.id);

      releaseProjectScan();
      const pull = await pullPromise;

      expect(pull.changes.map((c) => c.id)).not.toContain(project.id);
    } finally {
      // Releases even if an assertion above throws — otherwise a failure
      // here leaves the paused interactive transaction open until Prisma's
      // own transaction timeout, rather than failing this test promptly.
      releaseProjectScan();
    }
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

  // C1: two `set` operations on different fields of one row, genuinely
  // overlapping. Sequential arrival — in order or out of it — cannot show
  // this: what the loser loses is not a timestamp comparison but a whole row
  // written back from a snapshot taken before the winner committed, `fieldTs`
  // included, so the row ends up carrying the new timestamp against the old
  // value and no later last-write-wins comparison can repair it.
  //
  // Staged rather than raced, so it does not depend on scheduling: `clientA`
  // pauses inside its transaction right after reading the row, and `clientB`
  // releases it from the first statement of its own transaction — the dedup
  // lookup, which is the one query both the locked and the unlocked code run
  // before touching the row. Without the row lock that leaves B reading while
  // A still has four round trips to go, so B writes back a snapshot with none
  // of A's edit in it; with the lock, B's read waits for A to commit.
  it('keeps both fields when two concurrent sets touch different fields of one row', async () => {
    const create = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task' as const,
      id: uuidv7(),
      fields: { title: 'T0', notes: 'N0', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, { since: 0, ops: [create] });

    let releaseA!: () => void;
    const aMayWrite = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aHasRead!: () => void;
    const aHasReadPromise = new Promise<void>((resolve) => {
      aHasRead = resolve;
    });

    const clientA = prisma.$extends({
      query: {
        task: {
          async findFirst({ args, query }) {
            const row = await query(args);
            aHasRead();
            await aMayWrite;
            return row;
          },
        },
      },
    });
    const clientB = prisma.$extends({
      query: {
        appliedOp: {
          async findUnique({ args, query }) {
            releaseA();
            return query(args);
          },
        },
      },
    });
    const a = new SyncService(clientA as unknown as PrismaService);
    const b = new SyncService(clientB as unknown as PrismaService);

    const setTitle = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: create.id,
      field: 'title',
      value: 'T1',
      ts: new Date().toISOString(),
    };
    const setNotes = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: create.id,
      field: 'notes',
      value: 'N1',
      ts: new Date(Date.now() + 10).toISOString(),
    };

    try {
      const aDone = a.sync(USER, { since: 0, ops: [setTitle] });
      await aHasReadPromise;
      const bDone = b.sync(USER, { since: 0, ops: [setNotes] });
      const [aResult, bResult] = await Promise.all([aDone, bDone]);

      expect(aResult.results[0]).toMatchObject({ status: 'applied' });
      expect(bResult.results[0]).toMatchObject({ status: 'applied' });
    } finally {
      // Releases even if an assertion above throws, so a failure here does
      // not leave the paused interactive transaction open until Prisma's own
      // timeout.
      releaseA();
    }

    const row = await prisma.task.findUniqueOrThrow({
      where: { id: create.id },
    });
    const fieldTs = row.fieldTs as Record<string, string>;
    expect(row.title).toBe('T1');
    expect(row.notes).toBe('N1');
    // Both edits counted: `version` is what delete's and set's optimistic
    // lock compare against, so a version that skipped one of these two
    // leaves that check blind to a change it never saw.
    expect(row.version).toBe(3);
    expect(fieldTs.title).toBe(setTitle.ts);
    expect(fieldTs.notes).toBe(setNotes.ts);
  });

  // C2: op ids are minted by the client, so two accounts can hold the same
  // one — a restored state file, a shared fixture, or any implementation of
  // ADR 0015 §4's "generated once, persisted, and reused" that derives the id
  // from the intent rather than from randomness. Deduplicated on opId alone,
  // the second account's write silently does not happen and the response
  // calls it a success.
  it('scopes operation dedup to the account that sent the operation', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'x@y.z', passwordHash: 'x' },
    });

    const mine = createTask('mine');
    await service.sync(USER, { since: 0, ops: [mine] });

    const theirs = { ...createTask('theirs'), opId: mine.opId };
    const result = await service.sync(OTHER, { since: 0, ops: [theirs] });

    expect(result.results[0]).toMatchObject({ status: 'applied' });
    expect(await prisma.task.count({ where: { id: theirs.id } })).toBe(1);
  });

  // I3: `since` reaches BigInt() and then a bigint comparison in Postgres.
  // Number.isInteger(1e300) is true and BigInt(1e300) succeeds, so the
  // original guard passed it through to a query that fails out of range —
  // inside changesSince, which has no catch of its own, so a contract-legal
  // input surfaced as a 500. Above 2^53 the value is not even the one the
  // client sent: 9007199254740993 arrives as ...992, and the cursor comes
  // back lower than the one that went out.
  it('rejects a cursor beyond the safe integer range instead of failing inside the database', async () => {
    await expect(service.sync(USER, { since: 1e300, ops: [] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.sync(USER, { since: 9007199254740993, ops: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  // I9: reads are scoped by userId, but projectId/parentId/taskId/tagId are
  // writable and the migration's foreign keys are global. Nothing leaks
  // today, because changesSince filters by userId — but the row is
  // permanently attached to another account's tree, TaskTag's ON DELETE
  // RESTRICT turns that into a hold on a row somebody else owns, and the
  // first feature that walks parentId or projectId crosses the boundary.
  it('rejects a foreign key that points at another account’s row', async () => {
    const mine = createTask('mine');
    const myProject = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'project' as const,
      id: uuidv7(),
      fields: { name: 'mine', rank: 'a0' },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, { since: 0, ops: [mine, myProject] });

    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'x@y.z', passwordHash: 'x' },
    });

    const child = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task' as const,
      id: uuidv7(),
      fields: { title: 'child', rank: 'a0', parentId: mine.id },
      ts: new Date().toISOString(),
    };
    const theirTask = createTask('theirs');
    const steal = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: theirTask.id,
      field: 'projectId',
      value: myProject.id,
      ts: new Date().toISOString(),
    };

    const { results } = await service.sync(OTHER, {
      since: 0,
      ops: [child, theirTask, steal],
    });

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toMatchObject({ status: 'applied' });
    expect(results[2]).toMatchObject({ status: 'rejected' });
    expect(await prisma.task.count({ where: { id: child.id } })).toBe(0);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: theirTask.id } }))
        .projectId,
    ).toBeNull();

    // A positive control: the same reference inside one account still
    // applies, so what the check refuses is the boundary crossing and not
    // foreign keys in general.
    const ownProject = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id: mine.id,
      field: 'projectId',
      value: myProject.id,
      ts: new Date().toISOString(),
    };
    const own = await service.sync(USER, { since: 0, ops: [ownProject] });

    expect(own.results[0]).toMatchObject({ status: 'applied' });
  });
});
