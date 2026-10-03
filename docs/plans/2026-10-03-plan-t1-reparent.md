# Plan T1: re-parent a task, and two writers on one replica

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client core can indent and outdent a task (`reparent`), the
engine accepts it as a write, and a test proves two processes sharing one
replica file neither lose nor strand an operation.

**Architecture:** `reparent` is one more operation in `operations.ts`, built
like `setRecurrence`: replay check, client-side copy of the server's rules,
one `set parentId`, `submitOwn`. The engine gets `kind: 'reparent'` in
`Write` and one `case` in `apply`. The concurrency test opens two `Store`s on
one temporary file and flushes both at once against a fake server.

**Tech Stack:** TypeScript 5.6, Vitest 5, `node:sqlite` through
`./test-store.js`.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md`, decision Q6 and Risks
("Several writers on one replica").

## Global Constraints

- The client refuses exactly what the server refuses for `set parentId`, and
  nothing more: self-parent (`apply-op.ts`, `selfParentRejection`); a parent
  that has a parent, or a task with live subtasks (`sync.service.ts`,
  `referenceRejection`); a recurring task under a parent (`row-rules.ts`,
  "a subtask cannot carry an rrule").
- A refusal throws `UsageError` and queues nothing.
- Replay-safe: a seen `minted.opId` only flushes.
- No new dependency.
- Tasks 1–2 do not depend on plan T0 and start at once. Task 3 needs T0
  merged: it edits `packages/client-core/src/engine-protocol.ts` and
  `engine.ts`, which T0 creates.
- Work happens in this plan's own worktree on branch `feat/core-reparent`;
  never on `main`.

---

### Task 1: `reparent` in the client core

**Files:**

- Modify: `packages/client-core/src/operations.ts` (new function after
  `setRecurrence`, at the end of the file)
- Test: `packages/client-core/src/operations.spec.ts` (new `describe` at the
  end)
- Create: `specs/tasks/active/T-2026-10-03-core-reparent.md`

**Interfaces:**

- Consumes: existing helpers in `operations.ts`: `replayed`, `tasks`,
  `liveTask`, `liveTasks` (from `./overlay.js`), `setTask`, `submitOwn`,
  `UsageError`, types `Core`, `Minted`.
- Produces:
  `reparent(core: Core, minted: Minted, taskId: string, parentId: string | null): Promise<{ synced: boolean }>`,
  exported from `@todoer/client-core` (the index already does
  `export * from './operations.js'`).

- [ ] **Step 1: Write the task spec**

Create `specs/tasks/active/T-2026-10-03-core-reparent.md`:

```md
## T-2026-10-03-core-reparent — Re-parent a task in the client core

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q6, Risks)
- Plan: docs/plans/2026-10-03-plan-t1-reparent.md

### Goal

The TUI indents and outdents tasks. The server already accepts
`set parentId` under the two-level rule; the client core has no operation
for it, and a refused indent must not reach the outbox.

### Scenarios

1. **Given** top-level tasks `a` and `b`, **When** `b` is indented under
   `a`, **Then** one `set parentId a` is queued and `b` lists as `a`'s
   subtask.
2. **Given** subtask `b` of `a`, **When** it is outdented, **Then** one
   `set parentId null` is queued.
3. **Given** two processes on one replica file, **When** both flush at once,
   **Then** every queued operation reaches the server and both outboxes end
   empty.

### Requirements

- **FR-001** The core MUST set or clear a task's parent with one
  `set parentId` (← design Q6)
- **FR-002** The core MUST refuse, queuing nothing: a task as its own parent,
  a parent that has a parent, a task with live subtasks, a recurring task
  under a parent (← design Q6; server rules)
- **FR-003** A resend of the same `opId` MUST only flush (← ADR 0015 §4)
- **FR-004** The engine MUST accept `kind: 'reparent'` (← design Q6)
- **FR-005** Two stores on one file flushing at once MUST leave no operation
  unsent and both outboxes empty (← design Risks)

### Edge cases

- The parent is already the requested one → nothing queued, still flushes
  (FR-001, T001)
- Unknown or deleted task or parent → `no task <id>` (FR-002, T001)
- A tombstoned subtask does not count as a live subtask (FR-002, T001)

### Definition of Done

- **SC-001** an indent and an outdent from the engine show in `viewTasks`
  at once, offline included
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] [FR-002] [FR-003] `reparent` — plan Task 1
- [ ] T002 [P] [FR-005] two stores, one file — plan Task 2
- [ ] T003 [FR-004] engine write kind, after T0 merges — plan Task 3
- [ ] T004 documents, gates, PR — plan Task 4
- **Checkpoint:** the TUI can call `engine.handle({ kind: 'reparent', … })`

### Open questions

None.
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/client-core/src/operations.spec.ts`, and add `reparent`
to the existing `import { … } from './operations.js'` list:

```ts
describe('reparent', () => {
  /** Offline, so the queue stays inspectable. `a`, `b` top level; `p` has
   *  live subtask `s` and tombstoned `z`; `r` repeats; `t` has tombstoned
   *  subtask `y` only. */
  function outline() {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    put(store, 'task', task('a'));
    put(store, 'task', task('b'));
    put(store, 'task', task('p'));
    put(store, 'task', task('s', { parentId: 'p' }));
    put(store, 'task', task('z', { parentId: 'p', deletedAt: '2026-10-01' }));
    put(store, 'task', task('t'));
    put(store, 'task', task('y', { parentId: 't', deletedAt: '2026-10-01' }));
    put(
      store,
      'task',
      task('r', { rrule: 'FREQ=DAILY', dtstart: '2026-10-01' }),
    );
    return { store, core: coreOf(store, srv.send) };
  }
  const parents = (store: Store) => sets(store, 'parentId');

  it('indents with one set parentId carrying the minted opId', async () => {
    const { store, core } = outline();
    expect((await reparent(core, mint('r1'), 'b', 'a')).synced).toBe(false);
    expect(parents(store)).toEqual([['b', 'a']]);
    expect(store.pending()[0]?.opId).toBe('r1');
    const listed = viewTasks(store, TODAY, ALL_OPEN);
    expect(listed.find((i) => i.id === 'b')?.parentTitle).toBe('a');
  });

  it('outdents with one set parentId null', async () => {
    const { store, core } = outline();
    await reparent(core, mint('r1'), 's', null);
    expect(parents(store)).toEqual([['s', null]]);
  });

  it('queues nothing when the parent is already that one', async () => {
    const { store, core } = outline();
    await reparent(core, mint('r1'), 's', 'p');
    await reparent(core, mint('r2'), 'a', null);
    expect(store.pending()).toEqual([]);
  });

  it('lets a task whose only subtasks are deleted become a subtask', async () => {
    const { store, core } = outline();
    await reparent(core, mint('r1'), 't', 'a');
    expect(parents(store)).toEqual([['t', 'a']]);
  });

  it('refuses what the server refuses, queuing nothing', async () => {
    const cases: [string, string, RegExp][] = [
      ['a', 'a', /cannot be its own parent/],
      ['b', 's', /a subtask cannot have subtasks/],
      ['p', 'a', /a task with subtasks cannot become a subtask/],
      ['r', 'a', /a recurring task cannot become a subtask/],
      ['nope', 'a', /no task nope/],
      ['a', 'nope', /no task nope/],
      ['z', 'a', /no task z/],
    ];
    for (const [id, parentId, pattern] of cases) {
      const { store, core } = outline();
      await expect(
        reparent(core, mint('r1'), id, parentId),
      ).rejects.toThrow(pattern);
      expect(store.pending()).toEqual([]);
    }
  });

  it('a resend of the same opId only flushes', async () => {
    const { store, core } = outline();
    await reparent(core, mint('r1'), 'b', 'a');
    await reparent(core, mint('r1'), 'b', 'a');
    expect(parents(store)).toEqual([['b', 'a']]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @todoer/client-core exec vitest run src/operations.spec.ts -t reparent`
Expected: FAIL, `reparent is not a function` (or a TypeScript import error).

- [ ] **Step 4: Implement `reparent`**

Append to `packages/client-core/src/operations.ts`:

```ts
/**
 * Indents a task under `parentId`, or outdents it (null): one
 * `set parentId`. Refuses, before queuing anything, what the server refuses:
 * a task as its own parent, a parent that has one (the two-level rule and
 * every cycle), a task with live subtasks, and a recurring task under a
 * parent (a subtask repeats with its parent, ADR 0009). A tombstoned subtask
 * does not count. An unchanged parent queues nothing. Replay-safe.
 */
export async function reparent(
  core: Core,
  minted: Minted,
  taskId: string,
  parentId: string | null,
): Promise<{ synced: boolean }> {
  const done = await replayed(core, minted.opId);
  if (done !== undefined) return done;
  const all = tasks(core.store);
  const task = liveTask(all, taskId);
  if (parentId !== null) {
    if (parentId === taskId) {
      throw new UsageError('a task cannot be its own parent');
    }
    if (typeof liveTask(all, parentId).parentId === 'string') {
      throw new UsageError('a subtask cannot have subtasks');
    }
    if (liveTasks(all).some((t) => t.parentId === taskId)) {
      throw new UsageError('a task with subtasks cannot become a subtask');
    }
    if (typeof task.rrule === 'string') {
      throw new UsageError('a recurring task cannot become a subtask');
    }
  }
  const ops =
    (task.parentId ?? null) === parentId
      ? []
      : [
          setTask(
            task,
            'parentId',
            parentId,
            core.newId,
            core.now().toISOString(),
          ),
        ];
  return { synced: await submitOwn(core, ops, 'reparent', minted.opId) };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @todoer/client-core exec vitest run src/operations.spec.ts`
Expected: PASS, the whole file.

If `'a subtask cannot have subtasks'` matches the `add` message on purpose:
it is the same rule, so the same words.

- [ ] **Step 6: Commit**

```bash
git add packages/client-core/src/operations.ts packages/client-core/src/operations.spec.ts specs/tasks/active/T-2026-10-03-core-reparent.md
git commit -m "feat(client-core): re-parent a task"
```

---

### Task 2: Two stores on one file

**Files:**

- Create: `packages/client-core/src/shared-replica.spec.ts`

**Interfaces:**

- Consumes: `openStore(path)` from `./test-store.js`; `flush`,
  `type Transport` from `./sync.js`; `Store#enqueue`, `pending`, `cursor`,
  `rows`.
- Produces: a test only.

This is a characterisation test: `Store` was written for parallel CLI
invocations (`advanceCursor` only moves forward; `applyResponse` skips a delta
older than a reset). The test pins that for a long-lived process next to a
short-lived one. If it fails, stop and report: the fix (taking the write lock
in `flush`) changes every client and is a design decision, not a step.

- [ ] **Step 1: Write the test**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import type { Store } from './store.js';
import { flush, type Transport } from './sync.js';
import { openStore } from './test-store.js';

const create = (opId: string): Op => ({
  opId,
  kind: 'create',
  table: 'task',
  id: `task-${opId}`,
  fields: { title: opId, rank: 'a0' },
  ts: '2026-10-03T00:00:00.000Z',
});

/**
 * A server as far as these tests need one: an opId applies once (ADR 0005)
 * and every later sight of it answers `applied` again; each applied create
 * gets the next seq; a pull returns the rows after `since`. Each answer
 * waits a tick, so two flushes started together are in flight together.
 */
function server() {
  const arrivals = new Map<string, number>();
  const changes: Change[] = [];
  const send: Transport = async (request: SyncRequest) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const op of request.ops) {
      const seen = arrivals.get(op.opId) ?? 0;
      arrivals.set(op.opId, seen + 1);
      if (seen === 0 && op.kind === 'create') {
        changes.push({
          table: op.table,
          id: op.id,
          seq: changes.length + 1,
          row: { id: op.id, ...op.fields, deletedAt: null },
        });
      }
    }
    return new Response(
      JSON.stringify({
        cursor: changes.length,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'applied',
        })),
        changes: changes.filter((c) => c.seq > request.since),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { send, arrivals, changes };
}

let dir: string;
let a: Store;
let b: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-shared-'));
  const path = join(dir, 'todoer.db');
  a = openStore(path);
  b = openStore(path);
});

afterEach(() => {
  a.close();
  b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('two stores on one replica file', () => {
  it('each queued op reaches the server and both outboxes end empty', async () => {
    const srv = server();
    a.enqueue(create('from-a'));
    b.enqueue(create('from-b'));

    await Promise.all([flush(a, srv.send), flush(b, srv.send)]);

    expect([...srv.arrivals.keys()].sort()).toEqual(['from-a', 'from-b']);
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
    const ids = (s: Store) => s.rows('task').map((r) => r.id).sort();
    expect(ids(a)).toEqual(['task-from-a', 'task-from-b']);
    expect(ids(b)).toEqual(ids(a));
    expect(a.cursor()).toBe(srv.changes.length);
  });

  it('a slower, older answer does not move the cursor back', async () => {
    const srv = server();
    a.enqueue(create('first'));
    await flush(a, srv.send); // cursor 1
    b.enqueue(create('second'));
    // b's request carries since 1; a's next flush runs alongside it.
    await Promise.all([flush(b, srv.send), flush(a, srv.send)]);
    expect(a.cursor()).toBe(2);
    expect(b.cursor()).toBe(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @todoer/client-core exec vitest run src/shared-replica.spec.ts`
Expected: PASS. A characterisation test passes on the first run; to see it
can fail, change `expect(a.pending()).toEqual([])` to expect one entry, run
it, see it fail, and change it back.

If it fails for real, record what it shows in the task spec, set
`Status: blocked` with the blocker "flush under concurrent writers — needs a
maintainer decision", and stop.

- [ ] **Step 3: Commit**

```bash
git add packages/client-core/src/shared-replica.spec.ts
git commit -m "test(client-core): two stores flushing one replica file"
```

---

### Task 3: The engine's `reparent` write (after T0 merges)

**Files:**

- Modify: `packages/client-core/src/engine-protocol.ts` (`Write` union)
- Modify: `packages/client-core/src/engine.ts` (import, `apply`)
- Test: `packages/client-core/src/engine.spec.ts` (`describe('delete, rule and subtask writes')`)

**Interfaces:**

- Consumes: `reparent` from Task 1; `Write`, `createEngine` from plan T0.
- Produces: `Write` member
  `{ kind: 'reparent'; opId: string; taskId: string; parentId: string | null }`.

- [ ] **Step 1: Rebase on `main` with T0 merged**

```bash
git fetch origin && git rebase origin/main
```

Expected: `packages/client-core/src/engine.ts` exists. If it does not, T0 has
not merged yet: wait.

- [ ] **Step 2: Write the failing test**

In `packages/client-core/src/engine.spec.ts`, inside
`describe('delete, rule and subtask writes', …)`, add the test below. Before
writing it, read that block's first test and use the same signed-in engine
helper and server fixture it uses (the file's `signedIn(srv)` and `server(…)`
helpers), so the new test reads like its neighbours:

```ts
  it('reparent indents and outdents through the core', async () => {
    const srv = server(TODO);
    const e = await signedIn(srv);
    const ids = [uuid(0xa1), uuid(0xa2)];
    for (const [i, id] of ids.entries()) {
      expect(
        await e.handle(
          { kind: 'add', opId: uuid(0xb0 + i), id, text: `t${i}` },
          'A',
        ),
      ).toEqual({ ok: true });
    }
    const parentOf = (id: string) =>
      viewTasks(store, localDate(NOW), ALL_OPEN).find((t) => t.id === id)
        ?.parentId ?? null;

    const [first, second] = ids as [string, string];
    expect(
      await e.handle(
        { kind: 'reparent', opId: uuid(0xc1), taskId: second, parentId: first },
        'A',
      ),
    ).toEqual({ ok: true });
    expect(parentOf(second)).toBe(first);

    expect(
      await e.handle(
        { kind: 'reparent', opId: uuid(0xc2), taskId: second, parentId: null },
        'A',
      ),
    ).toEqual({ ok: true });
    expect(parentOf(second)).toBeNull();
  });

  it('reparent refused by the core is an invalid failure', async () => {
    const srv = server(TODO);
    const e = await signedIn(srv);
    const id = uuid(0xa1);
    await e.handle({ kind: 'add', opId: uuid(0xb0), id, text: 't' }, 'A');
    expect(
      await e.handle(
        { kind: 'reparent', opId: uuid(0xc1), taskId: id, parentId: id },
        'A',
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'invalid' } });
  });
```

If `TODO`, `server` or `signedIn` have other names in the file, use the ones
the neighbouring tests use; the assertions stay.

Run: `pnpm --filter @todoer/client-core exec vitest run src/engine.spec.ts -t reparent`
Expected: FAIL, a type error on `kind: 'reparent'`.

- [ ] **Step 3: Add the write kind**

In `engine-protocol.ts`, add to the `Write` union after the `setRule` member:

```ts
  /** Indent under `parentId`, or outdent (null). */
  | {
      kind: 'reparent';
      opId: string;
      taskId: string;
      parentId: string | null;
    };
```

(Move the trailing `;` from the `setRule` member to this one.)

In `engine.ts`, add `reparent` to the `./operations.js` import, and to
`apply`'s switch after `case 'setRule':`:

```ts
      case 'reparent':
        return reparent(core, { opId }, w.taskId, w.parentId);
```

- [ ] **Step 4: Run the engine spec and the web typecheck**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/client-core... --filter=@todoer/web...`
Expected: PASS. The web compiles: its `switch` over `Write` kinds, if any,
must not be exhaustive-checked against the new kind; if the typecheck reports
one, add a `case 'reparent':` that does what that switch does for the
neighbouring `deleteTask` case.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src
git commit -m "feat(client-core): accept reparent as an engine write"
```

---

### Task 4: Documents, gates, pull request

- [ ] **Step 1: Documents**

In `docs/specs/2026-10-03-tui-client-design.md`, Risks, "Several writers on
one replica": append one sentence with what Task 2 showed, e.g. "Plan T1's
`shared-replica.spec.ts` pins it: both outboxes empty, every op sent, the
cursor never moves back."

Run: `pnpm exec prettier --check docs specs`
Expected: clean.

- [ ] **Step 2: Gates**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm -w exec turbo run build typecheck test && pnpm lint`
Expected: all green.

- [ ] **Step 3: Close the task spec and add the changelog line**

Tick steps and DoD, `Status: done`, `Completed`, `Result`; `git add`, then
`git mv specs/tasks/active/T-2026-10-03-core-reparent.md specs/tasks/done/`.

Run: `dnote add todoer -c "2026-10-03 · The client core can indent and outdent a task (reparent), refusing what the server's two-level rule refuses; a test pins two processes sharing one replica."`

- [ ] **Step 4: Commit, push, PR**

```bash
git add -A docs specs
git commit -m "docs: record the shared-replica test and close the reparent task"
git push -u origin feat/core-reparent
gh pr create --title "feat(client-core): re-parent a task" --body "…"
```
