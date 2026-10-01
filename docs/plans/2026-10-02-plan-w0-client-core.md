# Plan W0: Extract `packages/client-core` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the client logic every client shares moves out of `apps/cli` into a
new workspace package, `@todoer/client-core`, and the CLI runs on it with no
change in behaviour. That logic is the replica `Store`, outbox, overlay,
sync/flush, transport, token source, expander, current occurrence, labels,
merge, quick-add parsing, refs, and the domain operations now inside
`run.ts`. The CLI keeps argv parsing, output formatting and the `--json`
envelope, HELP, config/env, password reading, exit-code mapping, the session
commands (`login`/`logout`), and the file-system side of opening the database.

**Architecture:** `Store` talks to SQLite only through `SqlDatabase`, a
six-member synchronous adapter (`exec`, `run`, `all`, `inTransaction`,
`withWriteLock`, `close`). The interface is sized so that `node:sqlite`'s
`DatabaseSync` and `@sqlite.org/sqlite-wasm`'s `oo1.DB` each implement it in
about 40 lines (Q3, Q12, Q13). The package has two entries. `.` is portable:
it imports no `node:*` module and uses no Node global, and lint enforces
that. `./node-sqlite` holds the `DatabaseSync` adapter, with the
cross-process write lock (`withWriteLock` polling with `busy_timeout` off).
The CLI's `openStore` keeps the path, the 0700 directory, the 077 umask,
`chmod 0600` and `retryOnBusy` around the first `WAL` + schema. The domain
operations become plain functions over
`{ store, send, now, newId }`. The CLI's `Deps` already has that shape, so
`run.ts` passes its `deps` straight through.

**Tech Stack:** TypeScript (NodeNext ESM, built with `tsc` like the CLI),
`node:sqlite`, Vitest, pnpm workspace + turbo. No new dependencies.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md)
— Q3, Q12, Q13, Q16, Verified facts, Risks ("Core extraction (W0)").
Task spec:
[`specs/tasks/active/T-2026-10-02-client-core.md`](../../specs/tasks/active/T-2026-10-02-client-core.md).

## Where this plan departs from the design doc and the brief

Task 6 records them in the design doc.

1. **The `DatabaseSync` adapter lives in client-core, behind its own entry
   (`@todoer/client-core/node-sqlite`), not in `apps/cli`.** The brief keeps
   the whole `node:sqlite` binding in the CLI. Most of it stays there: the
   path, the directory and file modes, the umask and `retryOnBusy`. But the
   specs that move with `Store`, `tokenSource` and `httpTransport` assert
   things only the real lock can make true. Two `Store`s on one file wait for
   each other in `withWriteLock`, and two processes holding the same refused
   token spend the refresh token once (`store.spec`, `auth.spec`,
   `transport.spec`). A test-only copy of the lock would be a second
   implementation of the most delicate code in the client. Q3 itself calls
   the adapter "the only per-platform part of the core". The portable entry
   never imports `./node-sqlite`; a lint rule forbids `node:*` everywhere
   else in the package.
   *Alternative, rejected (controller, 2026-10-02):* the binding stays
   whole in the CLI, and the DB-backed specs of core code (`store`, `sync`,
   `auth`, `transport`, 66 tests) stay in `apps/cli` as integration tests.
   The core would then ship `Store`, `flush` and `tokenSource` with no test
   in its own package.
2. **The adapter has no `prepare`, and no `get`.** Q3 lists `prepare`, but
   `Store` never keeps a statement handle. `run(sql, params)` and
   `all(sql, params)` map directly to `DatabaseSync.prepare(sql).run(...)`
   and to oo1's `db.exec({ sql, bind, rowMode: 'object', returnValue:
   'resultRows' })`. `get` is `all(...)[0]`: every `get` today reads a
   one-row lookup. `settle` and `mergeChanges` now prepare once per row
   instead of once per call; at about 10 µs a statement that does not matter
   at the size of a pull.
3. **`Store.transaction` stays in the portable core; only `withWriteLock` is
   per platform.** `BEGIN IMMEDIATE` / `COMMIT` / a `ROLLBACK` guarded by
   `inTransaction` is plain SQL that works the same on both engines. The
   asynchronous lock is the platform part. On Node it polls across
   processes. In the web's leader worker (W2) it will be `BEGIN IMMEDIATE`
   behind an in-worker queue.
4. **Built with `tsc`, not `tsup`.** `@todoer/specs` uses tsup only because
   its generated code has extension-less imports (its `tsconfig.json` says
   so). The moved code already builds with the CLI's `tsc` config, one ESM
   file per module, and `./node-sqlite` is then simply
   `dist/node-sqlite.js`.
5. **`login`, `logout`, `adoptAccount`, `subject` and `revoke` stay in
   `run.ts`.** The brief does not list them, and `subject` reads the token
   with `Buffer`. The web signs in with the refresh cookie (ADR 0011, W1/W2),
   a different flow. `tokenSource` and `httpAuthApi` do move.
6. **The error classes move unchanged, with their CLI wording.**
   `UsageError`, `RefusalError` and `ConflictError` go to client-core,
   because `Store.drop`, `resolveRef`, `planAdd`, `pickView`,
   `pickOccurrence`, `flush` and `submit` all throw them. Their messages keep
   today's text, including CLI flag names (`--on must be a date`,
   `do not run done again`). Rewording them for a GUI is W2's call. Changing
   them here would change CLI output.

## Global Constraints

- **No behaviour change.** Code moves verbatim. The only edits allowed in a
  moved file are import paths, `Config` → `HttpConfig` in `transport.ts` and
  `auth.ts`, and the `SqlDatabase` calls in `store.ts`. Call order of `now()`
  and `newId()` is preserved exactly: `run.spec` pins ids `id-1`, `id-2`, ….
- **Tests are the proof.** Baseline on `main` (recorded 2026-10-01):
  `@todoer/cli` 16 files, **331** tests. After W0: client-core 171, CLI 160,
  sum 331, every one passing. A moved spec is the same spec. The only edits
  allowed in it are import paths, `Store.open(` → `openStore(`, the three
  fixture edits named in Tasks 2 and 4, and the race test's build directory
  (Task 2). No assertion is added, removed or weakened.
- **E2E scripts untouched:** `git diff main -- scripts/` is empty at the end,
  and both `scripts/walking-skeleton.sh` and `scripts/outbox-e2e.sh` pass
  against a live backend after Task 2, Task 5 and Task 6.
- **Portable entry:** nothing under `packages/client-core/src` except
  `node-sqlite.ts`, `test-store.ts` and `*.spec.ts` imports `node:*` or uses
  `Buffer` / `process`; ESLint enforces it from Task 1 on.
- **ESM:** relative imports keep their `.js` suffix (NodeNext); the package
  resolves through `exports` to `dist/` only.
- **Node floor:** the root `engines.node` (`>=24.15`); the package declares no
  engines of its own, like the CLI.
- **TZ:** client-core's `vitest.config.mjs` sets `TZ=UTC` exactly like the
  CLI's; the CLI keeps its own (`run.spec` uses the 10:00Z clock).
- **Running tests:** through turbo
  (`pnpm -w exec turbo run build typecheck test --filter=@todoer/cli...`), or
  build client-core first. `pnpm --filter @todoer/cli test` alone runs
  against whatever `packages/client-core/dist` holds.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; `pnpm format` first; `git mv` for every move so
  `git log --follow` keeps history; never commit to `main`. Branch
  `refactor/client-core`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **Node leaking into the portable entry.** A `node:*` import, `Buffer`,
   `process`, or a `node:sqlite` type in `index.d.ts` breaks the web worker
   build in W2, long after this PR merged. Check:
   `rg -l "node:|Buffer|process\." packages/client-core/src --glob '!*.spec.ts'`
   lists only `node-sqlite.ts` and `test-store.ts`, and
   `rg -l "node:" packages/client-core/dist/*.d.ts` lists only
   `node-sqlite.d.ts` (Tasks 1–5).
2. **Error class identity.** `index.ts` maps errors to exit codes with
   `instanceof`. A second `UsageError` would turn every exit 1, 2 and 4 into
   exit 3: a leftover `protocol.ts` in the CLI, or a test importing core by a
   source path instead of the package name. Check:
   `rg "class (Usage|Refusal|Conflict)Error" apps packages` gives one hit
   each, and the manual exit-code probe in Task 1 (Tasks 1, 5).
3. **Call order and the transaction seam.** `run.spec` pins `newId()` order
   (`id-1`…) and replaces `store.transaction` on one instance to stage a
   race. `submit` must keep calling `store.transaction(...)`, not the adapter
   directly. `mark`'s `statusOps` builder must stay lazy inside that
   transaction. `add` must mint label creates, then `opId`, then `id`, then
   link ops (Task 5).
4. **Timezone.** A spec moved into a runner without `TZ=UTC` passes on CI
   (UTC) and fails on a developer machine in UTC+3. `occurrence.spec` also
   flips `process.env.TZ` at runtime; the lint rule must exempt specs, not
   force a rewrite (Tasks 1, 3).
5. **Module resolution at runtime.** `apps/cli/dist/index.js` must resolve
   `@todoer/client-core` and `@todoer/client-core/node-sqlite` from
   `packages/client-core/dist` through `exports`, which is what the e2e
   scripts run. The parallel-open test in `apps/cli/src/store.spec.ts`
   compiles the CLI into a temporary directory and imports it from a child
   process. A directory under `os.tmpdir()` cannot resolve a bare specifier,
   so that directory moves under `apps/cli/node_modules/` (Task 2).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] `specs/tasks/active/T-2026-10-02-client-core.md` exists (FR-001…FR-007,
      steps T001–T006). Resolve its open question (departure 1) with the
      maintainer before Task 2.
- [ ] Commit `docs(plans): plan W0, the client-core extraction` on
      `refactor/client-core` — body: W0 of the client-shells design; the plan
      fixes the cut and the proof before any code moves.

---

### Task 1: Scaffold `@todoer/client-core` with the protocol errors

Implements FR-001, FR-003 (T001). Departures 4, 6.

The smallest move that exercises the whole pipeline: a built package, the
CLI resolving it from `dist/`, and `instanceof` across the package boundary.
An empty package would fail `vitest run` ("No test files found").

**Files:**

- Create: `packages/client-core/package.json`, `tsconfig.json`,
  `tsconfig.build.json`, `vitest.config.mjs`, `src/index.ts`
- Move: `apps/cli/src/protocol.ts` → `packages/client-core/src/protocol.ts`;
  `apps/cli/src/protocol.spec.ts` → `packages/client-core/src/protocol.spec.ts`
- Modify: `apps/cli/package.json` (dependency), every CLI file importing
  `./protocol.js` (`index.ts`, `run.ts`, `store.ts`, `sync.ts`, `auth.ts`,
  `ref.ts`, `parse-quick-add.ts`, `usage.ts`, `config.ts` and the specs
  `config.spec`, `ref.spec`, `parse-quick-add.spec`, `store.spec`,
  `sync.spec`, `auth.spec`, `transport.spec`, `run.spec`),
  `eslint.config.mjs`, `pnpm-lock.yaml`

**Interfaces:**

- Produces: `@todoer/client-core` exporting `RefusalError`, `UsageError`,
  `ConflictError`, `type Refusal`, `refusalOf`, `ownOutcome`,
  `throwRefusals` (signatures unchanged).

- [ ] **Step 0: Baseline** — on a clean tree:
      `pnpm -w exec turbo run build && pnpm --filter @todoer/cli test` →
      16 files, 331 tests. Write both numbers into the PR description.
- [ ] **Step 1: Package** — `packages/client-core/package.json`:

```json
{
  "name": "@todoer/client-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./node-sqlite": {
      "types": "./dist/node-sqlite.d.ts",
      "default": "./dist/node-sqlite.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@todoer/specs": "workspace:^"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "^5.6.3",
    "vitest": "^5.0.2"
  }
}
```

  `./node-sqlite` points at a file Task 2 creates; nothing imports it before
  then. `tsconfig.json` and `tsconfig.build.json` are copies of the CLI's.
  `tsconfig.build.json` additionally excludes `src/test-store.ts` (Task 2).
  `vitest.config.mjs` is a copy of the CLI's, comment included: `TZ=UTC`.
  `src/index.ts`:

```ts
export * from './protocol.js';
```

- [ ] **Step 2: Move** — `git mv` both protocol files; rewrite every
      `from './protocol.js'` in `apps/cli/src` to
      `from '@todoer/client-core'`; add `"@todoer/client-core": "workspace:^"`
      to `apps/cli/package.json` `dependencies`; `pnpm install` (lockfile
      gains the importer; no new package is downloaded).
- [ ] **Step 3: Lint guard** — in `eslint.config.mjs`, before the `*.{js,mjs}`
      block:

```js
  // client-core's portable entry also runs in a browser worker (design,
  // Q13): Node stays in node-sqlite.ts, and in specs and their fixture.
  {
    files: ['packages/client-core/src/**/*.ts'],
    ignores: [
      'packages/client-core/src/node-sqlite.ts',
      'packages/client-core/src/test-store.ts',
      '**/*.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'Node-only code belongs in node-sqlite.ts.' }] },
      ],
      'no-restricted-globals': ['error', 'Buffer', 'process'],
    },
  },
```

- [ ] **Step 4: Turbo** — no `turbo.json` change: `build`, `typecheck`,
      `test` and `lint` already depend on `^build`. Confirm the order:
      `pnpm -w exec turbo run build --dry=json | jq '.tasks[] | {taskId, dependencies}'`
      shows `@todoer/cli#build` → `@todoer/client-core#build` →
      `@todoer/specs#build`. No CI change either: `Workspace tests` runs
      `turbo run build typecheck test`, and `Lint` runs `pnpm lint`, which
      builds dependencies first.
- [ ] **Step 5: Run** — `pnpm -w exec turbo run build typecheck test lint`
      → client-core 1 file / 4 tests, CLI 15 files / 327 tests; `pnpm lint`.
- [ ] **Step 6: Exit-code probe** (Review Focus 2), after the build:

```sh
node apps/cli/dist/index.js bogus; echo "exit $?"                 # exit 2
HOME=$(mktemp -d) TODOER_URL=http://127.0.0.1:9 node apps/cli/dist/index.js list; echo "exit $?"   # exit 5
HOME=$(mktemp -d) TODOER_TIMEOUT_MS=x node apps/cli/dist/index.js list; echo "exit $?"             # exit 2
```

- [ ] **Step 7: Mutations** — (a) in client-core `throwRefusals`, drop the
      `(×${n})` count → `protocol.spec` goes red in client-core's run, proving
      the moved spec runs there. (b) Temporarily put a copy of `UsageError` in
      `apps/cli/src/config.ts` and throw that instead → the third probe
      prints `exit 3`. Revert both.
- [ ] **Step 8: Commit** `build(client-core): scaffold the shared client
      package with the protocol errors` — body: W0 of the client-shells
      design; the errors go first because every other module throws them,
      and moving them alone proves the dist resolution and the instanceof
      mapping before anything larger moves. Tick T001.

---

### Task 2: `Store` on a synchronous database adapter

Implements FR-002, FR-003 (T002). Departures 1, 2, 3.

**Files:**

- Move: `apps/cli/src/store.ts` → `packages/client-core/src/store.ts`;
  `apps/cli/src/store.spec.ts` → `packages/client-core/src/store.spec.ts`
- Create: `packages/client-core/src/node-sqlite.ts`,
  `packages/client-core/src/test-store.ts`, a new `apps/cli/src/store.ts`,
  a new `apps/cli/src/store.spec.ts`
- Modify: `packages/client-core/src/index.ts`; CLI importers of `./store.js`
  (`index.ts`, `run.ts`, `sync.ts`, `auth.ts`, `overlay.ts`, `labels.ts`,
  `merge.ts`, `occurrence.ts`, `ref.ts`, specs `run.spec`, `sync.spec`,
  `auth.spec`, `transport.spec`)

**Interfaces:**

- Produces (portable, `@todoer/client-core`):

```ts
export type SqlValue = string | number | null;

/**
 * The only per-platform part of the core (design, Q3). Synchronous: the core
 * runs beside SQLite in one thread, a CLI process or the web's leader worker
 * (Q13). node:sqlite's DatabaseSync and sqlite-wasm's oo1.DB each implement
 * it directly.
 */
export interface SqlDatabase {
  /** One or more statements, no parameters, no result. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  /** Every row, as an object keyed by column name. */
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** False outside BEGIN … COMMIT, including after SQLite ended one itself. */
  readonly inTransaction: boolean;
  /** BEGIN IMMEDIATE held across awaits until `fn` settles: COMMIT on
   *  resolve, ROLLBACK (when still open) on reject. How a second caller waits
   *  is the platform's business. */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
}

export const SCHEMA: string;                 // the CREATE TABLE IF NOT EXISTS block, verbatim
export type Row, OutboxEntry, StoredAuth;    // unchanged
export class Store {
  constructor(db: SqlDatabase);              // was: private, via Store.open(path)
  // every other public method unchanged, including transaction() and
  // withWriteLock(), which now delegates to db.withWriteLock
}
```

- Produces (`@todoer/client-core/node-sqlite`):

```ts
export const BUSY_TIMEOUT_MS = 5000;
export function isSqliteBusy(error: unknown): boolean;
export class NodeSqlite implements SqlDatabase {
  constructor(path: string);                 // new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS })
}
```

- Produces (CLI, `apps/cli/src/store.ts`): `openStore(path: string): Store`
  and `retryOnBusy` (signature unchanged).
- How oo1 implements the interface in W2 (recorded here, built there):
  `exec(sql)` → `db.exec(sql)`; `run` → `db.exec({ sql, bind: params })`;
  `all` → `db.exec({ sql, bind: params, rowMode: 'object', returnValue:
  'resultRows' })`; `inTransaction` →
  `sqlite3.capi.sqlite3_get_autocommit(db.pointer) === 0`; `withWriteLock`
  → a promise queue around `BEGIN IMMEDIATE`/`COMMIT`; `close` →
  `db.close()`.

- [ ] **Step 1: Move `Store`** — `git mv` the file. In client-core
      `store.ts`, delete the `node:*` imports, `BUSY_TIMEOUT_MS`,
      `WRITE_LOCK_WAIT_MS`, `SQLITE_BUSY`, `isSqliteBusy`, `sleepSync`,
      `retryOnBusy` and `Store.open`. Export `SCHEMA` and the interface
      above. Then make these changes and nothing else:
  - `constructor(private readonly db: SqlDatabase) {}`. The field stays
    named `db`: two specs reach it as `store.db`.
  - each `this.db.prepare(SQL).get(...args) as unknown as T | undefined` →
    `this.db.all<T>(SQL, [...args])[0]`;
    `.all(...args) as unknown as T[]` → `this.db.all<T>(SQL, [...args])`;
    `.run(...args)` → `this.db.run(SQL, [...args])`. In `settle`, `drop`
    and `mergeChanges`, inline the hoisted statements into those calls.
  - `transaction` stays as it is, with `this.db.isTransaction` →
    `this.db.inTransaction`; likewise in `resetReplica`.
  - `withWriteLock(fn) { return this.db.withWriteLock(fn); }`.
- [ ] **Step 2: Node adapter** — `node-sqlite.ts` takes the deleted pieces
      verbatim, comments included:

```ts
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlValue } from './store.js';

/** What every ordinary statement waits for a busy database. */
export const BUSY_TIMEOUT_MS = 5000;
/** (WRITE_LOCK_WAIT_MS comment, verbatim) */
const WRITE_LOCK_WAIT_MS = 10_000;
/** (SQLITE_BUSY comment, verbatim) */
const SQLITE_BUSY = 5;

export function isSqliteBusy(error: unknown): boolean { /* verbatim */ }

/** SqlDatabase over node:sqlite. A statement is prepared per call, as Store
 *  did before W0 for all but settle and mergeChanges. */
// ponytail: no statement cache; add a Map<string, StatementSync> if a pull
// of many thousands of rows ever shows up in a profile.
export class NodeSqlite implements SqlDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  }

  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  /** (Store.withWriteLock comment and body, verbatim, on this.db) */
  async withWriteLock<T>(fn: () => Promise<T>): Promise<T> { /* … */ }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 3: CLI binding** — new `apps/cli/src/store.ts`: `sleepSync` and
      `retryOnBusy` verbatim (they import `isSqliteBusy` from
      `@todoer/client-core/node-sqlite`), and `Store.open`'s body as
      `openStore`, comments verbatim:

```ts
export function openStore(path: string): Store {
  const onDisk = path !== ':memory:';
  if (onDisk) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const umask = process.umask(0o077);
  let db: NodeSqlite;
  try {
    db = new NodeSqlite(path);
    retryOnBusy(() => {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec(SCHEMA);
    });
  } finally {
    process.umask(umask);
  }
  if (onDisk) chmodSync(path, 0o600);
  return new Store(db);
}
```

  `index.ts`: `Store.open(config.dbPath)` → `openStore(config.dbPath)`. All
  other CLI importers: `type Row` / `type Store` / `type StoredAuth` from
  `@todoer/client-core`.
- [ ] **Step 4: Test fixture** — `packages/client-core/src/test-store.ts`, not
      built (excluded in `tsconfig.build.json`):

```ts
import { NodeSqlite } from './node-sqlite.js';
import { SCHEMA, Store } from './store.js';

/** The CLI's openStore without its file-system concerns (directory and
 *  file modes, umask, retry on a first open), which apps/cli tests. */
export function openStore(path: string): Store {
  const db = new NodeSqlite(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  return new Store(db);
}
```

- [ ] **Step 5: Split `store.spec.ts`** (29 tests → 22 in client-core, 7 in
      the CLI):
  - client-core keeps the `Store` and `Store auth` blocks, except the three
    file-mode tests (`keeps the database readable only by its owner`,
    `creates a fresh database directory private to its owner`,
    `creates the side files private to their owner in a shared directory`).
    Edits: `Store.open(` → `openStore(` (from `./test-store.js`). One fixture
    accessor in `restores the busy timeout after the lock is taken` changes,
    because the adapter has no `prepare`:
    `(store as unknown as { db: { all<T>(sql: string): T[] } }).db.all<{ timeout: number }>('PRAGMA busy_timeout')[0]`.
    The `node:sqlite` type import goes. The test keeps its three
    `toBe(5000)` assertions.
  - new `apps/cli/src/store.spec.ts`: the three file-mode tests, the
    `retryOnBusy` block (3) and the parallel-first-opens block (1), with
    their `storeAt`/`busyError` helpers. `Store.open(` → `openStore(`
    (`./store.js`); in the worker script,
    `import { Store } from …store.js` / `Store.open(dbPath)` →
    `import { openStore } …` / `openStore(dbPath)`.
  - **Parallel-open build directory** (Review Focus 5): `outDir =
    mkdtempSync(join(cliDir, 'node_modules', '.todoer-build-'))` instead of
    under `tmpdir()`. The emitted `store.js` now imports
    `@todoer/client-core` at runtime, and node resolves a bare specifier
    by walking up from the importing file. Update the block comment's
    sentence on what `store.js` imports.
  - `run.spec`, `sync.spec`, `auth.spec`, `transport.spec` (still in the CLI
    until Task 4): `Store.open(` → `openStore(` from `./store.js`, and
    `type Store` from `@todoer/client-core`.
- [ ] **Step 6: Run** — `pnpm -w exec turbo run build typecheck test lint`:
      client-core 2 files / 26, CLI 15 files / 305 (sum 331); `pnpm lint`.
      Then both e2e scripts (commands under Task 6, Step 5).
- [ ] **Step 7: Mutations** — each turns the named test red, then revert:
  - `Store.transaction`: drop the `inTransaction` guard → `surfaces the
    original error even when the transaction already ended`.
  - `Store.transaction`: drop the `ROLLBACK` → `rolls a transaction back
    when it throws`.
  - `NodeSqlite.withWriteLock`: rethrow SQLITE_BUSY at once instead of
    polling → `makes a second store wait for the lock until the first body
    resolves`.
  - `NodeSqlite.withWriteLock`: drop the `finally` that restores
    `busy_timeout` → `restores the busy timeout after the lock is taken`.
  - `openStore`: drop the `process.umask(0o077)` → `creates the side files
    private to their owner in a shared directory`.
  - `NodeSqlite.all`: return `[]` → most of client-core's `store.spec`.
- [ ] **Step 8: Commit** `refactor(client-core): move Store onto a
      synchronous database adapter` — body: the web runs the same Store over
      sqlite-wasm in a worker (Q3, Q13); the adapter is sized to both
      engines, and the file-system half of opening stays in the CLI.
      Departures 1–3. Tick T002.

---

### Task 3: Move the pure modules

Implements FR-004 (T003).

**Files** (`git mv` each `.ts` and its `.spec.ts`, from `apps/cli/src/` to
`packages/client-core/src/`):

| Module | Tests | Imports to rewrite in the moved file |
| --- | --- | --- |
| `expand.ts` | 23 | none |
| `occurrence.ts` | 16 | `./store.js` (type `Row`) stays relative |
| `labels.ts` | 11 | same |
| `merge.ts` | 20 | same |
| `overlay.ts` | 12 | same |
| `parse-quick-add.ts` | 9 | `./protocol.js` stays relative |
| `ref.ts` | 10 | same |

- Modify: `packages/client-core/src/index.ts` (add the seven `export *`
  lines), `apps/cli/src/run.ts` (imports from `@todoer/client-core`).

**Interfaces** (all unchanged, now public from `@todoer/client-core`):
`expand`; `HORIZON_DAYS`, `localDate`, `recurrenceOf`, `currentOccurrence`,
`isOccurrence`, `latestClosed`, `type Recurrence`, `type StateOf`;
`liveTags`, `liveProjects`, `notDeleted`, `compareIds`, `winner`,
`isAttached`, `resolveLabels`, `labelsOf`, `type Labels`; `planMerge`,
`type Replica`; `overlay`, `liveTasks`, `PENDING_DELETE`; `parseQuickAdd`,
`planAdd`, `TAG`, `PROJECT`, `type QuickAdd`; `shortRef`, `resolveRef`.

- [ ] **Step 1:** move; in the moved files their relative imports already
      point at siblings that now live beside them. The specs need no edit:
      `expand.spec` resolves `@todoer/specs/vectors/rrule.json` through
      client-core's own dependency.
- [ ] **Step 2: Run** — client-core 9 files / 127, CLI 8 files / 204; lint.
- [ ] **Step 3: Mutations** — `overlay`: drop the `DERIVED_ID_TABLES` merge
      branch → `overlay.spec` red. `localDate`: `getFullYear` →
      `getUTCFullYear` (and month, date) → `occurrence.spec`'s
      `is the local date, not UTC, under a real offset` red, which proves
      the runtime TZ flip works in client-core's runner. Then delete the `env`
      line from client-core's `vitest.config.mjs` and run
      `TZ=Pacific/Kiritimati pnpm --filter @todoer/client-core test`. Note
      in the PR whether anything goes red. The config keeps the line either
      way: it is the same runner contract as the CLI's.
- [ ] **Step 4: Commit** `refactor(client-core): move the expander, labels,
      merge, overlay, quick-add and refs` — body: pure functions both clients
      need; they move with their specs, unchanged. Tick T003.

---

### Task 4: Move sync, transport and the token source

Implements FR-004 (T004).

**Files:**

- Move (`git mv`, with specs): `sync.ts` (20), `transport.ts` (10), `auth.ts`
  (14) → `packages/client-core/src/`
- Modify: `packages/client-core/src/index.ts`, `apps/cli/src/index.ts`,
  `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts` (imports)

**Interfaces:**

- Produces: `flush`, `MAX_OPS`, `type Transport`, `type Flushed`;
  `httpTransport(config: HttpConfig, tokens: TokenSource): Transport`;
  `tokenSource(store, api, envToken, now)`, `httpAuthApi(config: HttpConfig)`,
  `type AuthApi`, `type TokenSource`; new
  `type HttpConfig = { base: string; timeoutMs: number }` in `transport.ts`.
  The CLI's `Config` satisfies it structurally, so `index.ts` passes `config`
  unchanged.

- [ ] **Step 1:** move. In `transport.ts` and `auth.ts`,
      `import type { Config } from './config.js'` →
      `HttpConfig` (declared in `transport.ts`, imported by `auth.ts`).
- [ ] **Step 2: Spec fixtures** — `sync.spec`, `auth.spec`, `transport.spec`:
      `openStore` now from `./test-store.js`. In `transport.spec`, the
      three `Config` literals become `HttpConfig` literals and drop
      `token: ''` and `dbPath: ':memory:'`, which an `HttpConfig` literal
      rejects as excess properties. In `auth.spec`, `as Config` →
      `as HttpConfig`. No other edit. `sync.spec` reads
      `../../../packages/specs/openapi/openapi.yaml`, which resolves
      the same from `packages/client-core/src`.
- [ ] **Step 3: Run** — client-core 12 files / 171, CLI 5 files / 160 (sum
      331); lint; Review Focus 1's two `rg` checks.
- [ ] **Step 4: Mutations** — `flush`: drop the follow-up pull after a refused
      last batch (`if (!pulled)` block) → `sync.spec` red. `tokenSource.renew`:
      skip the re-read inside the lock (always refresh) → `auth.spec`'s
      two-store refresh test red. `httpTransport`: return the 401 without
      renewing → `transport.spec` red.
- [ ] **Step 5: Commit** `refactor(client-core): move sync, the HTTP
      transport and the token source` — body: the outbox flush and token
      renewal are the protocol every client speaks; the CLI keeps only its
      config. Tick T004.

---

### Task 5: Extract the domain operations from `run.ts`

Implements FR-005 (T005). Departures 5, 6.

**Files:**

- Create: `packages/client-core/src/operations.ts`
- Modify: `apps/cli/src/run.ts`, `packages/client-core/src/index.ts`

**What moves** (verbatim) from `run.ts` into `operations.ts`: `MARK`,
`type Mark`, `isMark`, `type Due`, `submit`, `flushOwn`, the seven table
readers (`tasks` … `occurrences`), `parentOf`, `stateOf`, `setTask`,
`statusFacts`, `statusOps`, `type Listed`, `due`, `type ChosenView`,
`pickView`, `compareStrings`, `sortFor`, `pickOccurrence`.

**What stays** in `run.ts`: `Deps`, `Outcome`, `UNREACHED`, `takeOption`,
`PlannedRecurrence`, `planRecurrence`, `emptyRuleNotice` (flag validation and
a stderr note), `subject`, `adoptAccount`, `revoke`, `accountOutcome`,
`listOutbox`, and `run` itself: dispatch, every stderr line, `human`, the
envelope.

**Interfaces** (new, `@todoer/client-core`):

```ts
/** What every operation needs; the CLI's Deps is a superset. */
export type Core = {
  store: Store;
  send: Transport;
  now: () => Date;
  newId: () => string;
};

/** A label filter by name key: `list @Work` → { tag: 'work' }. */
export type LabelFilter = { tag: string } | { project: string };

export const MARK: { readonly done: 'done'; readonly skip: 'skipped'; readonly undo: 'open' };
export type Mark = keyof typeof MARK;
export function isMark(command: string | undefined): command is Mark;
export type Due = Row & { ref: string; occurrence: string | null; project: string | null; tags: string[]; status: string | null };

/** Queues ops in one transaction (a builder runs inside it) and flushes;
 *  throws the batch's refusals; true when the server has all of them.
 *  `command` names the caller in the "do not run … again" message. */
export function submit(store: Store, send: Transport, build: Op[] | (() => Op[]), command: string): Promise<boolean>;

/** `add`: quick-add text plus already-validated recurrence fields. */
export function add(core: Core, text: string, recurrence: Record<string, string>):
  Promise<{ synced: boolean; title: string; created: string[]; task: Row | null }>;

/** done / skip / undo on the task `ref` names, at `on` or the default occurrence. */
export function mark(core: Core, command: Mark, ref: string, on: string | undefined):
  Promise<{ synced: boolean; task: Row; occurrence: string | null; closed: 'done' | 'skipped' | undefined; marked: Row | null }>;

/** Each live task once at its current occurrence, label-filtered, then the
 *  named view's filter and sort. Reads only; the caller flushes first. */
export function listTasks(store: Store, today: string, filters: LabelFilter[], view: string | undefined): Due[];

/** Live views by rank, then id. */
export function listViews(store: Store): Row[];

/** After a pull: drop moot failed entries, queue the duplicate-name merge.
 *  Returns the merged names when it queued anything, else []. */
export function reconcile(core: Core): string[];
```

- [ ] **Step 1: Bodies** — each new function is the matching `run.ts` branch
      with argv and output removed, in the same statement order:
  - `add`: `planAdd(text)` → `ts = core.now().toISOString()` →
    `resolveLabels(…, core.newId, ts)` → `op` (`opId`, then `id`) →
    `linkOps` → `submit(store, send, [...labels.creates, op, ...linkOps],
    'add')` → `task = tasks(store).find(…) ?? null`. Returns
    `labels.created` as `created`.
  - `mark`: lines "Resolved against what this client can see" through
    `const marked = …`, including the `already ${closed} — undo it first`
    throw. Returns `closed` (`repeated` is `closed !== undefined` in the
    caller).
  - `listTasks`: `pickView` (when `view` is set), `due`, the label-filter
    `every`, `matches`, `sortFor`, `.map(({ row }) => row)`.
  - `listViews`: the `views` branch's sort.
  - `reconcile`: the whole `if (synced) { … }` body, minus the `stderr.push`.
- [ ] **Step 2: `run.ts`** — the branches become (shape, not new logic):

```ts
  if (command === 'add') {
    const rrule = takeOption(rest, '--rrule');
    const from = takeOption(rrule.rest, '--from');
    const recurrence = planRecurrence(rrule.value, from.value, localDate(deps.now()));
    const ruleNotice = emptyRuleNotice(recurrence);
    if (ruleNotice !== null) stderr.push(ruleNotice);
    const added = await add(deps, from.rest.join(' '), recurrence.fields);
    if (added.created.length > 0) {
      stderr.push(`note: created ${added.created.join(' ')}`);
    }
    synced = added.synced;
    data = added.task;
    human = [added.title];
  } else if (command === 'list') {
    const view = takeOption(rest, '--view');
    const filters: LabelFilter[] = view.rest.map(/* unchanged */);
    ({ synced } = await flush(store, deps.send));
    const rows = listTasks(store, localDate(deps.now()), filters, view.value);
    data = rows;
    human = rows.map(/* unchanged */);
  } else if (command === 'views') {
    ({ synced } = await flush(store, deps.send));
    const rows = listViews(store);
    data = rows;
    human = rows.map(/* unchanged */);
  } else if (isMark(command)) {
    const on = takeOption(rest, '--on');
    const [ref, ...extra] = on.rest;
    if (ref === undefined || extra.length > 0) { /* unchanged throw */ }
    const result = await mark(deps, command, ref, on.value);
    synced = result.synced;
    data = result.marked;
    if (synced && result.marked !== null && result.marked.state !== MARK[command]) {
      stderr.push(/* the I3 note, unchanged */);
    }
    human = [[result.closed !== undefined ? `already ${result.closed}` : command,
      String(result.task.title), ...(result.occurrence === null ? [] : [result.occurrence])].join('  ')];
  }
  …
  if (synced) {
    for (const name of reconcile(deps)) {
      stderr.push(`note: merging duplicate ${name} — sent with the next command`);
    }
  }
```

  The `created` note moves from before `submit` to after it. That changes
  nothing a caller sees: when `submit` throws, `index.ts` prints only the
  error and discards `stderr`; when it returns, the order of the lines is
  the same.
- [ ] **Step 3: Run** — all suites; `run.spec` (130) is the proof for this
      task and changes only in imports. Then both e2e scripts.
- [ ] **Step 4: Mutations** — each turns `run.spec` red, then revert:
  - `add`: mint `op.id` before `op.opId` → the id-pinning add tests.
  - `mark`: read `statusRows(store)` before `submit` instead of inside the
    builder → `reads the statuses inside the write transaction, so a seed
    that landed meanwhile is not repeated`.
  - `submit`: call the builder before `store.transaction` instead of inside
    it → the same race test.
  - `reconcile`: drop the moot-entry loop → the `failed deletes` block.
  - `listTasks`: skip `sortFor` → the `views` sort tests.
- [ ] **Step 5: Commit** `refactor(client-core): extract add, mark, list and
      the post-pull merge from run.ts` — body: the web worker calls the same
      operations the CLI does (Q13); run.ts keeps argv, wording and the
      envelope. Departures 5, 6. Tick T005.

---

### Task 6: Docs and the full proof

Implements FR-006, FR-007 (T006).

**Files:** `README.md`, `.claude/CLAUDE.md`,
`docs/specs/2026-10-01-client-shells-design.md`.

- [ ] **Step 1: README** — Layout table gains
      `packages/client-core/` | "the logic every client shares: replica,
      outbox, sync, overlay, recurrence, labels, merge, views — on a
      synchronous SQLite adapter"; the `apps/cli/` row says it runs on it.
- [ ] **Step 2: CLAUDE.md "The stack"** — "Three packages" → four;
      `@todoer/specs` upstream of all; `@todoer/client-core` upstream of the
      CLI. New row: `packages/client-core` | "Replica, outbox, sync and the
      domain operations both clients run. The portable entry has no Node
      import; `./node-sqlite` is the CLI's adapter." Also the tests
      paragraph: client-core's specs are DB-free of Postgres and run anywhere.
- [ ] **Step 3: Design doc** — the Terms row "client core … Lives in
      `apps/cli` today" → "Lives in `packages/client-core`". The Verified
      facts line about `apps/cli/src` gains "(before W0)". Append
      "## Departures in plan W0" with this plan's six departures, one
      paragraph each.
- [ ] **Step 4: Assertion audit** — every spec edit is one of the allowed
      kinds:

```sh
git diff -M main -- '*.spec.ts' | rg '^[-+][^-+]' \
  | rg -v "^[-+]\s*import |from '|openStore\(|Store\.open\(|HttpConfig|Config"
```

  Whatever this prints must be the named fixture edits: the
  `busy_timeout` accessor, the `token`/`dbPath` lines, and the parallel-open
  `outDir` and worker script. Paste the output into the PR. Also
  `git diff main -- scripts/` → empty.
- [ ] **Step 5: Gates and e2e** —

```sh
docker compose -f docker/compose.yml up -d
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
JWT_SECRET=0123456789abcdef0123456789abcdef \
  pnpm -w exec turbo run build typecheck test && pnpm lint
# a fresh e2e database, as CI does
PGPASSWORD=todoer psql -h localhost -p 5433 -U todoer -d todoer_test -c 'DROP DATABASE IF EXISTS todoer_e2e' -c 'CREATE DATABASE todoer_e2e'
(cd apps/backend && DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_e2e pnpm prisma migrate deploy)
PORT=3010 DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_e2e \
JWT_SECRET=0123456789abcdef0123456789abcdef node apps/backend/dist/main.js > /tmp/backend.log 2>&1 &
TODOER_URL=http://localhost:3010/api/v1 sh scripts/walking-skeleton.sh
TODOER_URL=http://localhost:3010/api/v1 \
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_e2e sh scripts/outbox-e2e.sh
kill %1
```

  Test totals: client-core 12 files / 171, CLI 5 files / 160 = 331.
- [ ] **Step 6: Commit** `docs: describe packages/client-core and record
      plan W0's departures` — body: the stack table and the design's terms
      named apps/cli as the core's home, which stopped being true. Tick T006;
      move the task spec to `done/` per `specs/tasks/README.md`; dnote
      changelog line.

---

## What this plan does not do

- No web adapter, worker or leader logic (W2). The oo1 mapping above is a
  design check, not code.
- No renaming or rewording of errors and notes for a GUI (departure 6).
- No statement cache, and no change to `Store`'s SQL or schema.
- No ADR: Q3 and Q13 already decide the shape; the departures go into the
  design doc.
