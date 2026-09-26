# Plan B2: Pruning, `410 Gone` and the Snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the server keeps its tombstone-retention contract: tombstones older
than 90 days are pruned, a cursor that predates the pruning is answered
`410 Gone`, `POST /sync` with `since: 0` recovers from it, and no concurrent
write can make a pull skip a row.

**Architecture:** four changes to `apps/backend`, all behind the one existing
endpoint. Every write transaction first takes a per-user advisory lock, which
makes one user's `seq` values commit in allocation order and closes the ADR
0016 gap. A new `User.prunedThroughSeq` column is the prune watermark;
`changesSince` reads it inside the pull's REPEATABLE READ snapshot, answers
`410` for a cursor below it, and treats `since: 0` as a snapshot. A
`PruneService` runs once at startup and daily after that, deleting old
tombstones one user at a time under the same per-user lock.

**Tech Stack:** NestJS 11, Prisma 6.19, PostgreSQL 18, Vitest. No new
dependencies.

**Spec:** [`docs/specs/2026-09-26-plan-b-outbox-offline-design.md`](../specs/2026-09-26-plan-b-outbox-offline-design.md)
— the B2 half. Read "Locked decisions" Q9, Q11, Q12 and the routine choices
on pruning before Task 1. Background: ADR 0013, ADR 0016, and section 3 of
[`docs/specs/2026-09-25-domain-and-sync-design.md`](../specs/2026-09-25-domain-and-sync-design.md).

## Where this plan departs from the design doc

Three implementation choices the design doc left open or got wrong. Task 5
writes them back into the design doc so it stops asserting the old version.

1. **No instance-wide lock around the pruning run.** The design doc says
   "guarded by `pg_try_advisory_lock` so only one backend instance prunes".
   A session-level advisory lock through Prisma's connection pool is unsafe:
   the lock and the unlock can run on different pooled connections, so the
   lock leaks. It is also unnecessary. Each user is pruned in its own
   transaction under the per-user write lock from Task 1, and the watermark
   only ever moves up (`GREATEST`), so two instances pruning at once
   serialise per user and the second finds nothing left to delete.
2. **The watermark is a column, `User.prunedThroughSeq`, not a separate
   table.** One value per user, read on every pull; a column is the smallest
   thing that holds it.
3. **`410` is decided inside the pull, after the request's operations were
   applied.** The watermark has to be read in the same snapshot as the rows,
   or a pruning run that commits between the check and the scan makes the
   check stale. The cost: a `410` response carries no `results`, although the
   operations in it were applied. That is safe by construction: the client
   resends them with `since: 0` and each one replays its stored outcome
   (`duplicate` for an applied one, the original `conflict` or `rejected`
   otherwise) from `AppliedOp`.

## Global Constraints

- **Spec first.** `packages/specs/openapi/openapi.yaml` changes before the
  backend does; `pnpm spec:validate && pnpm spec:codegen`; generated artefacts
  land in their own commit.
- **Retention window: 90 days.** A constant (`RETENTION_DAYS = 90`), not
  configuration.
- **Per-user write lock:** `pg_advisory_xact_lock(1, hashtext(<userId>))`,
  the **first** statement of every write transaction and of every pruning
  transaction. Class `1` is this lock's namespace; no other advisory lock in
  the codebase may use class `1`.
- **`since: 0` is the snapshot:** live rows only, cursor `>=` the watermark,
  never `410`.
- **`410` when `0 < since < prunedThroughSeq`.** `since === prunedThroughSeq`
  is not stale.
- **Completions are never pruned** (ADR 0013). The table does not exist yet;
  the pruning code names its four tables explicitly so it cannot reach one.
- **No new dependencies.** No `@nestjs/schedule`.
- **Tests need a database whose name ends in `_test`.** Every test command
  below uses
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test`.
  Create it once if it does not exist:
  `docker exec todoer-dev-postgres-1 createdb -U todoer todoer_test`.
- **Commits:** Conventional Commits with a scope (`feat(backend): …`), body
  says why, ending with the `Co-Authored-By` trailer this repository uses.
  Never commit to `main`; the work lands through one PR whose title is itself
  a conventional commit.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **A snapshot's cursor lower than the watermark.** A user whose newest live
   row is older than their newest pruned tombstone asks with `since: 0`. If
   the cursor comes from live rows only, the next pull sends a cursor below
   the watermark, gets `410`, asks for a snapshot again, and loops forever.
   Expected: the snapshot's cursor is at least the watermark. Test in Task 3.
2. **A tombstone something still points at.** A deleted project that a live
   task still names in `projectId`, a deleted parent whose deleted subtask
   still names it in `parentId`, a deleted tag or task a `TaskTag` row still
   names. Pruning must not violate a foreign key: that aborts the whole
   user's transaction every day, and the user's tombstones are never pruned.
   Expected: still-referenced tombstones are kept, the rest go, and a
   parent/subtask pair goes in one run. Test in Task 4.
3. **Operations sent together with a stale cursor.** The client sends its
   outbox with `since` below the watermark. The operations are applied, then
   the pull answers `410`. Expected: resending the same operations with
   `since: 0` creates nothing twice and reports them as `duplicate`. Test in
   Task 3.
4. **A quiet user and the exact boundary.** Another user's pruning must not
   expire this user's cursor, and a cursor exactly equal to the watermark is
   up to date, not stale. Expected: no `410` in either case. Tests in Task 3
   and Task 4.
5. **The lock taken in the wrong place.** If the advisory lock is taken after
   the row locks rather than before them, a `set` on project P (holding P's
   row lock, waiting on the advisory lock) and a `create` of a task in P
   (holding the advisory lock, waiting on P's `FOR KEY SHARE`) deadlock:
   `40P01`, a 500. Expected: both operations applied, every round. Test in
   Task 1.

---

### Task 0: Branch, task file, and the design documents

**Files:**

- Add (already on disk, untracked):
  `specs/tasks/active/T-2026-09-26-prune-and-snapshot.md` (the task spec:
  FR-001…FR-010, scenarios, Definition of Done),
  `docs/specs/2026-09-26-plan-b-outbox-offline-design.md`,
  `docs/plans/2026-09-26-plan-b2-pruning-and-snapshot.md`

**Interfaces:**

- Consumes: the task-spec format from `chore/task-spec-format`, merged into
  `main` first.
- Produces: the branch `feat/prune-and-snapshot` every later task commits to.

The task spec is the contract for this plan: each task below names the
requirements (`FR-NNN`) and the task-spec step (`TNNN`) it implements. When a
task finishes, tick its step there. When a requirement turns out wrong, change
it in the task spec first, then here.

- [ ] **Step 1: Branch off `main`**

```bash
git switch main && git pull --ff-only
git switch -c feat/prune-and-snapshot
```

- [ ] **Step 2: Read the task spec, then set it in progress**

Read `specs/tasks/active/T-2026-09-26-prune-and-snapshot.md` in full. In it,
change `- Status: ready` to `- Status: in-progress`.

- [ ] **Step 3: Review the three Markdown files by hand**

`.prettierignore` excludes `*.md` and the repository has no markdownlint
config, so nothing checks them automatically. Check: blank lines around
headings and fences, no two blank lines in a row, no heading ending in
punctuation, every relative link resolves
(`ugrep -o '\]\(\.\./[^)]+\)' <file>` and open each).

- [ ] **Step 4: Commit**

```bash
git add specs/tasks/active/T-2026-09-26-prune-and-snapshot.md \
  docs/specs/2026-09-26-plan-b-outbox-offline-design.md \
  docs/plans/2026-09-26-plan-b2-pruning-and-snapshot.md
git commit -m "chore(tasks): open the prune-and-snapshot task

Plan B is split in two, server first, so the client's 410 handler can be
written against a server that sends one. This records the design and the
server half's plan before any code changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Serialise each user's writes (closes the ADR 0016 gap)

**Implements:** FR-001 — task-spec step T001, scenario 1, edge case "a `set` on project P racing a `create`".

**Files:**

- Create: `apps/backend/src/sync/user-lock.ts`
- Modify: `apps/backend/src/sync/sync.service.ts` (import; first statement
  inside `applyOne`'s `$transaction` callback, currently line 491)
- Test: `apps/backend/src/sync/sync.service.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces:
  `lockUserWrites(tx: { $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> }, userId: string): Promise<void>`
  in `apps/backend/src/sync/user-lock.ts`. Task 4 calls it as the first
  statement of each pruning transaction.

Background, so the test makes sense: every applied write calls
`nextval('change_seq')` and commits later. If transaction T1 takes seq 10,
then T2 takes seq 11 and commits first, a pull in between sees 11, reports
cursor 11, and never selects row 10 after T1 commits. The lock makes T2 wait
for T1's commit before it can allocate anything.

- [ ] **Step 1: Write the failing test for the lost row**

Append inside the `describe('SyncService', …)` block of
`apps/backend/src/sync/sync.service.spec.ts`:

```ts
  // ADR 0016: two writes of one user overlap, the later seq commits first,
  // and a pull in between reports a cursor past the earlier, still
  // uncommitted seq. Without the per-user lock the pull after that never
  // selects the earlier row.
  it('never lets a pull skip a row that commits below its cursor', async () => {
    const seed = await service.sync(USER, {
      since: 0,
      ops: [createTask('seed')],
    });

    let reached!: () => void;
    let release!: () => void;
    const reachedPromise = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Pauses the row write, which runs after nextval(): the slow write holds
    // its seq, uncommitted, for as long as the test wants.
    const pausedPrisma = prisma.$extends({
      query: {
        task: {
          async create({ args, query }) {
            reached();
            await releasePromise;
            return query(args);
          },
        },
      },
    });
    const paused = new SyncService(pausedPrisma as unknown as PrismaService);

    const slow = createTask('slow');
    const fast = createTask('fast');
    const slowWrite = paused.sync(USER, { since: seed.cursor, ops: [slow] });
    await reachedPromise;
    const fastWrite = service.sync(USER, { since: seed.cursor, ops: [fast] });

    try {
      // Long enough for the fast write to commit if nothing stops it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const middle = await service.sync(USER, { since: seed.cursor, ops: [] });

      release();
      await Promise.all([slowWrite, fastWrite]);
      const after = await service.sync(USER, {
        since: middle.cursor,
        ops: [],
      });

      const seen = [...middle.changes, ...after.changes].map((c) => c.id);
      expect(seen).toEqual(expect.arrayContaining([slow.id, fast.id]));
    } finally {
      release();
      await Promise.allSettled([slowWrite, fastWrite]);
    }
  });
```

- [ ] **Step 2: Write the failing test for the lock's position (Review Focus 5)**

Append after the previous test:

```ts
  // Review Focus 5: the advisory lock must come before every row lock. Taken
  // later, the set below holds the project's FOR UPDATE and waits for the
  // advisory lock, while the create holds the advisory lock and waits on the
  // project's FOR KEY SHARE (its foreign key): 40P01, a 500.
  it('does not deadlock a project edit against a task created in it', async () => {
    for (let round = 0; round < 20; round++) {
      const project = {
        opId: uuidv7(),
        kind: 'create' as const,
        table: 'project' as const,
        id: uuidv7(),
        fields: { name: 'p', rank: 'a0' },
        ts: new Date().toISOString(),
      };
      await service.sync(USER, { since: 0, ops: [project] });

      const rename = {
        opId: uuidv7(),
        kind: 'set' as const,
        table: 'project' as const,
        id: project.id,
        field: 'name',
        value: `p${round}`,
        ts: new Date().toISOString(),
      };
      const task = {
        ...createTask('in p'),
        fields: { title: 'in p', rank: 'a0', projectId: project.id },
      };
      const [renamed, created] = await Promise.all([
        service.sync(USER, { since: 0, ops: [rename] }),
        service.sync(USER, { since: 0, ops: [task] }),
      ]);

      expect(renamed.results[0]?.status).toBe('applied');
      expect(created.results[0]?.status).toBe('applied');
    }
  });
```

- [ ] **Step 3: Run both tests and watch the first one fail**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts \
  -t 'never lets a pull skip|does not deadlock a project edit'
```

Expected: `never lets a pull skip a row that commits below its cursor` FAILS
with an `arrayContaining` mismatch missing the `slow` id. The deadlock test
passes today (there is no advisory lock to misplace yet); it guards Step 5.

- [ ] **Step 4: Write `user-lock.ts`**

`apps/backend/src/sync/user-lock.ts`:

```ts
/**
 * The one method `lockUserWrites` needs, so that it takes a transaction
 * client without naming Prisma's full generated type.
 */
type RawClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/**
 * Serialises every write of one user: a transaction holding this lock keeps
 * the next one of the same user waiting until it commits or rolls back.
 *
 * That is what makes a user's `seq` values commit in the order they were
 * allocated. Without it, a write that took seq 10 and a write that took seq 11
 * can commit in the opposite order, a pull between the two commits reports
 * cursor 11, and `seq > 11` never selects row 10 again (ADR 0016, superseded
 * by ADR 0017). Pulls filter by user, so only one user's order matters, and a
 * per-user lock is enough.
 *
 * Must be the first statement of the transaction, before any row lock. Taken
 * later, it deadlocks against a transaction of the same user that already
 * holds it and is waiting for a row lock this one holds.
 *
 * Transaction-scoped (`_xact_`): released by commit or rollback, so it cannot
 * leak onto a pooled connection. Class 1 is this lock's namespace; the second
 * key is a 32-bit hash of the user id, and a collision only makes two users
 * wait for each other, never lets two writes of one user overlap.
 *
 * Selected FROM the function rather than as a column: it returns `void`, and
 * Prisma cannot deserialise a `void` column.
 */
export async function lockUserWrites(
  tx: RawClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM pg_advisory_xact_lock(1, hashtext(${userId}::text))
  `;
}
```

- [ ] **Step 5: Take the lock first in `applyOne`**

In `apps/backend/src/sync/sync.service.ts`, add the import next to the
existing `./apply-op.js` import:

```ts
import { lockUserWrites } from './user-lock.js';
```

Then make it the first statement inside `applyOne`'s transaction callback.
Replace:

```ts
      return await this.prisma.$transaction(async (tx) => {
        // Step 1 of the design doc's section 3: "seen before?" — a retry
```

with:

```ts
      return await this.prisma.$transaction(async (tx) => {
        // Before anything else, including the row locks below — see
        // lockUserWrites for why the order matters.
        await lockUserWrites(tx, userId);

        // Step 1 of the design doc's section 3: "seen before?" — a retry
```

- [ ] **Step 6: Run the two tests, then the whole backend suite**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts \
  -t 'never lets a pull skip|does not deadlock a project edit'
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend test
```

Expected: both targeted tests PASS; the full suite passes with no test
reported as `(0 test)`.

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm --filter @todoer/backend lint && pnpm --filter @todoer/backend typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/sync/user-lock.ts apps/backend/src/sync/sync.service.ts \
  apps/backend/src/sync/sync.service.spec.ts
git commit -m "fix(backend): commit one user's seq values in allocation order

Two overlapping writes of one user could commit in the opposite order to
their seq values, and a pull between the commits reported a cursor past the
earlier, still uncommitted row, which it then never selected again. Parallel
agent writes through the coming outbox make that overlap routine. A
per-user transaction-scoped advisory lock, taken before any row lock, makes
the second write wait for the first to commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The contract — `since: 0` and `410`

**Implements:** FR-009 — task-spec step T002.

**Files:**

- Modify: `packages/specs/openapi/openapi.yaml:132-151` (`SyncRequest.since`)
  and `:259-263` (the `410` response)
- Regenerated: `packages/specs/src/generated/**`

**Interfaces:**

- Consumes: nothing.
- Produces: the documented contract Task 3 implements. No type changes: only
  descriptions, so the generated client differs by comments.

- [ ] **Step 1: Describe `since: 0`**

In `packages/specs/openapi/openapi.yaml`, replace:

```yaml
        since: { type: integer, minimum: 0, maximum: 9007199254740991 }
```

with:

```yaml
        since:
          type: integer
          minimum: 0
          maximum: 9007199254740991
          description: >-
            The cursor from the previous response. 0 asks for a snapshot:
            every live row and no tombstones, with a cursor that is never
            below the prune watermark. A request with since 0 is never
            answered 410; it is how a client recovers from one.
```

- [ ] **Step 2: Describe `410`**

Replace:

```yaml
        "410":
          description: cursor older than tombstone retention
```

with:

```yaml
        "410":
          description: >-
            The cursor is older than the prune watermark: tombstones it has
            not seen are gone. Discard the local replica and repeat with
            since 0. Operations in this request were still applied; resend
            them, and each replays its original outcome.
```

- [ ] **Step 3: Validate and regenerate**

Run: `pnpm spec:validate && pnpm spec:codegen && git status --short packages/specs`
Expected: validation reports no errors; `openapi.yaml` and files under
`packages/specs/src/generated/` are modified. `git diff packages/specs/src/generated`
shows comment-only changes (the two descriptions); if it shows a type change,
stop and re-read Steps 1–2.

- [ ] **Step 4: Format**

Run: `pnpm exec prettier --check packages/specs/openapi/openapi.yaml`
Expected: passes. If not, rerun with `--write`.

- [ ] **Step 5: Commit the document, then the generated client, separately**

```bash
git add packages/specs/openapi/openapi.yaml
git commit -m "feat(specs): make since 0 the snapshot and document 410

ADR 0012 keeps POST /sync the whole data plane, so recovery from a stale
cursor reuses it instead of adding GET /sync/snapshot. The 410 description
also tells a client that operations sent with a stale cursor were applied,
because the response that says so is the one it never gets.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add packages/specs/src/generated
git commit -m "chore(specs): regenerate the client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The watermark, `410`, and `since: 0` as the snapshot

**Implements:** FR-002, FR-003, FR-004 — task-spec step T003, edge cases on the snapshot cursor, stale-cursor operations and the watermark boundary.

**Files:**

- Modify: `apps/backend/prisma/schema.prisma` (`model User`)
- Create: `apps/backend/prisma/migrations/<timestamp>_user_pruned_through_seq/migration.sql`
  (generated by Prisma)
- Modify: `apps/backend/src/sync/sync.service.ts` (`SyncDelegate` type at
  line 110, `changesSince` at lines 660-715, imports)
- Test: `apps/backend/src/sync/sync.service.spec.ts`

**Interfaces:**

- Consumes: Task 2's contract.
- Produces: `User.prunedThroughSeq: bigint` (Prisma field, column
  `"prunedThroughSeq" BIGINT NOT NULL DEFAULT 0`). Task 4 raises it.
  `SyncService.sync` throws `GoneException` (from `@nestjs/common`) for a
  stale cursor; `HttpExceptionFilter` already renders it as a `410`
  problem+json.

- [ ] **Step 1: Add the column to the schema**

In `apps/backend/prisma/schema.prisma`, `model User`, after `createdAt`:

```prisma
  /// The prune watermark: the highest seq among this user's tombstones that
  /// have been physically deleted. A pull whose cursor is below it has missed
  /// deletions it can no longer be told about and is answered 410 (ADR 0013).
  /// Only ever raised, by the pruning job.
  prunedThroughSeq BigInt @default(0)
```

- [ ] **Step 2: Generate the migration and read it**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer \
  pnpm --filter @todoer/backend exec prisma migrate dev --name user_pruned_through_seq
cat apps/backend/prisma/migrations/*_user_pruned_through_seq/migration.sql
```

Expected: the file contains exactly one statement:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "prunedThroughSeq" BIGINT NOT NULL DEFAULT 0;
```

If it contains anything that touches `Task`, `Project`, `Tag` or `TaskTag`
(Prisma sometimes drops the hand-written `seq` defaults — see the comments on
`seq` in the schema), delete those lines and re-add nothing: this migration
must touch `User` only.

Then apply it to the test database:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec prisma migrate deploy
```

- [ ] **Step 3: Write the failing tests**

Add `GoneException` to the existing `@nestjs/common` import at the top of
`apps/backend/src/sync/sync.service.spec.ts`:

```ts
import { BadRequestException, GoneException } from '@nestjs/common';
```

Add these helpers after `setParent`:

```ts
function deleteTask(id: string, baseVersion: number) {
  return {
    opId: uuidv7(),
    kind: 'delete' as const,
    table: 'task' as const,
    id,
    baseVersion,
  };
}

function setWatermark(userId: string, seq: number) {
  return prisma.user.update({
    where: { id: userId },
    data: { prunedThroughSeq: BigInt(seq) },
  });
}
```

Append inside the `describe` block:

```ts
  it('answers 410 when the cursor is older than the prune watermark', async () => {
    const first = await service.sync(USER, { since: 0, ops: [createTask('a')] });
    await setWatermark(USER, first.cursor + 10);

    await expect(
      service.sync(USER, { since: first.cursor, ops: [] }),
    ).rejects.toBeInstanceOf(GoneException);
  });

  // Review Focus 4: the boundary. A client at the watermark has seen every
  // pruned tombstone.
  it('does not answer 410 for a cursor exactly at the watermark', async () => {
    const first = await service.sync(USER, { since: 0, ops: [createTask('a')] });
    await setWatermark(USER, first.cursor);

    const pull = await service.sync(USER, { since: first.cursor, ops: [] });
    expect(pull.cursor).toBe(first.cursor);
  });

  it('answers since 0 with live rows only, never with 410', async () => {
    const kept = createTask('kept');
    const doomed = createTask('doomed');
    await service.sync(USER, { since: 0, ops: [kept, doomed] });
    await service.sync(USER, { since: 0, ops: [deleteTask(doomed.id, 1)] });
    await setWatermark(USER, 1_000_000);

    const snapshot = await service.sync(USER, { since: 0, ops: [] });

    expect(snapshot.changes.map((c) => c.id)).toEqual([kept.id]);
  });

  // Review Focus 1: a snapshot whose cursor sat below the watermark would
  // send the client straight back into 410, forever.
  it('gives a snapshot a cursor the next pull accepts', async () => {
    const task = createTask('old');
    const created = await service.sync(USER, { since: 0, ops: [task] });
    await setWatermark(USER, created.cursor + 1000);

    const snapshot = await service.sync(USER, { since: 0, ops: [] });
    expect(snapshot.cursor).toBeGreaterThanOrEqual(created.cursor + 1000);

    const next = await service.sync(USER, { since: snapshot.cursor, ops: [] });
    expect(next.changes).toHaveLength(0);
  });

  it('moves a snapshot cursor past tombstones it leaves out', async () => {
    const doomed = createTask('doomed');
    await service.sync(USER, { since: 0, ops: [doomed] });
    await service.sync(USER, { since: 0, ops: [deleteTask(doomed.id, 1)] });
    const { seq } = await prisma.task.findUniqueOrThrow({
      where: { id: doomed.id },
    });

    const snapshot = await service.sync(USER, { since: 0, ops: [] });

    expect(snapshot.changes).toHaveLength(0);
    expect(snapshot.cursor).toBe(Number(seq));
  });

  // Review Focus 3: operations sent with a stale cursor are applied before
  // the pull answers 410. Resent with since 0, they must replay, not repeat.
  it('replays operations that arrived with a stale cursor', async () => {
    const first = await service.sync(USER, { since: 0, ops: [createTask('a')] });
    await setWatermark(USER, first.cursor + 1000);
    const op = createTask('sent with a stale cursor');

    await expect(
      service.sync(USER, { since: first.cursor, ops: [op] }),
    ).rejects.toBeInstanceOf(GoneException);
    const resent = await service.sync(USER, { since: 0, ops: [op] });

    expect(resent.results[0]?.status).toBe('duplicate');
    expect(await prisma.task.count({ where: { id: op.id } })).toBe(1);
  });
```

- [ ] **Step 4: Run the new tests and watch them fail**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts \
  -t '410|since 0|snapshot|stale cursor'
```

Expected: FAIL — the 410 tests resolve instead of rejecting, and the snapshot
tests see the tombstone or a cursor below the watermark. The boundary test may
already pass.

- [ ] **Step 5: Implement it in `changesSince`**

In `apps/backend/src/sync/sync.service.ts`:

Change the `@nestjs/common` import to:

```ts
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
} from '@nestjs/common';
```

Add `aggregate` to `SyncDelegate`:

```ts
type SyncDelegate = {
  findFirst(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  aggregate(args: unknown): Promise<{ _max: { seq: bigint | null } }>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};
```

Replace the body of the `$transaction` callback in `changesSince` (from
`async (tx) => {` down to the closing `},` before the options object) with:

```ts
      async (tx) => {
        // Read inside the same snapshot as the rows: a pruning run that
        // commits between a separate check and the scans would make the
        // check describe a database the scans no longer see.
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { prunedThroughSeq: true },
        });
        const watermark = Number(user?.prunedThroughSeq ?? 0n);

        // since 0 is the snapshot (ADR 0013): a client with no replica has
        // nothing to delete, so tombstones are left out, and it is never
        // stale. Any other cursor below the watermark has missed deletions
        // that no longer exist to be sent.
        const snapshot = since === 0;
        if (!snapshot && since < watermark) {
          throw new GoneException(
            `cursor ${since} is older than the prune watermark ${watermark}; repeat with since 0`,
          );
        }

        // A snapshot's cursor starts at the watermark and also covers the
        // tombstones it leaves out. Built from live rows alone, it can sit
        // below the watermark, and the next pull answers 410 again, forever.
        let cursor = snapshot ? watermark : since;

        // Tombstoned rows are returned on purpose outside a snapshot: they
        // are how a client learns about a deletion, and filtering them out is
        // silent data corruption, not a missing feature (see D15).
        const out: Change[] = [];
        for (const table of TABLES) {
          const delegate = delegateFor(tx, table);
          const rows = await delegate.findMany({
            where: {
              userId,
              seq: { gt: BigInt(since) },
              ...(snapshot ? { deletedAt: null } : {}),
            },
            orderBy: { seq: 'asc' },
          });
          for (const row of rows) {
            out.push({
              table,
              id: String(row.id),
              seq: Number(row.seq),
              row: toChangeRow(table, row),
            });
          }
          if (snapshot) {
            const { _max } = await delegate.aggregate({
              where: { userId },
              _max: { seq: true },
            });
            cursor = Math.max(cursor, Number(_max.seq ?? 0n));
          }
        }
        out.sort((a, b) => a.seq - b.seq);

        cursor = out.reduce((m, c) => Math.max(m, c.seq), cursor);

        return { cursor, changes: out };
      },
```

Also update the tail of the comment above `return this.prisma.$transaction(`
in `changesSince`: replace

```ts
    // to shrink the gap) needs both conditions at once, rather than either
    // alone — see ADR 0016 for what still gets through.
```

with

```ts
    // to shrink the gap) needs both conditions at once, rather than either
    // alone. The per-user write lock (lockUserWrites) removes the in-flight
    // low seq altogether — see ADR 0017.
```

- [ ] **Step 6: Run the new tests, then the full backend suite**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts \
  -t '410|since 0|snapshot|stale cursor'
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend test
```

Expected: all PASS, including the older `does not advance the cursor past
since when a pull returns nothing` (a user with no rows and no watermark still
gets cursor 0) and `keeps a pull snapshot-consistent against a write landing
mid-scan`.

- [ ] **Step 7: Lint, typecheck**

Run: `pnpm --filter @todoer/backend lint && pnpm --filter @todoer/backend typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/prisma apps/backend/src/sync/sync.service.ts \
  apps/backend/src/sync/sync.service.spec.ts
git commit -m "feat(backend): answer a stale cursor with 410 and since 0 with a snapshot

A client that missed pruned tombstones would otherwise keep showing deleted
tasks forever, with nothing telling it so. The watermark is read in the
pull's own snapshot so a concurrent pruning run cannot make the check stale,
and a snapshot's cursor never sits below it, which would send the client
straight back into 410.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The pruning job

**Implements:** FR-005, FR-006, FR-007, FR-008 — task-spec step T004, scenarios 2 and 3, edge cases on referenced tombstones and the quiet user.

**Files:**

- Create: `apps/backend/src/sync/prune.service.ts`
- Create: `apps/backend/src/sync/prune.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts` (providers)

**Interfaces:**

- Consumes: `lockUserWrites` from Task 1; `User.prunedThroughSeq` and the
  `410` behaviour from Task 3.
- Produces: `PruneService` with `prune(now: Date): Promise<number>` (rows
  deleted), `onApplicationBootstrap(): void`, `onApplicationShutdown(): void`,
  and the exported constant `RETENTION_DAYS = 90`.

Deletion order matters because of foreign keys: `TaskTag` → `Task` and
`Tag`; `Task.parentId` → `Task`; `Task.projectId` → `Project`. A tombstone
something still references is kept; it is tried again on the next run.

- [ ] **Step 1: Write the failing tests**

`apps/backend/src/sync/prune.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run them and watch them fail**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/prune.service.spec.ts
```

Expected: FAIL — `Cannot find module './prune.service.js'` (or the file
reports `(0 test)`: that is the same failure, the import threw).

- [ ] **Step 3: Write `prune.service.ts`**

`apps/backend/src/sync/prune.service.ts`:

```ts
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockUserWrites } from './user-lock.js';

/**
 * How long a tombstone lives: the longest a client may stay offline and still
 * catch up incrementally (ADR 0013). A contract with offline clients, which is
 * why it is a constant and not a setting.
 */
export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two calls each pruning step makes, on whichever table it prunes. */
type Prunable = {
  aggregate(args: unknown): Promise<{ _max: { seq: bigint | null } }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

/**
 * Deletes tombstones older than the retention window and raises each user's
 * prune watermark, so that a cursor which missed them is answered 410.
 *
 * Runs once at startup and once a day after that, in-process: a self-hosted
 * instance whose operator never set up an external cron would otherwise never
 * prune, and 410 would never fire. There is no instance-wide lock: each user
 * is pruned under the per-user write lock and the watermark only moves up, so
 * two instances pruning at once serialise per user and the second finds
 * nothing to delete.
 *
 * Only the four synchronised tables, named one by one. Completions are never
 * pruned (ADR 0013); a loop over "every table with deletedAt" would one day
 * reach them.
 */
@Injectable()
export class PruneService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PruneService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const run = (): void => {
      this.prune(new Date()).catch((error: unknown) => {
        this.logger.error(error);
      });
    };
    run();
    // unref: a pending prune is no reason to keep a stopping process alive.
    this.timer = setInterval(run, DAY_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Prunes every user; returns how many rows were deleted. */
  async prune(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    // ponytail: every user, every run. Fine for a personal instance; filter to
    // users with an old tombstone if the user count ever grows large.
    const users = await this.prisma.user.findMany({ select: { id: true } });
    let deleted = 0;
    for (const { id } of users) deleted += await this.pruneUser(id, cutoff);
    return deleted;
  }

  /**
   * One user, one transaction, under the same lock as that user's writes: no
   * write can add a reference to a tombstone between the steps below, and the
   * watermark lands together with the deletions it describes.
   *
   * Referencing rows go before the rows they reference. A tombstone that
   * something still points at (a live task in a deleted project, a live
   * TaskTag on a deleted tag) is kept and retried on the next run.
   */
  private pruneUser(userId: string, cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserWrites(tx, userId);

      const old = { userId, deletedAt: { lt: cutoff } };
      const steps: Array<[Prunable, object]> = [
        [tx.taskTag as unknown as Prunable, old],
        // Subtasks first: their parent can go only once they are gone.
        [
          tx.task as unknown as Prunable,
          { ...old, parentId: { not: null }, tags: { none: {} } },
        ],
        [
          tx.task as unknown as Prunable,
          { ...old, children: { none: {} }, tags: { none: {} } },
        ],
        [tx.tag as unknown as Prunable, { ...old, tasks: { none: {} } }],
        [tx.project as unknown as Prunable, { ...old, tasks: { none: {} } }],
      ];

      let deleted = 0;
      let highest = 0n;
      for (const [table, where] of steps) {
        const { _max } = await table.aggregate({ where, _max: { seq: true } });
        const { count } = await table.deleteMany({ where });
        deleted += count;
        if (_max.seq !== null && _max.seq > highest) highest = _max.seq;
      }

      // GREATEST, not a plain write: a tombstone kept on an earlier run
      // because something referenced it can be pruned later with a lower seq
      // than the watermark already holds.
      if (deleted > 0) {
        await tx.$executeRaw`
          UPDATE "User"
             SET "prunedThroughSeq" = GREATEST("prunedThroughSeq", ${highest})
           WHERE "id" = ${userId}::uuid
        `;
      }
      return deleted;
    });
  }
}
```

- [ ] **Step 4: Register it**

In `apps/backend/src/app.module.ts`, add the import:

```ts
import { PruneService } from './sync/prune.service.js';
```

and add `PruneService` to `providers`:

```ts
  providers: [
    AppConfig,
    PrismaService,
    SyncService,
    PruneService,
    AuthService,
    AuthGuard,
  ],
```

- [ ] **Step 5: Run the pruning tests, then the whole backend suite**

Run:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec vitest run src/sync/prune.service.spec.ts
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend test
```

Expected: 6 tests PASS in `prune.service.spec.ts`; the full suite passes, no
file reported as `(0 test)`.

- [ ] **Step 6: Prove the startup run against a real server**

Run:

```bash
pnpm --filter @todoer/backend build
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer JWT_SECRET=0123456789abcdef0123456789abcdef \
  timeout 5 pnpm --filter @todoer/backend start; echo "exit $?"
```

Expected: the server starts, logs no `PruneService` error, and `timeout`
stops it (`exit 124`). A `PruneService` error line here means the startup run
fails against a real schema; fix it before continuing.

- [ ] **Step 7: Lint, typecheck, the walking skeleton**

Run:

```bash
pnpm --filter @todoer/backend lint && pnpm --filter @todoer/backend typecheck
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer JWT_SECRET=0123456789abcdef0123456789abcdef \
  pnpm --filter @todoer/backend start &
sleep 3 && pnpm --filter @todoer/cli build && sh scripts/walking-skeleton.sh; kill %1
```

Expected: no lint or type errors; `walking skeleton passed`.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/sync/prune.service.ts apps/backend/src/sync/prune.service.spec.ts \
  apps/backend/src/app.module.ts
git commit -m "feat(backend): prune tombstones older than 90 days

Without pruning, 410 is declared and never sent, and the retention window
ADR 0013 calls a contract with offline clients does not exist. The job runs
in-process, at startup and daily, so an instance nobody configured a cron
for still keeps the contract. A tombstone something still references is
kept rather than breaking a foreign key and aborting the user's whole run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The records

**Implements:** FR-010 — task-spec step T005, SC-003.

**Files:**

- Create: `docs/adr/0017-a-per-user-write-lock-orders-the-cursor.md`
- Modify: `docs/adr/0016-the-sync-cursor-is-not-linearizable.md` (status)
- Modify: `docs/adr/0013-tombstones-and-the-retention-contract.md`
- Modify: `docs/adr/0012-no-rest-surface.md:13-16`
- Modify: `docs/specs/2026-09-25-domain-and-sync-design.md` (§1 table,
  §3 after "Steps 2 to 5 run under…", §3 `410` paragraph, §5 API listing)
- Modify: `docs/specs/2026-09-26-plan-b-outbox-offline-design.md` (routine
  choice on pruning, Q9 cost)
- Modify: `README.md:21-22`
- Move: `specs/tasks/active/T-2026-09-26-prune-and-snapshot.md` →
  `specs/tasks/done/` (after the PR is open)

**Interfaces:**

- Consumes: the behaviour of Tasks 1–4.
- Produces: documents that no longer describe `GET /sync/snapshot` or an
  unclosed ADR 0016 gap.

- [ ] **Step 1: Find every stale claim**

Run: `ugrep -rn -i 'sync/snapshot|0016|pg_try_advisory' --include='*.md' . -g '!node_modules' -g '!docs/plans/2026-09-25-walking-skeleton.md' -g '!specs/tasks/done/*'`
Expected: hits in the files listed above, and in this plan (which is
correct as written). Any other hit is a stale claim to fix in this task too.

- [ ] **Step 2: Write ADR 0017**

`docs/adr/0017-a-per-user-write-lock-orders-the-cursor.md`:

```md
# 17. A per-user write lock orders the cursor

- **Status:** accepted
- **Date:** 2026-09-26
- **Supersedes:** [0016](0016-the-sync-cursor-is-not-linearizable.md)

## Context

ADR 0016 accepted a race: a write allocates `seq` 10, a second write of the
same user allocates 11 and commits first, a pull between the two commits
reports cursor 11, and `seq > 11` never selects row 10. It judged the race
rare because it needs two concurrent writes of one user. The client outbox
makes that routine: agents call the CLI in parallel, and each call flushes.

## Decision

Every write transaction in `POST /sync`, and every pruning transaction, first
takes `pg_advisory_xact_lock(1, hashtext(user_id))`. One user's writes run one
after another, so their `seq` values commit in allocation order.

## Consequences

Pulls filter by user, so per-user order is all a cursor needs; seq values of
different users still interleave, harmlessly. A pull that sees `seq` 11 of a
user also sees that user's `seq` 10. The xmin-based cursor ADR 0016 described
as the standard remedy is not needed.

The lock is taken before any row lock. Taken after, a transaction holding a
row lock waits for the advisory lock while the holder of the advisory lock
waits on that row's `FOR KEY SHARE` from a foreign key: a deadlock, `40P01`,
a 500.

One user's writes are serialised. For a personal task list this is
imperceptible. The lock key encodes user isolation: if shared projects are
ever added (ADR 0003), two authors write one dataset and this key no longer
orders it. Reconsider this ADR together with 0003.
```

- [ ] **Step 3: Mark ADR 0016 superseded**

In `docs/adr/0016-the-sync-cursor-is-not-linearizable.md`, replace:

```md
- **Status:** accepted
```

with:

```md
- **Status:** superseded by [0017](0017-a-per-user-write-lock-orders-the-cursor.md)
```

- [ ] **Step 4: Correct ADR 0013**

In `docs/adr/0013-tombstones-and-the-retention-contract.md`, replace the
whole `## Decision` section with:

```md
## Decision

Deletion sets `deleted_at`; the row stays and takes a new `seq`. Tombstones are
retained for **90 days**, then physically deleted by a job the server runs at
startup and daily. Each user carries a **prune watermark**, the highest `seq`
among their pruned tombstones. A pull whose cursor is below it
(`0 < since < watermark`) is answered `410 Gone`, and the client discards its
replica and repeats with `since: 0`.

`since: 0` is the snapshot: every live row, no tombstones, and a cursor at or
above the watermark. It is never answered `410`. There is no separate snapshot
endpoint ([0012](0012-no-rest-surface.md)).

A tombstone that a live row still references is kept until the reference goes.
```

- [ ] **Step 5: Correct ADR 0012**

In `docs/adr/0012-no-rest-surface.md`, replace:

```md
`POST /sync` is the entire data plane. `GET /sync/snapshot` exists only for the
first sign-in and for recovery from
[0013](0013-tombstones-and-the-retention-contract.md). There are no resource
endpoints.
```

with:

```md
`POST /sync` is the entire data plane, including the first sign-in and
recovery from [0013](0013-tombstones-and-the-retention-contract.md): both are
a request with `since: 0`. There are no resource endpoints.
```

- [ ] **Step 6: Correct the domain and sync spec**

In `docs/specs/2026-09-25-domain-and-sync-design.md`:

Add a row after the ADR 0015 row of the §1 table:

```md
| [0017](../adr/0017-a-per-user-write-lock-orders-the-cursor.md) | A per-user write lock makes each user's `seq` values commit in order; supersedes 0016 |
```

After the paragraph that begins "Steps 2 to 5 run under the row's write lock"
and ends "…rather than an optimisation.", add:

```md
Before any row lock, each operation's transaction takes a per-user advisory
lock ([ADR 0017](../adr/0017-a-per-user-write-lock-orders-the-cursor.md)). It
makes one user's `seq` values commit in allocation order, so a pull can never
report a cursor past a lower `seq` that is still to commit.
```

Replace:

```md
A `410 Gone` means the cursor predates tombstone retention: discard the local
replica, fetch `GET /sync/snapshot`, and start again. This path must be
```

with:

```md
A `410 Gone` means the cursor predates tombstone retention: discard the local
replica, keep the outbox, and repeat with `since: 0`, which answers with every
live row and a fresh cursor. Operations sent in the request that got `410`
were applied; resent, they replay their outcomes. This path must be
```

In the §5 listing, delete the line:

```text
GET    /sync/snapshot          full state: first sign-in, and after 410
```

and change the line above it to:

```text
POST   /sync                   the entire data plane; since 0 is the snapshot
```

- [ ] **Step 7: Correct the plan B design doc**

In `docs/specs/2026-09-26-plan-b-outbox-offline-design.md`, in "Routine
choices", replace the pruning-trigger bullet's first two sentences

```md
- **Pruning trigger (Q10):** a `setInterval` in a Nest provider, once a day,
  guarded by `pg_try_advisory_lock` so only one backend instance prunes. No
  `@nestjs/schedule` dependency.
```

with:

```md
- **Pruning trigger (Q10):** a `setInterval` in a Nest provider, once a day.
  No `@nestjs/schedule` dependency. No instance-wide lock either: a
  session-level advisory lock through Prisma's pool can be taken and released
  on different connections, and it is not needed, because each user is pruned
  under the per-user write lock and the watermark only moves up.
```

and in the Q9 decision's **Cost** paragraph replace "One state row per user"
with "One column on `User` (`prunedThroughSeq`)".

- [ ] **Step 8: Correct the README**

In `README.md`, replace:

```md
client outbox (so `add` is **not** safe to retry — see below), recurrence,
`410 Gone` and `GET /sync/snapshot`, and the web and Flutter clients. The full
```

with:

```md
client outbox (so `add` is **not** safe to retry — see below), recurrence,
and the web and Flutter clients. The server prunes tombstones after 90 days
and answers a stale cursor with `410 Gone`; the CLI does not handle `410` yet.
The full
```

- [ ] **Step 9: Check nothing stale is left, and the formatting**

Run:

```bash
ugrep -rn -i 'sync/snapshot|pg_try_advisory' --include='*.md' . -g '!node_modules' \
  -g '!docs/plans/*' -g '!specs/tasks/done/*'
pnpm lint
```

Expected: the search finds nothing; `pnpm lint` passes (it includes
`prettier --check .`). If Prettier complains, run `pnpm format` and review the
diff.

- [ ] **Step 10: Commit**

```bash
git add docs README.md
git commit -m "docs: record pruning, the snapshot and the per-user write lock

ADR 0013 and 0012 named a GET /sync/snapshot that will never exist, and ADR
0016 described an open race that the per-user lock now closes. Leaving them
would have documents asserting what the code no longer does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Open the PR**

```bash
git push -u origin feat/prune-and-snapshot
gh pr create --title "feat(backend): prune tombstones, answer stale cursors with 410" \
  --body "Plan B2: docs/plans/2026-09-26-plan-b2-pruning-and-snapshot.md

- per-user advisory write lock closes the ADR 0016 gap (ADR 0017)
- User.prunedThroughSeq; 410 for a cursor below it; since 0 is the snapshot
- in-process pruning, 90-day window, startup + daily

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then wait for the four gates: `gh pr checks --watch`. All four named in
Global Constraints must appear and pass.

- [ ] **Step 12: Close the task and log the change**

```bash
git mv specs/tasks/active/T-2026-09-26-prune-and-snapshot.md specs/tasks/done/
```

In the moved file set `- Status: done`, tick every step and every Definition
of Done item, and add:

```md
- Completed: 2026-09-26
- Result: <the PR URL from Step 11>
```

Edit before moving if you prefer, but `git add` the edited file before
`git mv`, or the move commits the old content. Then:

```bash
git add specs/tasks/done/T-2026-09-26-prune-and-snapshot.md
git commit -m "chore(tasks): close the prune-and-snapshot task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Prepend one line to the dnote changelog note (`dnote view todoer`, the note
titled `CHANGELOG todoer`):

```text
2026-09-26 · Server prunes tombstones after 90 days, answers a stale cursor with 410 and since 0 with a snapshot; a per-user write lock closes the ADR 0016 skipped-row race.
```
