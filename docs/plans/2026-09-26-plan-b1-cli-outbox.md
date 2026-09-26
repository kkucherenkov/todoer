# Plan B1: the CLI Outbox, the SQLite Replica and Offline Operation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the CLI stores every operation once, with its id, in a local
outbox, sends it on whichever later command reaches the server, answers from
a local replica when no server is reachable, and tells its caller which of
those happened.

**Architecture:** `apps/cli` gains a SQLite database (`node:sqlite`, WAL)
holding the replica (`rows`), the cursor (`meta`) and the outbox. A pure
`overlay` computes what the user sees: the server's rows with pending
operations applied. `flush` sends pending operations in batches of 1000 with
the cursor, settles results into the outbox, merges changes, and turns an
unreachable server into `synced: false` and a `410` into a replica reset and a
`since: 0` retry. `run` implements the commands on top of these and returns an
outcome; `index.ts` is the only place that touches `process`, `fetch` and the
file system path.

**Tech Stack:** Node.js 24.15+ (`node:sqlite`), TypeScript, Vitest. No new
dependencies.

**Spec:** [`docs/specs/2026-09-26-plan-b-outbox-offline-design.md`](../specs/2026-09-26-plan-b-outbox-offline-design.md)
— the B1 half: Q2–Q8 and Q13. **Task spec (the contract for this plan):**
[`specs/tasks/active/T-2026-09-26-cli-outbox.md`](../../specs/tasks/active/T-2026-09-26-cli-outbox.md),
requirements FR-001…FR-012. Background: ADR 0003, ADR 0005, ADR 0013, ADR 0015.

## Rulings this plan makes where the design doc is silent or open

1. **Open thread "connection timeout":** `TODOER_TIMEOUT_MS`, default `3000`,
   applied to each whole request (connect, send, read) with
   `AbortSignal.timeout`. A timeout counts as "server not reached".
2. **Open thread "removing failed entries":** `todoer outbox drop <op-id>…`
   removes **failed** entries only. A pending operation may already be on the
   server (a lost response), so dropping it locally would not undo it; any id
   that is not a failed entry refuses the whole call (exit 2, nothing
   removed). A conflict is not re-queued: a new edit is a new intent.
3. **Open thread "batch size":** a flush sends at most 1000 operations per
   request (the contract's `maxItems`), oldest first, and stops at the first
   request the server does not answer.
4. **The command's own operation.** Q6 keeps a refused operation as `failed`
   when a *later* invocation delivers it, because the invocation that queued
   it is gone. When the invocation that queued it is still running, it reports
   the refusal through its own exit code (1 or 4) and the operation leaves the
   outbox: reporting it twice would make every refused `add` a permanent
   `failed` entry.
5. **A response that does not mention the command's own operation** leaves the
   operation pending and the command exits 5: the outbox makes a later resend
   safe, which it was not in plan A.
6. **5xx and an unreadable response body** count as "server not reached"
   (exit 5): the operations stay queued and a resend is safe.
7. **Exit 3** now means an unexpected local failure (the SQLite database busy
   past its timeout, unreadable); no network condition produces it any more.
8. **`#project` and `@tag` stay unstored.** The code and HELP promised they
   "arrive with the outbox", but the design doc does not cover it, and it is a
   design question, not a detail: ADR 0007 makes `@home` a context tag, and
   two devices creating `@home` offline would create two tags with one name.
   This plan corrects the promise (Task 8) and records the question in tuxedo.
9. **`outbox drop` also flushes first,** like every other command (Q5), so its
   `synced` means what it means everywhere else.
10. **A request-level 400 or 413 rejects every operation in that batch.** The
    request as sent can never be accepted, so its operations are settled as
    `rejected` with the reason `the server refused the request carrying this
    operation: <status> <detail>` — failed for an earlier invocation's
    operations, exit 1 for the command's own — and the flush continues; if
    the last batch was refused, one extra empty pull still runs. Retrying
    such a batch forever would leave every later command failing, and
    `outbox drop` cannot remove pending entries. 401, 403 and other 4xx still
    keep the operations pending (the token case).

## Global Constraints

- **Node `>=24.15`** in `engines`, CI and `.nvmrc`.
- **No new dependencies.** SQLite is `node:sqlite`; UUIDs stay `uuidv7`.
- **Database file:** `$HOME/.config/todoer/todoer.db`, mode `0600`, WAL
  journal, busy timeout 5000 ms. The old `state.json` is ignored, not imported.
- **`MAX_OPS = 1000`** operations per request.
- **`TODOER_TIMEOUT_MS`** default `3000`; not a positive whole number → usage
  error.
- **Envelope** for every `--json` result:
  `{"data": …, "synced": bool, "outbox": {"pending": n, "failed": n}}`.
- **Exit codes:** `0` done and the server has it; `1` refused (a 4xx, or the
  command's own operation rejected); `2` usage error; `3` unexpected local
  failure; `4` the command's own operation conflicted; `5` the server was not
  reached, the answer is local, queued operations are kept.
- **The contract does not change.** No edit to `packages/specs`.
- **CLI tests need no database:** `pnpm --filter @todoer/cli test`. The
  end-to-end script needs a running backend and `DATABASE_URL`.
- **Commits:** Conventional Commits with a scope, body says why. **No
  `Co-Authored-By` trailer.** Never commit to `main`; one PR, conventional title.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **Parallel invocations.** Agents run the CLI in parallel; two invocations
   queueing at once must lose nothing — the reason this is SQLite. Test: the
   end-to-end script queues ten `add`s in parallel and counts ten (Task 7),
   and two `Store` connections on one file see each other's writes (Task 3).
2. **A response lost after the server applied the batch.** The resend must be
   reported `duplicate` and settle the operation, creating nothing twice.
   Test in Task 5.
3. **A 401 with operations queued.** The command exits 1 and the operations
   stay pending, to be sent once the token is fixed. Test in Task 6.
4. **Reading right after an offline `add`.** `list` without a server must show
   the queued task. Test in Task 6.
5. **An older response merged after a newer one** (two invocations flushing at
   once). No row may go back to an older version, and the cursor may not move
   backwards. Test in Task 3.

---

### Task 0: Branch and the task spec

**Files:**

- Add (already on disk, untracked): `specs/tasks/active/T-2026-09-26-cli-outbox.md`,
  `docs/plans/2026-09-26-plan-b1-cli-outbox.md`

**Interfaces:**

- Produces: the branch `feat/cli-outbox`.

The task spec is the contract: each task below names the requirements it
implements and the task-spec step it ticks. When a task finishes, tick its
step there in the same commit.

- [ ] **Step 1: Branch off `main`**

```bash
git switch main && git pull --ff-only
git switch -c feat/cli-outbox
```

- [ ] **Step 2: Set the task spec in progress and commit**

In `specs/tasks/active/T-2026-09-26-cli-outbox.md` change `- Status: ready`
to `- Status: in-progress`. Then:

```bash
git add specs/tasks/active/T-2026-09-26-cli-outbox.md docs/plans/2026-09-26-plan-b1-cli-outbox.md
git commit -m "chore(tasks): open the cli-outbox task

The server half of plan B has landed, so the client can now be built
against a server that prunes, answers 410 and serves since 0 as a snapshot."
```

---

### Task 1: Node 24.15 across the workspace

**Implements:** FR-002 — task-spec step T001.

**Files:**

- Modify: `package.json` (`engines`), `.nvmrc`,
  `.github/workflows/test.yml` (both `node-version: 22`)

**Interfaces:**

- Produces: a runtime where `node:sqlite` loads without an
  `ExperimentalWarning` and `DatabaseSync` accepts `timeout`.

- [ ] **Step 1: Check the premise the whole plan rests on**

Run:

```bash
npx -y node@24.15.0 -e "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:', { timeout: 5000 }).exec('select 1'); console.log('ok')" 2>&1
```

Expected: exactly `ok`, and no line containing `ExperimentalWarning`. If a
warning is printed, stop and report NEEDS_CONTEXT with the output: the design
chose Node 24.15 precisely so stderr stays clean, and the choice has to be
revisited. If `npx` cannot download Node (no network), say so in the report;
CI on Node 24 is then the check.

- [ ] **Step 2: Raise the floor**

`package.json`: `"engines": { "node": ">=24.15" }`.
`.nvmrc`: `24`.
`.github/workflows/test.yml`: both `node-version: 22` lines become
`node-version: 24`.

- [ ] **Step 3: Check nothing else pins 22**

Run: `ugrep -rn -w '22' --include='*.yml' --include='*.json' --include='.nvmrc' . -g '!node_modules' -g '!pnpm-lock.yaml' | ugrep -i node`
Expected: no hit that pins Node 22 (`@types/node` `^22.x` is a type package
and stays; its `node:sqlite` typings already include `timeout`).

- [ ] **Step 4: Commit**

```bash
git add package.json .nvmrc .github/workflows/test.yml specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "build: require Node 24.15 for the built-in SQLite module

The CLI's replica and outbox move to node:sqlite. Before 24.15 the module
is experimental and prints a warning to stderr on every run, and stderr is
the channel an agent reads for errors."
```

(Tick T001 in the task spec before `git add`.)

---

### Task 2: The configuration reader

**Implements:** FR-011 — task-spec step T002.

**Files:**

- Modify: `apps/cli/src/config.ts`
- Create: `apps/cli/src/config.spec.ts`

**Interfaces:**

- Produces: `readConfig(env: NodeJS.ProcessEnv): Config` and
  `type Config = { base: string; token: string; dbPath: string; timeoutMs: number }`.
  Task 6 calls it. The old exports `BASE`, `TOKEN`, `STATE` stay until Task 6
  removes them, so `index.ts` keeps compiling.

- [ ] **Step 1: Write the failing test**

`apps/cli/src/config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';
import { UsageError } from './protocol.js';

describe('readConfig', () => {
  it('defaults the URL, the token and the timeout', () => {
    expect(readConfig({ HOME: '/home/a' })).toEqual({
      base: 'http://localhost:3000/api/v1',
      token: '',
      dbPath: '/home/a/.config/todoer/todoer.db',
      timeoutMs: 3000,
    });
  });

  it('reads every variable that is set', () => {
    expect(
      readConfig({
        HOME: '/home/b',
        TODOER_URL: 'https://todo.example/api/v1',
        TODOER_TOKEN: 'secret',
        TODOER_TIMEOUT_MS: '250',
      }),
    ).toEqual({
      base: 'https://todo.example/api/v1',
      token: 'secret',
      dbPath: '/home/b/.config/todoer/todoer.db',
      timeoutMs: 250,
    });
  });

  // A typo must not become "no timeout" or "wait NaN ms".
  it.each(['0', '-5', '1.5', 'soon'])(
    'refuses TODOER_TIMEOUT_MS=%s',
    (value) => {
      expect(() =>
        readConfig({ HOME: '/h', TODOER_TIMEOUT_MS: value }),
      ).toThrow(UsageError);
    },
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/config.spec.ts`
Expected: FAIL — `readConfig` is not exported.

- [ ] **Step 3: Add `readConfig`**

Replace `apps/cli/src/config.ts` with:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageError } from './protocol.js';

export type Config = {
  base: string;
  token: string;
  dbPath: string;
  timeoutMs: number;
};

/**
 * The only reader of the environment. A bad value is a usage error here, at
 * startup, rather than a request that waits forever or not at all.
 */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const raw = env.TODOER_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === '' ? 3000 : Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError(
      `TODOER_TIMEOUT_MS must be a positive whole number of milliseconds, not ${String(raw)}`,
    );
  }
  return {
    base: env.TODOER_URL ?? 'http://localhost:3000/api/v1',
    token: env.TODOER_TOKEN ?? '',
    dbPath: join(env.HOME ?? homedir(), '.config', 'todoer', 'todoer.db'),
    timeoutMs,
  };
}

// Plan A's constants; index.ts still reads them until Task 6 of plan B1.
export const BASE = process.env.TODOER_URL ?? 'http://localhost:3000/api/v1';
export const TOKEN = process.env.TODOER_TOKEN ?? '';
export const STATE = join(homedir(), '.config', 'todoer', 'state.json');
```

- [ ] **Step 4: Run the tests, lint, typecheck**

Run:

```bash
pnpm --filter @todoer/cli exec vitest run src/config.spec.ts
pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli lint && pnpm --filter @todoer/cli typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit** (tick T002 first)

```bash
git add apps/cli/src/config.ts apps/cli/src/config.spec.ts specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "feat(cli): read and validate configuration in one place

The outbox adds a request timeout and a database path to what the CLI
reads from its environment. Reading it through one function makes a bad
value a usage error at startup and the whole thing testable without
touching process.env."
```

---

### Task 3: The SQLite store

**Implements:** FR-001, FR-003, FR-006, FR-009 — task-spec step T003; Review
Focus 1 and 5.

**Files:**

- Create: `apps/cli/src/store.ts`
- Create: `apps/cli/src/store.spec.ts`

**Interfaces:**

- Consumes: `UsageError` from `./protocol.js`; types `Change`, `Op`,
  `OpResult`, `SyncResponse` from `@todoer/specs`.
- Produces (used by Tasks 4–6):
  - `type Row = Record<string, unknown>`
  - `type OutboxEntry = { opId: string; op: Op; status: 'pending' | 'failed'; reason: string | null; currentVersion: number | null }`
  - `class Store` with
    `static open(path: string): Store`, `close(): void`,
    `transaction<T>(fn: () => T): T`,
    `cursor(): number`, `advanceCursor(cursor: number): void`,
    `enqueue(op: Op): void`, `pending(): Op[]`, `entries(): OutboxEntry[]`,
    `counts(): { pending: number; failed: number }`,
    `settle(results: OpResult[], own: ReadonlySet<string>): void`,
    `drop(opIds: string[]): void`,
    `mergeChanges(changes: Change[]): void`,
    `rows(table: string): Row[]`,
    `resetReplica(): void`,
    `applyResponse(response: SyncResponse, own: ReadonlySet<string>): void`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/src/store.spec.ts`:

```ts
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { UsageError } from './protocol.js';
import { Store } from './store.js';

let dir: string;
let open: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-store-'));
  open = [];
});

afterEach(() => {
  for (const store of open) store.close();
  rmSync(dir, { recursive: true, force: true });
});

function storeAt(name = 'todoer.db'): Store {
  const store = Store.open(join(dir, name));
  open.push(store);
  return store;
}

function create(opId: string): Op {
  return {
    opId,
    kind: 'create',
    table: 'task',
    id: `task-${opId}`,
    fields: { title: opId, rank: 'a0' },
    ts: '2026-09-26T00:00:00.000Z',
  };
}

describe('Store', () => {
  it('keeps queued operations in the order they were queued', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    expect(store.pending().map((op) => op.opId)).toEqual(['a', 'b']);
  });

  it('keeps the outbox on disk across a reopen', () => {
    const first = Store.open(join(dir, 'todoer.db'));
    first.enqueue(create('a'));
    first.close();
    expect(storeAt().pending()).toEqual([create('a')]);
  });

  // Review Focus 1: two invocations share one file. With a JSON file, the
  // second writer's copy would not contain the first writer's operation.
  it('loses no operation when two connections queue into one file', () => {
    const first = storeAt();
    const second = storeAt();
    first.enqueue(create('a'));
    second.enqueue(create('b'));
    first.enqueue(create('c'));
    expect(second.pending().map((op) => op.opId)).toEqual(['a', 'b', 'c']);
  });

  it('removes settled operations and keeps refused ones as failed', () => {
    const store = storeAt();
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.enqueue(create(id));
    store.settle(
      [
        { opId: 'a', status: 'applied' },
        { opId: 'b', status: 'duplicate' },
        { opId: 'c', status: 'superseded' },
        { opId: 'd', status: 'rejected', reason: 'unknown field: x' },
        { opId: 'e', status: 'conflict', currentVersion: 7 },
      ],
      new Set(),
    );
    expect(store.pending()).toEqual([]);
    expect(
      store.entries().map((e) => [e.opId, e.status, e.reason, e.currentVersion]),
    ).toEqual([
      ['d', 'failed', 'unknown field: x', null],
      ['e', 'failed', null, 7],
    ]);
    expect(store.counts()).toEqual({ pending: 0, failed: 2 });
  });

  // Plan ruling 4: the invocation that queued it reports it by exit code.
  it("removes the caller's own refused operation instead of keeping it", () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.settle([{ opId: 'a', status: 'rejected', reason: 'no' }], new Set(['a']));
    expect(store.entries()).toEqual([]);
  });

  it('drops failed entries, and refuses anything else without dropping', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    store.settle([{ opId: 'a', status: 'rejected', reason: 'no' }], new Set());

    expect(() => store.drop(['a', 'b'])).toThrow(UsageError);
    expect(() => store.drop(['nope'])).toThrow(UsageError);
    expect(store.entries()).toHaveLength(2);

    store.drop(['a']);
    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['b', 'pending'],
    ]);
  });

  // Review Focus 5: two invocations flushing at once can merge an older
  // response after a newer one.
  it('never replaces a row with an older version of it', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 5, row: { id: 'x', title: 'new' } },
    ]);
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 3, row: { id: 'x', title: 'old' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'new' }]);
  });

  it('never moves the cursor backwards', () => {
    const store = storeAt();
    expect(store.cursor()).toBe(0);
    store.advanceCursor(9);
    store.advanceCursor(4);
    expect(store.cursor()).toBe(9);
  });

  it('keeps rows of different tables apart even with the same id', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 1, row: { id: 'x', title: 'task' } },
      { table: 'project', id: 'x', seq: 2, row: { id: 'x', name: 'project' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'task' }]);
  });

  it('returns rows in seq order', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'b', seq: 2, row: { id: 'b' } },
      { table: 'task', id: 'a', seq: 1, row: { id: 'a' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('discards the replica but not the outbox on reset', () => {
    const store = storeAt();
    store.mergeChanges([{ table: 'task', id: 'x', seq: 5, row: { id: 'x' } }]);
    store.advanceCursor(5);
    store.enqueue(create('a'));

    store.resetReplica();

    expect(store.rows('task')).toEqual([]);
    expect(store.cursor()).toBe(0);
    expect(store.pending()).toHaveLength(1);
  });

  it('applies a whole response in one step', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.applyResponse(
      {
        cursor: 3,
        results: [{ opId: 'a', status: 'applied' }],
        changes: [{ table: 'task', id: 'task-a', seq: 3, row: { id: 'task-a' } }],
      },
      new Set(),
    );
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([{ id: 'task-a' }]);
    expect(store.cursor()).toBe(3);
  });

  it('rolls a transaction back when it throws', () => {
    const store = storeAt();
    expect(() =>
      store.transaction(() => {
        store.enqueue(create('a'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.pending()).toEqual([]);
  });

  it('keeps the database readable only by its owner', () => {
    storeAt();
    expect(statSync(join(dir, 'todoer.db')).mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/store.spec.ts`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 3: Write `store.ts`**

`apps/cli/src/store.ts`:

```ts
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Change, Op, OpResult, SyncResponse } from '@todoer/specs';
import { UsageError } from './protocol.js';

/** A row as the server sent it; the CLI never interprets more than it shows. */
export type Row = Record<string, unknown>;

export type OutboxEntry = {
  opId: string;
  op: Op;
  status: 'pending' | 'failed';
  reason: string | null;
  currentVersion: number | null;
};

// `rows` mirrors `Change` on the wire rather than the server's tables: the
// contract can grow a column without this client migrating anything (design
// doc, Q8). `position` orders the outbox; op ids are UUIDv7 but come from
// other devices' clocks too, so they are not an order.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rows (
    tbl TEXT    NOT NULL,
    id  TEXT    NOT NULL,
    seq INTEGER NOT NULL,
    row TEXT    NOT NULL,
    PRIMARY KEY (tbl, id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    position        INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id           TEXT    NOT NULL UNIQUE,
    op              TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'failed')),
    reason          TEXT,
    current_version INTEGER
  );
`;

type OutboxRow = {
  op_id: string;
  op: string;
  status: 'pending' | 'failed';
  reason: string | null;
  current_version: number | null;
};

/**
 * The CLI's local state: the replica of the server's rows, the cursor, and
 * the outbox. One SQLite file, because agents run the CLI in parallel and a
 * JSON file rewritten by each invocation loses whatever the other one wrote
 * (design doc, Q2). WAL lets readers run beside a writer; the busy timeout
 * makes a second writer wait instead of failing.
 */
export class Store {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): Store {
    const onDisk = path !== ':memory:';
    if (onDisk) mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path, { timeout: 5000 });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA);
    // The replica is the user's whole task list.
    if (onDisk) chmodSync(path, 0o600);
    return new Store(db);
  }

  close(): void {
    this.db.close();
  }

  /** IMMEDIATE: take the write lock up front, so two invocations serialise
   *  here instead of failing half-way with SQLITE_BUSY on upgrade. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  cursor(): number {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'cursor'")
      .get() as unknown as { value: number } | undefined;
    return row?.value ?? 0;
  }

  /** Only ever forward: a slower invocation's older response must not undo a
   *  newer one's progress. */
  advanceCursor(cursor: number): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('cursor', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value
         WHERE excluded.value > meta.value`,
      )
      .run(cursor);
  }

  enqueue(op: Op): void {
    this.db
      .prepare('INSERT INTO outbox (op_id, op) VALUES (?, ?)')
      .run(op.opId, JSON.stringify(op));
  }

  pending(): Op[] {
    const rows = this.db
      .prepare("SELECT op FROM outbox WHERE status = 'pending' ORDER BY position")
      .all() as unknown as Array<{ op: string }>;
    return rows.map((row) => JSON.parse(row.op) as Op);
  }

  entries(): OutboxEntry[] {
    const rows = this.db
      .prepare(
        'SELECT op_id, op, status, reason, current_version FROM outbox ORDER BY position',
      )
      .all() as unknown as OutboxRow[];
    return rows.map((row) => ({
      opId: row.op_id,
      op: JSON.parse(row.op) as Op,
      status: row.status,
      reason: row.reason,
      currentVersion: row.current_version,
    }));
  }

  counts(): { pending: number; failed: number } {
    const rows = this.db
      .prepare('SELECT status, count(*) AS n FROM outbox GROUP BY status')
      .all() as unknown as Array<{ status: 'pending' | 'failed'; n: number }>;
    const counts = { pending: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  /**
   * Applies the server's verdicts to the outbox. `applied`, `duplicate` and
   * `superseded` all mean the intent is in the server's state, so the entry
   * goes. `rejected` and `conflict` mean it did not happen: an entry some
   * earlier invocation queued stays as `failed` for `todoer outbox` to show
   * (design doc, Q6); the running command's own entry goes, because that
   * command reports it through its exit code (plan B1, ruling 4).
   */
  settle(results: OpResult[], own: ReadonlySet<string>): void {
    const remove = this.db.prepare('DELETE FROM outbox WHERE op_id = ?');
    const fail = this.db.prepare(
      "UPDATE outbox SET status = 'failed', reason = ?, current_version = ? WHERE op_id = ?",
    );
    for (const result of results) {
      const refused =
        result.status === 'rejected' || result.status === 'conflict';
      if (refused && !own.has(result.opId)) {
        fail.run(result.reason ?? null, result.currentVersion ?? null, result.opId);
      } else {
        remove.run(result.opId);
      }
    }
  }

  /**
   * Forgets failed entries. Only failed ones: a pending entry may already be
   * on the server (a lost response), so forgetting it here would undo
   * nothing. Refuses the whole call if any id is not a failed entry.
   */
  drop(opIds: string[]): void {
    this.transaction(() => {
      const failed = new Set(
        (
          this.db
            .prepare("SELECT op_id FROM outbox WHERE status = 'failed'")
            .all() as unknown as Array<{ op_id: string }>
        ).map((row) => row.op_id),
      );
      const refused = opIds.filter((id) => !failed.has(id));
      if (refused.length > 0) {
        throw new UsageError(
          `not a failed operation: ${refused.join(', ')} — only failed operations can be dropped`,
        );
      }
      const remove = this.db.prepare('DELETE FROM outbox WHERE op_id = ?');
      for (const id of opIds) remove.run(id);
    });
  }

  /** Upserts, keeping whichever version of a row has the higher seq. */
  mergeChanges(changes: Change[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO rows (tbl, id, seq, row) VALUES (?, ?, ?, ?)
       ON CONFLICT (tbl, id) DO UPDATE SET seq = excluded.seq, row = excluded.row
       WHERE excluded.seq > rows.seq`,
    );
    for (const change of changes) {
      upsert.run(change.table, change.id, change.seq, JSON.stringify(change.row));
    }
  }

  rows(table: string): Row[] {
    const rows = this.db
      .prepare('SELECT row FROM rows WHERE tbl = ? ORDER BY seq')
      .all(table) as unknown as Array<{ row: string }>;
    return rows.map((row) => JSON.parse(row.row) as Row);
  }

  /** After a 410: the replica is unrecoverable, the outbox is not (ADR 0013). */
  resetReplica(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM rows');
      this.db.exec(
        `INSERT INTO meta (key, value) VALUES ('cursor', 0)
         ON CONFLICT (key) DO UPDATE SET value = 0`,
      );
    });
  }

  /** One response, one transaction: verdicts, rows and cursor land together. */
  applyResponse(response: SyncResponse, own: ReadonlySet<string>): void {
    this.transaction(() => {
      this.settle(response.results, own);
      this.mergeChanges(response.changes);
      this.advanceCursor(response.cursor);
    });
  }
}
```

- [ ] **Step 4: Run the tests, lint, typecheck**

Run:

```bash
pnpm --filter @todoer/cli exec vitest run src/store.spec.ts
pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli lint && pnpm --filter @todoer/cli typecheck
```

Expected: all pass, and no `ExperimentalWarning` in the test output on Node
24.15+. If ESLint's type-aware rules object to the `as unknown as` casts on
`node:sqlite` results, keep the casts and satisfy the rule the smallest way
(the result type is `Record<string, SQLOutputValue>`, which has no narrower
typing).

- [ ] **Step 5: Commit** (tick T003 first)

```bash
git add apps/cli/src/store.ts apps/cli/src/store.spec.ts specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "feat(cli): keep the replica and the outbox in SQLite

Agents run the CLI in parallel. A JSON state file rewritten by each
invocation loses whatever another one wrote, and with an outbox in it a
lost write is a lost intent. SQLite gives cross-process transactions for
the outbox, the rows and the cursor together."
```

---

### Task 4: The overlay

**Implements:** FR-005 — task-spec step T004.

**Files:**

- Create: `apps/cli/src/overlay.ts`
- Create: `apps/cli/src/overlay.spec.ts`

**Interfaces:**

- Consumes: `Row` from `./store.js`; `Op` from `@todoer/specs`.
- Produces: `overlay(table: string, rows: Row[], pending: Op[]): Row[]`,
  `liveTasks(rows: Row[]): Row[]`, `PENDING_DELETE: string`. Task 6 uses
  `overlay` and `liveTasks`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/src/overlay.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { PENDING_DELETE, liveTasks, overlay } from './overlay.js';

const server = [
  { id: 'a', title: 'from the server', priority: 0, deletedAt: null },
];

function op(partial: Partial<Op> & Pick<Op, 'kind'>): Op {
  return {
    opId: 'op',
    table: 'task',
    id: 'a',
    ts: '2026-09-26T00:00:00.000Z',
    ...partial,
  } as Op;
}

describe('overlay', () => {
  it('returns the server rows untouched when nothing is pending', () => {
    expect(overlay('task', server, [])).toEqual(server);
  });

  it('shows a queued create after the server rows', () => {
    const rows = overlay('task', server, [
      op({ kind: 'create', id: 'b', fields: { title: 'queued', priority: 1 } }),
    ]);
    expect(rows).toEqual([
      server[0],
      { id: 'b', title: 'queued', priority: 1, deletedAt: null },
    ]);
  });

  // Once the server has the row, the server's version is the truth.
  it('ignores a queued create for a row the server already sent', () => {
    const rows = overlay('task', server, [
      op({ kind: 'create', id: 'a', fields: { title: 'stale local copy' } }),
    ]);
    expect(rows).toEqual(server);
  });

  it('applies a queued set to the row it names', () => {
    const rows = overlay('task', server, [
      op({ kind: 'set', field: 'title', value: 'renamed' }),
    ]);
    expect(rows[0]).toMatchObject({ id: 'a', title: 'renamed' });
  });

  it('marks a row deleted by a queued delete', () => {
    const rows = overlay('task', server, [
      op({ kind: 'delete', baseVersion: 1 }),
    ]);
    expect(rows[0]?.deletedAt).toBe(PENDING_DELETE);
    expect(liveTasks(rows)).toEqual([]);
  });

  it('applies queued operations in order', () => {
    const rows = overlay('task', [], [
      op({ kind: 'create', id: 'b', fields: { title: 'one' } }),
      op({ kind: 'set', id: 'b', field: 'title', value: 'two' }),
    ]);
    expect(rows).toEqual([{ id: 'b', title: 'two', deletedAt: null }]);
  });

  it('leaves other tables out', () => {
    expect(
      overlay('task', [], [op({ kind: 'create', table: 'project', id: 'p', fields: {} })]),
    ).toEqual([]);
  });

  it('keeps the server rows it was given unmodified', () => {
    const rows = [{ id: 'a', title: 'x', deletedAt: null }];
    overlay('task', rows, [op({ kind: 'set', field: 'title', value: 'y' })]);
    expect(rows[0]?.title).toBe('x');
  });
});

describe('liveTasks', () => {
  it('drops tombstones', () => {
    expect(
      liveTasks([
        { id: 'a', deletedAt: null },
        { id: 'b', deletedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    ).toEqual([{ id: 'a', deletedAt: null }]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/overlay.spec.ts`
Expected: FAIL — `Cannot find module './overlay.js'`.

- [ ] **Step 3: Write `overlay.ts`**

`apps/cli/src/overlay.ts`:

```ts
import type { Op } from '@todoer/specs';
import type { Row } from './store.js';

/** `deletedAt` of a row a queued delete has removed but the server has not
 *  confirmed. Any non-null value hides the row; this one says why. */
export const PENDING_DELETE = 'pending';

/**
 * One table as this client shows it: the rows the server last sent, with
 * the operations still in the outbox applied on top, in outbox order.
 *
 * The replica itself never holds a local edit (design doc, Q7), so a pull
 * never has to reconcile one, and a 410 can discard the replica without
 * losing anything unsent. The price is that every read walks the pending
 * operations.
 */
// ponytail: O(rows + pending) per read; fine for an outbox of hundreds.
// Index pending by id if a client stays offline for thousands of operations.
export function overlay(table: string, rows: Row[], pending: Op[]): Row[] {
  const view = new Map<string, Row>();
  for (const row of rows) view.set(String(row.id), row);
  for (const op of pending) {
    if (op.table !== table) continue;
    const current = view.get(op.id);
    if (op.kind === 'create') {
      if (current === undefined) {
        view.set(op.id, { ...op.fields, id: op.id, deletedAt: null });
      }
    } else if (op.kind === 'set') {
      if (current !== undefined) {
        view.set(op.id, { ...current, [op.field]: op.value });
      }
    } else if (current !== undefined) {
      view.set(op.id, { ...current, deletedAt: current.deletedAt ?? PENDING_DELETE });
    }
  }
  return [...view.values()];
}

/** The rows `list` shows: anything not deleted, locally or on the server. */
export function liveTasks(rows: Row[]): Row[] {
  return rows.filter((row) => row.deletedAt === null);
}
```

- [ ] **Step 4: Run the tests, lint, typecheck**

Run:

```bash
pnpm --filter @todoer/cli exec vitest run src/overlay.spec.ts
pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli lint && pnpm --filter @todoer/cli typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit** (tick T004 first)

```bash
git add apps/cli/src/overlay.ts apps/cli/src/overlay.spec.ts specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "feat(cli): show queued operations over the server's rows

A local edit written into the replica would be erased by the next pull
of the server's older copy, or need a rebase of every pending operation
on every merge. Computing the view on read keeps the replica a plain copy
of the server."
```

---

### Task 5: The flush

**Implements:** FR-004, FR-006, FR-007, FR-010 — task-spec step T005; Review
Focus 2.

**Files:**

- Create: `apps/cli/src/sync.ts`
- Create: `apps/cli/src/sync.spec.ts`
- Modify: `apps/cli/src/protocol.ts` (add `ownOutcome`; the plan-A exports
  stay until Task 6)
- Modify: `apps/cli/src/protocol.spec.ts` (add `ownOutcome` tests)

**Interfaces:**

- Consumes: `Store` (Task 3).
- Produces:
  - `type Transport = (request: SyncRequest) => Promise<Response>`
  - `type Flushed = { synced: boolean; results: OpResult[] }`
  - `const MAX_OPS = 1000`
  - `flush(store: Store, send: Transport, own?: ReadonlySet<string>): Promise<Flushed>`
  - in `protocol.ts`: `ownOutcome(results: OpResult[], opId: string): 'settled' | 'unreported'`
    (throws `RefusalError` for `rejected`, `ConflictError` for `conflict`).

- [ ] **Step 1: Write the failing tests for `ownOutcome`**

Append to `apps/cli/src/protocol.spec.ts` (and add `ownOutcome` to its import
from `./protocol.js`):

```ts
describe('ownOutcome', () => {
  it('is settled when the server applied, deduplicated or superseded it', () => {
    for (const status of ['applied', 'duplicate', 'superseded'] as const) {
      expect(ownOutcome([{ opId: 'a', status }], 'a')).toBe('settled');
    }
  });

  it('is unreported when the response does not mention it', () => {
    expect(ownOutcome([{ opId: 'b', status: 'applied' }], 'a')).toBe('unreported');
  });

  it('throws a RefusalError carrying the reason for a rejection', () => {
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'rejected', reason: 'unknown field: x' }], 'a'),
    ).toThrow(/unknown field: x/);
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'rejected' }], 'a'),
    ).toThrow(RefusalError);
  });

  it('throws a ConflictError naming the current version', () => {
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(ConflictError);
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(/7/);
  });
});
```

- [ ] **Step 2: Write the failing tests for `flush`**

`apps/cli/src/sync.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Change, Op, OpResult, SyncRequest } from '@todoer/specs';
import { RefusalError } from './protocol.js';
import { Store } from './store.js';
import { MAX_OPS, flush, type Transport } from './sync.js';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

function create(opId: string): Op {
  return {
    opId,
    kind: 'create',
    table: 'task',
    id: `task-${opId}`,
    fields: { title: opId, rank: 'a0' },
    ts: '2026-09-26T00:00:00.000Z',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function applyAll(request: SyncRequest, cursor: number, changes: Change[] = []) {
  const results: OpResult[] = request.ops.map((op) => ({
    opId: op.opId,
    status: 'applied',
  }));
  return json({ cursor, results, changes });
}

/** A transport that answers with the given handlers in turn and records
 *  every request it saw. */
function scripted(
  ...handlers: Array<(request: SyncRequest) => Response | Promise<Response>>
) {
  const requests: SyncRequest[] = [];
  const send: Transport = async (request) => {
    requests.push(structuredClone(request));
    const handler = handlers.shift();
    if (handler === undefined) throw new Error('unexpected request');
    return handler(request);
  };
  return { send, requests };
}

const unreachable = () => {
  throw new TypeError('fetch failed');
};

describe('flush', () => {
  it('sends the pending operations with the cursor and applies the answer', async () => {
    store.advanceCursor(4);
    store.enqueue(create('a'));
    const row = { id: 'task-a', title: 'a', deletedAt: null };
    const server = scripted((request) =>
      applyAll(request, 9, [{ table: 'task', id: 'task-a', seq: 9, row }]),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests).toEqual([{ since: 4, ops: [create('a')] }]);
    expect(flushed.synced).toBe(true);
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([row]);
    expect(store.cursor()).toBe(9);
  });

  it('still pulls when nothing is queued', async () => {
    const server = scripted((request) => applyAll(request, 0));
    await flush(store, server.send);
    expect(server.requests).toEqual([{ since: 0, ops: [] }]);
  });

  // FR-003: the operation keeps its id across attempts (ADR 0015 §4).
  it('resends the same operation after the server was unreachable', async () => {
    store.enqueue(create('a'));

    const offline = await flush(store, scripted(unreachable).send);
    expect(offline.synced).toBe(false);
    expect(store.pending()).toEqual([create('a')]);

    const server = scripted((request) => applyAll(request, 1));
    await flush(store, server.send);
    expect(server.requests[0]?.ops).toEqual([create('a')]);
  });

  it('treats a 5xx as the server not reached', async () => {
    store.enqueue(create('a'));
    const flushed = await flush(store, scripted(() => json({}, 503)).send);
    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it('treats an unreadable body as the server not reached', async () => {
    store.enqueue(create('a'));
    const flushed = await flush(
      store,
      scripted(() => new Response('not json', { status: 200 })).send,
    );
    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it('keeps the operations queued when the server refuses the request', async () => {
    store.enqueue(create('a'));
    await expect(
      flush(store, scripted(() => json({ title: 'Unauthorized' }, 401)).send),
    ).rejects.toBeInstanceOf(RefusalError);
    expect(store.pending()).toHaveLength(1);
  });

  // Review Focus 2: the server applied the batch, the answer never arrived.
  it('settles a resent operation the server reports as a duplicate', async () => {
    store.enqueue(create('a'));
    const applied = new Set<string>();
    const server = scripted(
      (request) => {
        for (const op of request.ops) applied.add(op.opId);
        throw new TypeError('socket hang up');
      },
      (request) =>
        json({
          cursor: 1,
          results: request.ops.map((op) => ({
            opId: op.opId,
            status: applied.has(op.opId) ? 'duplicate' : 'applied',
          })),
          changes: [],
        }),
    );

    expect((await flush(store, server.send)).synced).toBe(false);
    const second = await flush(store, server.send);

    expect(second.results).toEqual([{ opId: 'a', status: 'duplicate' }]);
    expect(store.pending()).toEqual([]);
    expect(store.entries()).toEqual([]);
  });

  // FR-007, ADR 0013: discard the replica, keep the outbox, ask for since 0.
  it('recovers from a 410 with a snapshot and keeps the outbox', async () => {
    store.mergeChanges([
      { table: 'task', id: 'gone', seq: 50, row: { id: 'gone', deletedAt: null } },
    ]);
    store.advanceCursor(50);
    store.enqueue(create('a'));
    const kept = { id: 'kept', deletedAt: null };
    const server = scripted(
      () => json({ title: 'Gone' }, 410),
      (request) =>
        applyAll(request, 900, [{ table: 'task', id: 'kept', seq: 800, row: kept }]),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests.map((r) => r.since)).toEqual([50, 0]);
    expect(server.requests[1]?.ops).toEqual([create('a')]);
    expect(flushed.synced).toBe(true);
    expect(store.rows('task')).toEqual([kept]);
    expect(store.cursor()).toBe(900);
    expect(store.pending()).toEqual([]);
  });

  it('refuses when the server answers 410 even to since 0', async () => {
    const server = scripted(
      () => json({}, 410),
      () => json({}, 410),
    );
    await expect(flush(store, server.send)).rejects.toBeInstanceOf(RefusalError);
  });

  // FR-010: the contract caps a batch at 1000 operations.
  it('sends a large outbox in batches, oldest first, carrying the cursor forward', async () => {
    for (let i = 0; i <= MAX_OPS; i++) store.enqueue(create(`op-${String(i).padStart(4, '0')}`));
    const server = scripted(
      (request) => applyAll(request, 10),
      (request) => applyAll(request, 20),
    );

    await flush(store, server.send);

    expect(server.requests.map((r) => r.ops.length)).toEqual([MAX_OPS, 1]);
    expect(server.requests[1]?.ops[0]?.opId).toBe(`op-${String(MAX_OPS).padStart(4, '0')}`);
    expect(server.requests.map((r) => r.since)).toEqual([0, 10]);
    expect(store.pending()).toEqual([]);
  });

  it('stops at the first batch the server does not answer', async () => {
    for (let i = 0; i <= MAX_OPS; i++) store.enqueue(create(`op-${i}`));
    const server = scripted((request) => applyAll(request, 10), unreachable);

    const flushed = await flush(store, server.send);

    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it("removes the caller's own refused operation and keeps another's as failed", async () => {
    store.enqueue(create('mine'));
    store.enqueue(create('theirs'));
    const server = scripted((request) =>
      json({
        cursor: 0,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'rejected',
          reason: 'no',
        })),
        changes: [],
      }),
    );

    await flush(store, server.send, new Set(['mine']));

    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['theirs', 'failed'],
    ]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/sync.spec.ts src/protocol.spec.ts`
Expected: FAIL — `Cannot find module './sync.js'` and `ownOutcome` not
exported.

- [ ] **Step 4: Add `ownOutcome` to `protocol.ts`**

Append to `apps/cli/src/protocol.ts` (add `OpResult` to its type import if it
is not there already):

```ts
/**
 * What happened to the one operation the running command queued, in a
 * response that may carry many. Throws when the server refused it, so the
 * command's exit code says so. `unreported` is not an error: the operation
 * is still in the outbox with its id, and a later command resends it safely.
 */
export function ownOutcome(
  results: OpResult[],
  opId: string,
): 'settled' | 'unreported' {
  const result = results.find((r) => r.opId === opId);
  if (result === undefined) return 'unreported';
  if (result.status === 'rejected') {
    throw new RefusalError(result.reason ?? 'the server refused this operation');
  }
  if (result.status === 'conflict') {
    throw new ConflictError(
      `the server holds a newer version of this row (version ${String(result.currentVersion)})`,
    );
  }
  return 'settled';
}
```

- [ ] **Step 5: Write `sync.ts`**

`apps/cli/src/sync.ts`:

```ts
import type { OpResult, SyncRequest, SyncResponse } from '@todoer/specs';
import { RefusalError } from './protocol.js';
import type { Store } from './store.js';

/** One POST /sync. Injected, so the flush is testable without a network. */
export type Transport = (request: SyncRequest) => Promise<Response>;

export type Flushed = { synced: boolean; results: OpResult[] };

/** The contract's `maxItems` for `ops`. */
export const MAX_OPS = 1000;

type Exchange = SyncResponse | 'gone' | 'unreached';

/**
 * One request and what became of it. "Unreached" covers everything after
 * which a resend is both safe and the right thing to do: no connection, a
 * timeout, a 5xx, a body that never arrived whole. A 4xx other than 410 is
 * the server refusing the request as it stands, which a resend cannot change.
 */
async function exchange(send: Transport, request: SyncRequest): Promise<Exchange> {
  let response: Response;
  try {
    response = await send(request);
  } catch {
    return 'unreached';
  }
  if (response.status === 410) return 'gone';
  if (response.status >= 500) return 'unreached';
  if (!response.ok) {
    throw new RefusalError(
      `sync refused: ${response.status} ${await response.text()}`,
    );
  }
  try {
    return (await response.json()) as SyncResponse;
  } catch {
    return 'unreached';
  }
}

/**
 * Sends every pending operation, oldest first, at most MAX_OPS per request,
 * and pulls what changed. Stops at the first request the server does not
 * answer: whatever was not sent stays queued with its id, which is what makes
 * the next attempt safe (ADR 0015 §4).
 *
 * `own` names the operations the running command queued; see Store.settle.
 */
export async function flush(
  store: Store,
  send: Transport,
  own: ReadonlySet<string> = new Set(),
): Promise<Flushed> {
  const pending = store.pending();
  const results: OpResult[] = [];
  // At least one request, so an empty outbox still pulls.
  for (let start = 0; start === 0 || start < pending.length; start += MAX_OPS) {
    const ops = pending.slice(start, start + MAX_OPS);
    let answer = await exchange(send, { since: store.cursor(), ops });
    if (answer === 'gone') {
      // The cursor predates tombstone retention: deletions it missed can no
      // longer be sent. Start the replica over; the outbox is untouched, and
      // the operations in this batch replay their outcomes (ADR 0013).
      store.resetReplica();
      answer = await exchange(send, { since: 0, ops });
      if (answer === 'gone') {
        throw new RefusalError('the server answered 410 to since 0');
      }
    }
    if (answer === 'unreached') return { synced: false, results };
    store.applyResponse(answer, own);
    results.push(...answer.results);
  }
  return { synced: true, results };
}
```

- [ ] **Step 6: Run the tests, lint, typecheck**

Run:

```bash
pnpm --filter @todoer/cli exec vitest run src/sync.spec.ts src/protocol.spec.ts
pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli lint && pnpm --filter @todoer/cli typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit** (tick T005 first)

```bash
git add apps/cli/src/sync.ts apps/cli/src/sync.spec.ts apps/cli/src/protocol.ts apps/cli/src/protocol.spec.ts specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "feat(cli): send the outbox and pull changes in one flush

Every command has to deliver what earlier invocations queued, recover from
a pruned cursor, and tell an unreachable server apart from a refusal:
the first two decide whether operations are kept, the last whether a
caller may retry."
```

---

### Task 6: The commands, the envelope and exit 5

**Implements:** FR-004, FR-006, FR-008, FR-009 — task-spec step T006; Review
Focus 3 and 4; SC-002, SC-003.

**Files:**

- Create: `apps/cli/src/run.ts`
- Create: `apps/cli/src/run.spec.ts`
- Modify: `apps/cli/src/index.ts` (rewrite)
- Modify: `apps/cli/src/usage.ts` (`HELP`), `apps/cli/src/usage.spec.ts`
- Modify: `apps/cli/src/protocol.ts`, `apps/cli/src/protocol.spec.ts`
  (remove plan A's `State`, `Row`, `applyChanges`, `liveTasks`,
  `readSyncResponse`, `assertNotRefused`, `NetworkError` and their tests)
- Modify: `apps/cli/src/config.ts` (remove `BASE`, `TOKEN`, `STATE`)

**Interfaces:**

- Consumes: `readConfig` (Task 2), `Store` (Task 3), `overlay`, `liveTasks`
  (Task 4), `flush`, `Transport` (Task 5), `ownOutcome` (Task 5),
  `planAdd`, `unknownCommand`, `wantsHelp`, `HELP`.
- Produces: `run(argv: string[], deps: Deps): Promise<Outcome>` with
  `type Deps = { store: Store; send: Transport; now: () => Date; newId: () => string }`
  and `type Outcome = { exit: 0 | 5; stdout: string[]; stderr: string[] }`;
  `run` throws `UsageError`, `RefusalError`, `ConflictError`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/src/run.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import { RefusalError, UsageError } from './protocol.js';
import { run, type Deps } from './run.js';
import { Store } from './store.js';
import type { Transport } from './sync.js';

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function deps(send: Transport): Deps {
  const store = Store.open(':memory:');
  stores.push(store);
  let n = 0;
  return {
    store,
    send,
    now: () => new Date('2026-09-26T10:00:00.000Z'),
    newId: () => `id-${++n}`,
  };
}

const unreachable: Transport = () => Promise.reject(new TypeError('fetch failed'));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Just enough of the server: creates rows, reports duplicates, pulls. */
function fakeServer() {
  let seq = 0;
  const rows = new Map<string, Change>();
  const requests: SyncRequest[] = [];
  const send: Transport = async (request) => {
    requests.push(structuredClone(request));
    const results = request.ops.map((op) => {
      if (op.kind === 'create' && !rows.has(op.id)) {
        rows.set(op.id, {
          table: op.table,
          id: op.id,
          seq: ++seq,
          row: { ...op.fields, id: op.id, deletedAt: null },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      return { opId: op.opId, status: 'duplicate' as const };
    });
    const changes = [...rows.values()].filter((c) => c.seq > request.since);
    const cursor = Math.max(request.since, ...changes.map((c) => c.seq));
    return json({ cursor, results, changes });
  };
  return { send, requests };
}

function envelope(stdout: string[]): unknown {
  expect(stdout).toHaveLength(1);
  return JSON.parse(stdout[0] ?? '');
}

const task = {
  title: 'call the bank',
  priority: 2,
  rank: 'a0',
  id: 'id-2',
  deletedAt: null,
};

describe('run', () => {
  it('adds a task online and says the server has it', async () => {
    const d = deps(fakeServer().send);
    const out = await run(['add', 'call the bank p2', '--json'], d);
    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toEqual({
      data: task,
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
    expect(out.stderr).toEqual([]);
  });

  // Scenario 1: queued, exit 5, the task is shown from the overlay.
  it('queues an add without a server and exits 5', async () => {
    const d = deps(unreachable);
    const out = await run(['add', 'call the bank p2', '--json'], d);
    expect(out.exit).toBe(5);
    expect(envelope(out.stdout)).toEqual({
      data: task,
      synced: false,
      outbox: { pending: 1, failed: 0 },
    });
    expect(out.stderr.join('\n')).toMatch(/not reached/);
  });

  // Scenario 2 and FR-003: a later command delivers it with its original id.
  it('delivers a queued add on the next command, with the id it was queued with', async () => {
    const d = deps(unreachable);
    await run(['add', 'call the bank'], d);
    const server = fakeServer();
    d.send = server.send;

    const out = await run(['list', '--json'], d);

    expect(server.requests[0]?.ops.map((op: Op) => op.opId)).toEqual(['id-1']);
    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toMatchObject({
      data: [{ id: 'id-2', title: 'call the bank' }],
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
  });

  // Review Focus 4.
  it('lists a queued task without a server', async () => {
    const d = deps(unreachable);
    await run(['add', 'offline task p1'], d);
    const out = await run(['list'], d);
    expect(out.exit).toBe(5);
    expect(out.stdout).toEqual(['1  offline task']);
  });

  it('prints plain text without --json', async () => {
    const d = deps(fakeServer().send);
    expect((await run(['add', 'call the bank p2'], d)).stdout).toEqual([
      'call the bank',
    ]);
    expect((await run(['list'], d)).stdout).toEqual(['2  call the bank']);
  });

  it("reports the command's own rejected add by throwing, and does not keep it", async () => {
    const d = deps(async (request) =>
      json({
        cursor: 0,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'rejected',
          reason: 'nope',
        })),
        changes: [],
      }),
    );
    await expect(run(['add', 'x'], d)).rejects.toThrow(RefusalError);
    expect(d.store.entries()).toEqual([]);
  });

  // Scenario 4 and FR-006.
  it('keeps an earlier operation the server refuses as failed, without failing the list', async () => {
    const d = deps(async (request) =>
      json({
        cursor: 0,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'rejected',
          reason: 'nope',
        })),
        changes: [],
      }),
    );
    d.store.enqueue({
      opId: 'earlier',
      kind: 'create',
      table: 'task',
      id: 'task-earlier',
      fields: { title: 'earlier', rank: 'a0' },
      ts: '2026-09-26T09:00:00.000Z',
    });

    const out = await run(['list', '--json'], d);

    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toMatchObject({
      synced: true,
      outbox: { pending: 0, failed: 1 },
    });
    expect(out.stderr.join('\n')).toMatch(/1 queued operation\(s\) failed/);
  });

  // Review Focus 3.
  it('keeps the add queued when the token is refused', async () => {
    const d = deps(async () => json({ title: 'Unauthorized' }, 401));
    await expect(run(['add', 'x'], d)).rejects.toThrow(RefusalError);
    expect(d.store.entries().map((e) => e.status)).toEqual(['pending']);
  });

  it('lists the outbox', async () => {
    const d = deps(unreachable);
    await run(['add', 'x'], d);
    const out = await run(['outbox', '--json'], d);
    expect(out.exit).toBe(5);
    expect(envelope(out.stdout)).toMatchObject({
      data: [{ opId: 'id-1', status: 'pending', reason: null }],
      outbox: { pending: 1, failed: 0 },
    });
  });

  it('drops a failed operation, and refuses a pending one', async () => {
    const d = deps(async (request) =>
      json({
        cursor: 0,
        results: request.ops
          .filter((op) => op.opId === 'bad')
          .map((op) => ({ opId: op.opId, status: 'rejected', reason: 'no' })),
        changes: [],
      }),
    );
    for (const opId of ['bad', 'waiting']) {
      d.store.enqueue({
        opId,
        kind: 'create',
        table: 'task',
        id: `task-${opId}`,
        fields: { title: opId, rank: 'a0' },
        ts: '2026-09-26T09:00:00.000Z',
      });
    }

    await expect(run(['outbox', 'drop', 'waiting'], d)).rejects.toThrow(UsageError);
    const out = await run(['outbox', 'drop', 'bad', '--json'], d);

    expect(envelope(out.stdout)).toMatchObject({ data: ['bad'] });
    expect(d.store.entries().map((e) => e.opId)).toEqual(['waiting']);
  });

  it('refuses a drop with no ids, an unknown outbox subcommand and an unknown command', async () => {
    const d = deps(fakeServer().send);
    await expect(run(['outbox', 'drop'], d)).rejects.toThrow(UsageError);
    await expect(run(['outbox', 'frob'], d)).rejects.toThrow(UsageError);
    await expect(run(['frob'], d)).rejects.toThrow(UsageError);
    await expect(run([], d)).rejects.toThrow(UsageError);
  });
});
```

In `apps/cli/src/usage.spec.ts`, add inside `describe('HELP', …)`:

```ts
  it('documents exit 5, the envelope, the outbox and the timeout', () => {
    expect(HELP).toMatch(/^\s+5 /m);
    expect(HELP).toMatch(/"synced"/);
    expect(HELP).toMatch(/todoer outbox drop/);
    expect(HELP).toMatch(/TODOER_TIMEOUT_MS/);
  });

  it('no longer tells callers that add is unsafe to retry', () => {
    expect(HELP).not.toMatch(/NOT safe to retry/);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/run.spec.ts src/usage.spec.ts`
Expected: FAIL — `Cannot find module './run.js'`; the two new HELP tests fail.

- [ ] **Step 3: Write `run.ts`**

`apps/cli/src/run.ts`:

```ts
import type { OpCreate } from '@todoer/specs';
import { liveTasks, overlay } from './overlay.js';
import { planAdd } from './parse-quick-add.js';
import { ownOutcome, UsageError } from './protocol.js';
import type { Row, Store } from './store.js';
import { flush, type Transport } from './sync.js';
import { unknownCommand } from './usage.js';

export type Deps = {
  store: Store;
  send: Transport;
  now: () => Date;
  newId: () => string;
};

export type Outcome = { exit: 0 | 5; stdout: string[]; stderr: string[] };

const UNREACHED =
  'the server was not reached: this answer is local, and queued operations will be sent by a later command';

/**
 * Every command: flush the outbox and pull first (design doc, Q5), then
 * answer from the replica with the outbox applied on top. Exit 5 whenever
 * the server was not reached (Q3). Refusals and conflicts of the command's
 * own operation are thrown; index.ts turns them into exit codes.
 */
export async function run(argv: string[], deps: Deps): Promise<Outcome> {
  const json = argv.includes('--json');
  const [command, ...rest] = argv.filter((arg) => arg !== '--json');
  const { store } = deps;
  const stderr: string[] = [];
  let synced: boolean;
  let data: unknown;
  let human: string[];

  if (command === 'add') {
    // Refuses an empty title and reports what it is not storing — see planAdd.
    const { title, priority, notice } = planAdd(rest.join(' '));
    if (notice !== null) stderr.push(notice);
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task',
      id: deps.newId(),
      fields: { title, priority, rank: 'a0' },
      ts: deps.now().toISOString(),
    };
    // Stored before it is sent: from here on, every attempt carries this id.
    store.enqueue(op);
    const flushed = await flush(store, deps.send, new Set([op.opId]));
    synced = flushed.synced && ownOutcome(flushed.results, op.opId) === 'settled';
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
  } else if (command === 'list') {
    ({ synced } = await flush(store, deps.send));
    const rows = liveTasks(tasks(store));
    data = rows;
    human = rows.map((row) => `${String(row.priority)}  ${String(row.title)}`);
  } else if (command === 'outbox' && rest[0] === 'drop') {
    const ids = rest.slice(1);
    if (ids.length === 0) {
      throw new UsageError('outbox drop needs at least one operation id');
    }
    ({ synced } = await flush(store, deps.send));
    store.drop(ids);
    data = ids;
    human = ids.map((id) => `dropped ${id}`);
  } else if (command === 'outbox' && rest.length === 0) {
    ({ synced } = await flush(store, deps.send));
    const entries = store.entries();
    data = entries;
    human = entries.map((e) =>
      [e.status, e.opId, `${e.op.kind} ${e.op.table}`, e.reason ?? '']
        .join('  ')
        .trimEnd(),
    );
  } else {
    throw unknownCommand(
      command === 'outbox' ? `outbox ${rest.join(' ')}` : command,
    );
  }

  const outbox = store.counts();
  if (!synced) stderr.push(UNREACHED);
  if (outbox.failed > 0) {
    stderr.push(
      `${outbox.failed} queued operation(s) failed — see \`todoer outbox\``,
    );
  }
  return {
    exit: synced ? 0 : 5,
    stdout: json ? [JSON.stringify({ data, synced, outbox })] : human,
    stderr,
  };
}

function tasks(store: Store): Row[] {
  return overlay('task', store.rows('task'), store.pending());
}
```

- [ ] **Step 4: Rewrite `index.ts`**

`apps/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { uuidv7 } from 'uuidv7';
import { readConfig } from './config.js';
import { ConflictError, RefusalError, UsageError } from './protocol.js';
import { run } from './run.js';
import { Store } from './store.js';
import type { Transport } from './sync.js';
import { HELP, wantsHelp } from './usage.js';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) {
    console.log(HELP);
    return 0;
  }
  const config = readConfig(process.env);
  const send: Transport = (request) =>
    fetch(`${config.base}/sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(request),
      // The whole exchange, body included: a server that accepts the
      // connection and never answers is as unreachable as one that refuses it.
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  const store = Store.open(config.dbPath);
  try {
    const outcome = await run(argv, {
      store,
      send,
      now: () => new Date(),
      newId: uuidv7,
    });
    // stderr first, and stdout exactly one value under --json.
    for (const line of outcome.stderr) console.error(line);
    for (const line of outcome.stdout) console.log(line);
    return outcome.exit;
  } finally {
    store.close();
  }
}

// The one place an error class becomes an exit code; what each code means to
// a caller is in usage.ts's HELP.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(`${message}\nrun \`todoer --help\` for usage and exit codes`);
      process.exitCode = 2;
    } else if (error instanceof RefusalError) {
      console.error(message);
      process.exitCode = 1;
    } else if (error instanceof ConflictError) {
      console.error(message);
      process.exitCode = 4;
    } else {
      // An unexpected local failure: the database busy past its timeout,
      // unreadable, or a bug. No network condition lands here any more.
      console.error(message);
      process.exitCode = 3;
    }
  },
);
```

- [ ] **Step 5: Remove plan A's leftovers**

In `apps/cli/src/protocol.ts`: delete `Row`, `State`, `NetworkError`,
`applyChanges`, `liveTasks`, `readSyncResponse` and `assertNotRefused`, and
rewrite the file's header comment to say what is left: the error classes
that map to exit codes 1, 2 and 4, and `ownOutcome`. Remove `Change` and
`SyncResponse` from its type import if nothing uses them.
In `apps/cli/src/protocol.spec.ts`: delete the `describe` blocks for
`applyChanges + liveTasks`, `readSyncResponse` and `assertNotRefused` (their
behaviour now lives in `store.spec.ts`, `overlay.spec.ts` and
`sync.spec.ts`), keep `ownOutcome`'s.
In `apps/cli/src/config.ts`: delete `BASE`, `TOKEN`, `STATE` and the comment
above them.

Run: `ugrep -rn 'NetworkError|applyChanges|readSyncResponse|assertNotRefused|state\.json|STATE\b' apps/cli/src`
Expected: no hits.

- [ ] **Step 6: Rewrite `HELP`**

Replace the `HELP` constant in `apps/cli/src/usage.ts` (keep its doc
comment's first sentence, and replace the rest of the comment with: "Every
command sends the outbox first; `add` is safe to run once because its
operation id is stored with it.") with:

```ts
export const HELP = `todoer — a client for a todoer instance

usage:
  todoer add "<text>" [--json]           create a task
  todoer list [--json]                   list the tasks that are not deleted
  todoer outbox [--json]                 list operations the server has not accepted
  todoer outbox drop <op-id>... [--json] forget failed operations
  todoer --help

Every command first sends the operations waiting in the outbox and fetches
what changed. Without a server it answers from the local copy and exits 5.

quick-add markers:
  p0..p4      priority
  #project    parsed, not stored — reported on stderr
  @tag        parsed, not stored — reported on stderr

environment:
  TODOER_URL         instance base URL, default http://localhost:3000/api/v1
  TODOER_TOKEN       bearer token. It expires 15 minutes after it is issued and
                     this CLI has no login command yet — mint one with
                     POST $TODOER_URL/auth/login and export it.
  TODOER_TIMEOUT_MS  how long to wait for the server, default 3000

local state:
  $HOME/.config/todoer/todoer.db — the local copy and the outbox (SQLite)

--json prints exactly one object:
  {"data": ..., "synced": true|false, "outbox": {"pending": n, "failed": n}}

exit codes (ADR 0015 §2):
  0  done, and the server has it
  1  the server refused: this command's operation was rejected, or any 4xx.
     A 401 means the token is missing, invalid or expired — get a new one;
     queued operations stay queued
  2  usage error — nothing was sent
  3  an unexpected local failure, such as the local database staying busy
  4  reserved for a conflict — the server holds a newer version of the row.
     No command sends an operation that can return one yet: add sends a
     create, and a create never conflicts
  5  the server was not reached: the answer is local, and this command's
     operation is queued and will be sent by a later command. Do not run the
     command again for the same intent — that would queue it twice

add is safe to run once: its operation id is stored with the operation and
reused on every later send, so a lost response never creates the task twice
(ADR 0005, ADR 0015 §4).

An operation the server refuses after the command that queued it has exited
is kept as failed: todoer outbox lists it, todoer outbox drop forgets it.
`;
```

- [ ] **Step 7: Run the tests, lint, typecheck, build**

Run:

```bash
pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli lint && pnpm --filter @todoer/cli typecheck
pnpm --filter @todoer/cli build
```

Expected: all pass.

- [ ] **Step 8: Prove it against a real server (SC-002)**

Start the backend (Postgres on 5433) and run the walking skeleton:

```bash
pnpm --filter @todoer/backend build
( cd apps/backend && DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer \
    JWT_SECRET=0123456789abcdef0123456789abcdef PORT=3010 node dist/main.js > /tmp/claude-1000/b1-backend.log 2>&1 & echo $! > /tmp/claude-1000/b1-backend.pid )
sleep 3
TODOER_URL=http://localhost:3010/api/v1 sh scripts/walking-skeleton.sh
kill "$(cat /tmp/claude-1000/b1-backend.pid)"
```

Expected: `walking skeleton passed`.

- [ ] **Step 9: Commit** (tick T006 first)

```bash
git add apps/cli/src specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "feat(cli): answer from the replica and exit 5 without a server

A caller branches on exit codes, not text. Exit 3 used to mean retry, and a
retried add was how duplicates happened; now an unreachable server means
the operation is queued with its id and the answer is local, which is
neither success nor a reason to retry. The --json envelope carries the
same facts, plus how many queued operations failed."
```

---

### Task 7: The outbox end to end, in CI

**Implements:** FR-001, FR-003, FR-007 against a live server — task-spec step
T007; SC-001; Review Focus 1.

**Files:**

- Create: `scripts/outbox-e2e.sh`
- Modify: `.github/workflows/test.yml` (a step after "Prove the walking
  skeleton end to end", before "Stop the backend")

**Interfaces:**

- Consumes: the built CLI (`apps/cli/dist/index.js`), a running backend at
  `TODOER_URL`, and `DATABASE_URL` pointing at the database that backend uses
  (the CI job already sets it; `psql` moves the watermark for the `410` step).

- [ ] **Step 1: Write the script**

`scripts/outbox-e2e.sh`:

```sh
#!/usr/bin/env sh
# The outbox, end to end, against a live server: operations queued with no
# server reach it on a later command with their original ids, parallel
# invocations lose nothing, and a cursor older than the prune watermark
# recovers through a snapshot. POSIX sh — see the walking skeleton's header.
set -eu

BASE=${TODOER_URL:-http://localhost:3000/api/v1}
: "${DATABASE_URL:?DATABASE_URL must name the database the backend uses}"
EMAIL="outbox-$(date +%s)-$$@example.test"
PASSWORD="correct horse battery staple"
CLI="node apps/cli/dist/index.js"
# Port 9 (discard): nothing listens there, so the connection is refused.
UNREACHABLE=http://127.0.0.1:9/api/v1

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# field EXPR — evaluates EXPR against the JSON object on stdin, as `v`.
field() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log(JSON.stringify($1))})"
}

curl -sf -X POST "$BASE/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null
LOGIN=$(curl -sf -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
TOKEN=$(printf '%s' "$LOGIN" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || fail 'could not obtain a token'
export TODOER_TOKEN="$TOKEN"

WRITER=$(mktemp -d)
READER=$(mktemp -d)
CODES=$(mktemp -d)
trap 'rm -rf "$WRITER" "$READER" "$CODES"' EXIT

# 1. Ten adds at once with no server: each is queued and exits 5, and the
#    outbox holds all ten — the reason the replica is SQLite.
i=1
while [ "$i" -le 10 ]; do
  (
    set +e
    HOME="$WRITER" TODOER_URL=$UNREACHABLE $CLI add "offline $i" --json >/dev/null 2>&1
    echo $? >"$CODES/$i"
  ) &
  i=$((i + 1))
done
wait
for f in "$CODES"/*; do
  [ "$(cat "$f")" = 5 ] || fail "an offline add exited $(cat "$f"), not 5"
done

set +e
QUEUED=$(HOME="$WRITER" TODOER_URL=$UNREACHABLE $CLI outbox --json 2>/dev/null)
rc=$?
set -e
[ "$rc" = 5 ] || fail "the offline outbox command exited $rc, not 5"
[ "$(printf '%s' "$QUEUED" | field 'v.outbox.pending')" = 10 ] ||
  fail "the outbox does not hold 10 operations: $QUEUED"

# 2. Back online: the next command delivers all ten, and a second client
#    with its own replica sees them.
HOME="$WRITER" TODOER_URL="$BASE" $CLI list --json >/dev/null ||
  fail 'the first online command did not exit 0'
PENDING=$(HOME="$WRITER" TODOER_URL="$BASE" $CLI outbox --json | field 'v.outbox.pending')
[ "$PENDING" = 0 ] || fail "$PENDING operations still queued after an online command"
SEEN=$(HOME="$READER" TODOER_URL="$BASE" $CLI list --json |
  field "v.data.filter(t => t.title.startsWith('offline ')).length")
[ "$SEEN" = 10 ] || fail "the second client sees $SEEN of the 10 queued tasks"

# 3. A stale cursor. The reader writes once more, so the user's newest seq is
#    above the writer's cursor; moving the watermark there makes the writer's
#    cursor older than what was pruned — 410 — and the writer must recover
#    with a snapshot and lose nothing.
HOME="$READER" TODOER_URL="$BASE" $CLI add 'after the writer' >/dev/null
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "
  UPDATE \"User\" u
     SET \"prunedThroughSeq\" = (SELECT max(seq) FROM \"Task\" t WHERE t.\"userId\" = u.id)
   WHERE u.email = '$EMAIL'"
AFTER=$(HOME="$WRITER" TODOER_URL="$BASE" $CLI list --json) ||
  fail 'the list after the watermark moved did not exit 0'
[ "$(printf '%s' "$AFTER" | field "v.data.length")" = 11 ] ||
  fail "the snapshot does not hold all 11 tasks: $AFTER"
HOME="$WRITER" TODOER_URL="$BASE" $CLI list >/dev/null ||
  fail 'the command after the snapshot did not exit 0'

echo 'outbox e2e passed'
```

- [ ] **Step 2: Run it locally against a live backend**

Run (Postgres on 5433; `psql` installed locally, or use
`docker exec -i todoer-dev-postgres-1 psql` by setting `DATABASE_URL` to a URL
reachable from the host — the local `psql` is simplest):

```bash
pnpm --filter @todoer/backend build && pnpm --filter @todoer/cli build
( cd apps/backend && DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer \
    JWT_SECRET=0123456789abcdef0123456789abcdef PORT=3010 node dist/main.js > /tmp/claude-1000/b1-backend.log 2>&1 & echo $! > /tmp/claude-1000/b1-backend.pid )
sleep 3
TODOER_URL=http://localhost:3010/api/v1 DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer sh scripts/outbox-e2e.sh
kill "$(cat /tmp/claude-1000/b1-backend.pid)"
```

Expected: `outbox e2e passed`. Then prove it can fail: temporarily make
`Store.enqueue` a no-op, rebuild the CLI, rerun — it must print a `FAIL:`
line (step 1 or 2). Revert and rebuild.

- [ ] **Step 3: Run it in CI**

In `.github/workflows/test.yml`, after the step "Prove the walking skeleton
end to end" and before "Stop the backend", add:

```yaml
      # The outbox against the same live backend: parallel offline adds, their
      # delivery with the original ids, and 410 recovery. DATABASE_URL comes
      # from the job's env; the script moves the prune watermark with psql.
      - name: Prove the outbox end to end
        env:
          TODOER_URL: http://localhost:3010/api/v1
        run: sh scripts/outbox-e2e.sh
```

Check that the runner has `psql`: the GitHub `ubuntu-latest` image ships
`postgresql-client`. If the CI run fails with `psql: not found`, add a step
before this one: `run: sudo apt-get install -y postgresql-client`.

- [ ] **Step 4: Commit** (tick T007 first)

```bash
git add scripts/outbox-e2e.sh .github/workflows/test.yml specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "test(cli): prove the outbox end to end against a live server

The unit tests use a fake transport and one process. What the outbox is
for — parallel invocations, delivery after an outage with the original
ids, recovery from a pruned cursor — only shows against a real server and
real processes."
```

---

### Task 8: The records

**Implements:** FR-012 — task-spec step T008; SC-003.

**Files:**

- Modify: `docs/adr/0015-the-cli-is-a-client-for-automation.md`
- Modify: `docs/specs/2026-09-25-domain-and-sync-design.md` (§3 "What the
  client does")
- Modify: `docs/specs/2026-09-26-plan-b-outbox-offline-design.md` ("Open
  threads", "Deferred")
- Modify: `README.md` (the CLI description and the "not built yet" paragraph)
- Modify: `apps/cli/src/parse-quick-add.ts` (the `planAdd` doc comment)

**Interfaces:**

- Consumes: the behaviour of Tasks 1–7.

- [ ] **Step 1: Find every stale claim**

Run:

```bash
ugrep -rn -i 'not safe to retry|plan B|arrive with the outbox|state\.json|exit 3|indeterminate' \
  --include='*.md' --include='*.ts' . -g '!node_modules' -g '!docs/plans/*' -g '!specs/tasks/done/*' -g '!**/dist/**'
```

Expected: hits in the files listed above. Each one that describes the CLI
as it was before this plan is fixed below; any hit in another file is fixed
too and named in the report.

- [ ] **Step 2: ADR 0015**

Append to `docs/adr/0015-the-cli-is-a-client-for-automation.md`:

```md
## Update, 2026-09-26: the outbox

Requirement 4 is met. The CLI keeps a SQLite replica and outbox at
`$HOME/.config/todoer/todoer.db`; every operation is stored before it is
sent and keeps its id on every attempt. Every command sends the outbox first.

Two additions to the contract of requirements 1 and 2:

- **Exit 5** means the server was not reached — no connection, a timeout, a
  5xx: the answer is local and the command's operation is queued. It is not a
  failure and must not be retried; the next command that reaches the server
  delivers the operation. Exit 3 no longer describes a network condition; it
  is an unexpected local failure.
- **The `--json` envelope**: every command prints
  `{"data": …, "synced": bool, "outbox": {"pending": n, "failed": n}}`.
  `synced` is false exactly when the command exits 5. `outbox.failed` counts
  operations the server refused after the command that queued them had exited;
  `todoer outbox` lists them and `todoer outbox drop` forgets them.
```

- [ ] **Step 3: The sync spec, §3 "What the client does"**

In `docs/specs/2026-09-25-domain-and-sync-design.md`, after the paragraph that
begins "Queue operations in the outbox and apply them optimistically to the
local replica.", add:

```md
"Apply optimistically" is an overlay, not a write: the replica holds only
what the server sent, and a read applies the pending operations on top of it
([plan B design, Q7](2026-09-26-plan-b-outbox-offline-design.md)). A pull
therefore never has to reconcile a local edit, and discarding the replica
after a `410` cannot lose an unsent operation. A `conflict` or `rejected`
result for an operation queued by an earlier session is kept, marked failed,
until the person has seen it; the reference CLI shows it in `todoer outbox`.
```

- [ ] **Step 4: The plan-B design doc**

In `docs/specs/2026-09-26-plan-b-outbox-offline-design.md`:

Replace the whole "## Open threads" section body with:

```md
Resolved by the B1 plan
([docs/plans/2026-09-26-plan-b1-cli-outbox.md](../plans/2026-09-26-plan-b1-cli-outbox.md),
"Rulings"):

- **Connection timeout:** `TODOER_TIMEOUT_MS`, default 3000, on the whole
  request.
- **Removing failed entries:** `todoer outbox drop <op-id>…` removes failed
  entries only; a pending one may already be on the server.
- **Batch size:** at most 1000 operations per request, oldest first,
  stopping at the first request the server does not answer.
```

Replace the "## Deferred" section body ("None. Every question asked was
answered.") with:

```md
- **Storing `#project` and `@tag` from quick-add.** Not asked in the
  interview, and not a detail: ADR 0007 makes `@home` a context tag, and two
  devices creating `@home` offline would create two tags with one name. It
  needs its own decision on name uniqueness under client-generated ids
  before any client creates tags from text. The CLI parses both markers and
  reports them on stderr as not stored.
```

- [ ] **Step 5: The README**

In `README.md`, rewrite the CLI bullet and the "Not built yet…" paragraph so
that they say: the CLI works offline (a local SQLite replica and outbox;
without a server it answers locally and exits 5; `add` is safe to run once);
still not built: storing `#project`/`@tag`, recurrence, and the web and
Flutter clients. Remove every statement that `add` is not safe to retry and
every reference to "see below" that pointed at it; if a section below
explains the unsafe retry, rewrite it to describe the outbox in two or three
sentences instead.

- [ ] **Step 6: `planAdd`'s comment**

In `apps/cli/src/parse-quick-add.ts`, the doc comment on `planAdd` says
creating the rows "is plan B's work". Replace that sentence with: "Storing
them is not built: it needs a decision on tag-name uniqueness first (see the
plan-B design doc, "Deferred")." Keep the rest of the comment. No code change.

- [ ] **Step 7: Record the deferred question**

Run:

```bash
tuxedo add "todoer: decide how quick-add #project/@tag become rows — name uniqueness when two offline clients create the same tag with different ids (ADR 0005 vs ADR 0007); then store them from the CLI +todoer @design"
```

- [ ] **Step 8: Check**

Run the Step 1 search again. Expected: no hit that describes the old CLI
(the plan files and `specs/tasks/done/` are excluded). Review the Markdown you
touched by hand (`*.md` is prettier-ignored): blank lines around headings and
fences, no double blank lines, headings without final punctuation, links
resolve. Then `pnpm --filter @todoer/cli lint` and `pnpm exec prettier --check .`.

- [ ] **Step 9: Commit** (tick T008 first)

```bash
git add docs README.md apps/cli/src/parse-quick-add.ts specs/tasks/active/T-2026-09-26-cli-outbox.md
git commit -m "docs: record the outbox, exit 5 and the envelope

ADR 0015 named requirement 4 as the one that would be missed; it is met
now, and the exit-code contract it defines gained a value. The README and
HELP said add was unsafe to retry, and quick-add promised tag storage that
this plan deliberately does not build."
```

- [ ] **Step 10: Open the PR** (after the controller's final review)

```bash
git push -u origin feat/cli-outbox
gh pr create --title "feat(cli): work offline with a SQLite outbox" --body "<summary; ends with the Claude Code line>"
```

Then close the task: tick every Definition of Done item, set
`- Status: done`, add `- Completed:` and `- Result: <PR URL>`, `git add` the
file, then `git mv` it to `specs/tasks/done/`, commit, push; prepend the
changelog line to the dnote note `CHANGELOG todoer`.
