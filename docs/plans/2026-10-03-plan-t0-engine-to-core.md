# Plan T0: move the sync engine into the client core

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `createEngine`, `dispatcher` and the types they speak live in
`@todoer/client-core`; the web imports them from there and behaves exactly as
before.

**Architecture:** A move, not a rewrite. `apps/web/app/db/engine.ts` and its
spec move with `git mv` into `packages/client-core/src/`. The engine's types
leave `apps/web/app/db/protocol.ts` for a new `engine-protocol.ts` in the core.
The web's `protocol.ts` keeps only what names its browser transport. The
engine's `auth` and `tokens` dependencies are narrowed with `Pick` to what it
calls, so a non-cookie session (the TUI's) can satisfy them.

**Tech Stack:** TypeScript 5.6, Vitest 5, pnpm workspace under turbo,
`@sqlite.org/sqlite-wasm` (already a core devDependency).

**Spec:** `docs/specs/2026-10-03-tui-client-design.md`, decision Q4.

## Global Constraints

- The web's behaviour does not change. Every existing test passes with no
  change except its import lines and the module it mocks.
- `@todoer/client-core`'s portable entry imports nothing from Node or the DOM
  (`DOMException`, `TypeError`, `setTimeout`, `console` are globals in both).
- Inside the core, import from the defining module (`./operations.js`), never
  from `./index.js`: `index.ts` re-exports the engine, so that would be a
  cycle.
- No new dependency.
- Code, comments and commit messages in English. Commit subjects follow the
  repository's conventional style (`refactor: …`, `docs: …`).
- Work happens in this plan's own worktree on branch `refactor/engine-to-core`;
  never on `main`.

---

## File map

| File | Change |
| --- | --- |
| `packages/client-core/src/engine.ts` | `git mv` from `apps/web/app/db/engine.ts`; imports rewritten; `EngineAuth`, `EngineTokens` added |
| `packages/client-core/src/engine.spec.ts` | `git mv` from `apps/web/app/db/engine.spec.ts`; imports and the mocked module rewritten |
| `packages/client-core/src/engine-protocol.ts` | new: the engine's types, cut from the web's `protocol.ts` |
| `packages/client-core/src/index.ts` | export both new modules |
| `apps/web/app/db/protocol.ts` | keeps `CHANNEL`, `LEADER_LOCK`, `Init`, `Fatal` only |
| `apps/web/app/db/worker.ts`, `client.ts`, `client.spec.ts`, `leader.ts`, `leader.spec.ts`, `cadence.ts`, `cadence.spec.ts` | imports |
| `apps/web/app/components/{QuickAdd,RegisterForm,SignInForm,SubtaskList,TaskDrawer}.vue` | imports |
| `apps/web/app/composables/{useDb,useFail,useMarked}.ts`, `apps/web/app/utils/calendar.ts`, `apps/web/i18n/locales.spec.ts` | imports |
| `docs/adr/0018-the-engine-lives-in-the-client-core.md` | new |
| `docs/specs/2026-10-03-tui-client-design.md` | Q4: the dispatcher moves too |
| `.claude/CLAUDE.md` | stack table: client-core holds the engine |
| `specs/tasks/active/T-2026-10-03-engine-to-core.md` | new task spec |

---

### Task 1: Move the engine and its types

**Files:** every file in the map above except the three documents.

**Interfaces:**

- Consumes: nothing from other plans.
- Produces, exported from `@todoer/client-core`:
  - `createEngine(deps: EngineDeps): Engine`, unchanged in behaviour.
  - `type EngineDeps = { store: Store; auth: EngineAuth; tokens: EngineTokens; send: Transport; now: () => Date; newId: () => string; publish: <T extends Topic>(topic: T, value: Topics[T]) => void }`
  - `type EngineAuth = Pick<CookieAuthApi, 'login' | 'register' | 'logout'>`
  - `type EngineTokens = Pick<CookieTokenSource, 'current' | 'renew' | 'adopt' | 'signedIn'>`
  - `dispatcher(build, engine, reply, keepMs?)`, unchanged.
  - Types `Command`, `Write`, `Result`, `Failure`, `Note`, `SyncReason`,
    `Topics`, `Topic`, `ToWorker`, `FromWorker`; constants `ALL`,
    `FAILURE_KINDS`. Shapes exactly as in today's
    `apps/web/app/db/protocol.ts`.

- [ ] **Step 1: Write the task spec**

Create `specs/tasks/active/T-2026-10-03-engine-to-core.md` from
`specs/tasks/templates/feature.md`:

```md
## T-2026-10-03-engine-to-core — Move the sync engine into the client core

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q4)
- Plan: docs/plans/2026-10-03-plan-t0-engine-to-core.md

### Goal

The web's sync engine is the loop every long-lived client needs. The TUI is
the second such client, so the engine moves into `@todoer/client-core`
before the TUI is written, instead of being copied.

### Scenarios

1. **Given** the web client on this branch, **When** a person signs in, adds,
   marks and drags tasks, **Then** everything behaves as on `main`.
2. **Given** a package other than the web, **When** it imports
   `createEngine` from `@todoer/client-core`, **Then** it can run the engine
   with a session that has no cookie.

### Requirements

- **FR-001** The client core MUST export `createEngine`, `dispatcher` and the
  engine's types (← design Q4)
- **FR-002** The engine's `auth` and `tokens` MUST be typed by what it calls,
  not by the cookie implementations (← design Q4)
- **FR-003** The web MUST keep its behaviour: its tests pass with only import
  changes (← design Q4, Cost)

### Edge cases

- A web file still importing an engine type from `~/db/protocol` → the web
  typecheck fails (FR-003, T001)

### Definition of Done

- **SC-001** `engine.spec.ts` runs green in `packages/client-core`
- **SC-002** the web's unit tests and the Playwright suite pass
- [ ] every FR has a test that failed before the code made it pass (a move:
      the moved spec is that test; it fails while imports are broken)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] [FR-003] move engine, spec and types — plan Task 1
- [ ] T002 [FR-002] narrow `auth` and `tokens` — plan Task 1
- [ ] T003 documents: ADR 0018, design Q4, CLAUDE.md — plan Task 2
- [ ] T004 full gates and Playwright — plan Task 3
- **Checkpoint:** the web runs on the engine from the core

### Open questions

None.
```

- [ ] **Step 2: Move the two files**

```bash
git mv apps/web/app/db/engine.ts packages/client-core/src/engine.ts
git mv apps/web/app/db/engine.spec.ts packages/client-core/src/engine.spec.ts
```

- [ ] **Step 3: Run the moved spec to see it fail**

Run: `pnpm --filter @todoer/client-core exec vitest run src/engine.spec.ts`
Expected: FAIL, `Cannot find module './protocol'` (or similar unresolved
import).

- [ ] **Step 4: Create `engine-protocol.ts`**

Create `packages/client-core/src/engine-protocol.ts`. Move into it, verbatim,
everything in `apps/web/app/db/protocol.ts` **except** `CHANNEL`,
`LEADER_LOCK`, `Init` and `Fatal`: `SyncReason`, `Write`, `ALL`, `Command`,
`FAILURE_KINDS`, `Failure`, `Note`, `Result`, `Topics`, `Topic`, the private
`Stamped`, `ToWorker`, `FromWorker`. Replace its import block with
module-local imports:

```ts
import type {
  Catalog,
  Item,
  Mark,
  Placement,
  Rule,
  Span,
  TaskChanges,
  taskDetails,
  ViewFields,
} from './operations.js';
```

Reword one comment, because the core has no i18n:

```ts
/** One kind per failure a screen tells apart; the web keeps one i18n key per
 *  kind (`errors.<kind>`), checked by its locales.spec.ts. */
export const FAILURE_KINDS = [
```

- [ ] **Step 5: Trim the web's `protocol.ts`**

`apps/web/app/db/protocol.ts` becomes exactly:

```ts
/** The browser transport's names. The messages themselves are the core's
 *  `ToWorker` and `FromWorker`. */
export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';

/** Leader tab → its dedicated worker, over postMessage, once. */
export type Init = { type: 'init'; build: string; hint: boolean };
/** Worker → leader tab, over postMessage: init failed. */
export type Fatal = { type: 'fatal'; reason: string };
```

- [ ] **Step 6: Rewrite the engine's imports and narrow its deps**

In `packages/client-core/src/engine.ts`, replace the two import blocks
(`from '@todoer/client-core'` and `from './protocol'`) with:

```ts
import {
  adoptAccount,
  type CookieAuthApi,
  type CookieTokenSource,
} from './auth.js';
import {
  ALL,
  type Command,
  type Failure,
  type Note,
  type Result,
  type SyncReason,
  type ToWorker,
  type Topic,
  type Topics,
  type Write,
} from './engine-protocol.js';
import { localDate } from './occurrence.js';
import {
  add,
  ALL_OPEN,
  boardTasks,
  calendarTasks,
  catalog,
  deleteStatus,
  deleteTask,
  deleteView,
  editTask,
  mark,
  moveOccurrence,
  moveTask,
  reconcile,
  saveStatus,
  saveView,
  seedStatuses,
  setCompleting,
  setRecurrence,
  taskDetails,
  undoMove,
  viewTasks,
  type Catalog,
  type Core,
  type Span,
  type ViewSpec,
} from './operations.js';
import { liveTasks, overlay } from './overlay.js';
import { ConflictError, RefusalError, UsageError } from './protocol.js';
import { rankWrites, type Ranked } from './rank.js';
import type { AccessGrant, Store } from './store.js';
import { flush, type Transport } from './sync.js';
```

Then replace `EngineDeps`:

```ts
/** What the engine calls on the session API: login, register, logout. The
 *  web passes its cookie API; another client adapts its own. */
export type EngineAuth = Pick<CookieAuthApi, 'login' | 'register' | 'logout'>;
/** What the engine calls on the token holder. */
export type EngineTokens = Pick<
  CookieTokenSource,
  'current' | 'renew' | 'adopt' | 'signedIn'
>;

export type EngineDeps = {
  store: Store;
  auth: EngineAuth;
  tokens: EngineTokens;
  send: Transport;
  now: () => Date;
  newId: () => string;
  publish: <T extends Topic>(topic: T, value: Topics[T]) => void;
};
```

Before saving, confirm the engine calls nothing else on them:

Run: `ugrep -n -o 'auth\.[a-zA-Z]+|tokens\.[a-zA-Z]+' packages/client-core/src/engine.ts | sort -u -t: -k3`
Expected: only `auth.login`, `auth.register`, `auth.logout`,
`tokens.current`, `tokens.renew`, `tokens.adopt`, `tokens.signedIn`. If
anything else appears, add it to the matching `Pick`.

- [ ] **Step 7: Export from the index**

Append to `packages/client-core/src/index.ts`, after
`export * from './rank.js';`:

```ts
export * from './engine-protocol.js';
export * from './engine.js';
```

- [ ] **Step 8: Rewrite the spec's imports and its mock**

In `packages/client-core/src/engine.spec.ts`:

1. Replace `from '@todoer/client-core'` with imports from the defining
   modules: `cookieTokenSource`, `type CookieAuthApi`,
   `type CookieTokenSource` from `./auth.js`; `httpTransport` from
   `./transport.js`; `localDate` from `./occurrence.js`; `RefusalError` from
   `./protocol.js`; `ALL_OPEN`, `viewTasks`, `taskDetails` from
   `./operations.js`; `type AccessGrant`, `type Store` from `./store.js`;
   `type Transport` from `./sync.js`.
2. Replace `from '@todoer/client-core/sqlite-wasm'` with `from './sqlite-wasm.js'`.
3. Replace `from './engine'` with `from './engine.js'` and
   `from './protocol'` with `from './engine-protocol.js'`.
4. The mock must target the module the engine imports `taskDetails` from:

```ts
// A spy that calls through, so one test can make a computation throw.
vi.mock('./operations.js', async (original) => {
  const actual = await original<typeof import('./operations.js')>();
  return { ...actual, taskDetails: vi.fn(actual.taskDetails) };
});
```

Leave every `describe` and `it` untouched.

- [ ] **Step 9: Run the moved spec**

Run: `pnpm --filter @todoer/client-core exec vitest run src/engine.spec.ts`
Expected: PASS, the same test count as on `main`
(`pnpm --filter @todoer/web exec vitest run app/db/engine.spec.ts` there).

- [ ] **Step 10: Point the web at the core**

Every engine type and the two functions now come from `@todoer/client-core`;
only `CHANNEL`, `LEADER_LOCK`, `Init`, `Fatal` stay on `~/db/protocol`
(or `./protocol` inside `app/db`). The importers:

| File | Now imports from `@todoer/client-core` |
| --- | --- |
| `app/components/QuickAdd.vue`, `SubtaskList.vue`, `app/utils/calendar.ts` | `type Write` |
| `app/components/RegisterForm.vue`, `SignInForm.vue` | `type Failure` |
| `app/components/TaskDrawer.vue` | `ALL` |
| `app/composables/useDb.ts` | `type Topic`, `type Topics` |
| `app/composables/useFail.ts` | `type Result` |
| `app/composables/useMarked.ts` | `type Note` |
| `app/db/cadence.ts`, `cadence.spec.ts` | `type SyncReason` |
| `app/db/client.ts` | every name it imports except `CHANNEL` |
| `app/db/client.spec.ts` | `type FromWorker`, `type ToWorker` (keeps `CHANNEL` local) |
| `app/db/leader.ts` | every name except `CHANNEL`, `LEADER_LOCK`, `Init`, `Fatal` |
| `app/db/leader.spec.ts` | `type Topics` (keeps `LEADER_LOCK` local) |
| `app/db/worker.ts` | `createEngine`, `dispatcher`, `type FromWorker`, `type ToWorker` (keeps `CHANNEL`, `Fatal`, `Init` local) |
| `i18n/locales.spec.ts` | `FAILURE_KINDS` |

Where a file already imports from `@todoer/client-core`, merge into that
import rather than adding a second one.

- [ ] **Step 11: Typecheck and test everything**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/client-core... --filter=@todoer/web...`
Expected: all tasks succeed. `Cannot find name` or `has no exported member`
in the web means a missed importer from Step 10.

Then: `pnpm lint`
Expected: clean. The core's ESLint config may be stricter than the web's; fix
what it reports in the moved files without changing behaviour.

- [ ] **Step 12: Commit**

```bash
git add -A packages/client-core apps/web specs/tasks/active
git commit -m "refactor: move the sync engine into the client core"
```

Body: why (a second long-lived client is coming; one engine, not two).

---

### Task 2: Documents

**Files:**

- Create: `docs/adr/0018-the-engine-lives-in-the-client-core.md`
- Modify: `docs/specs/2026-10-03-tui-client-design.md` (Q4)
- Modify: `.claude/CLAUDE.md` (stack table, `packages/client-core` row)

- [ ] **Step 1: Find every document naming the old path**

Run: `ugrep -rn 'db/engine|db/protocol' docs .claude README.md apps/web/README.md 2>/dev/null`
Expected: hits in the design docs. Plans and `done/` task specs are records
of what happened and are not rewritten; any other hit that describes the
current layout is updated to the new one.

- [ ] **Step 2: Write ADR 0018**

```md
# 18. The engine lives in the client core

- **Status:** accepted
- **Date:** 2026-10-03

## Context

The web client grew a long-lived loop around the client core in W1–W5:
single-flight sync, every write kind, and the topics a screen subscribes to.
It lived in `apps/web/app/db/engine.ts`. The terminal client
(`docs/specs/2026-10-03-tui-client-design.md`) needs the same loop; the CLI
does not, because each invocation is one command.

## Decision

`createEngine`, `dispatcher` and their types live in `@todoer/client-core`
(`engine.ts`, `engine-protocol.ts`). The engine depends on two narrow
session types, `EngineAuth` and `EngineTokens`, which the web's cookie
session and the TUI's stored session both satisfy. The web keeps only the
names of its browser transport: the channel, the leader lock, and the
worker's init and fatal messages.

The TUI is the fourth client: the CLI, the web, the TUI and, later, Flutter.

## Consequences

One place decides when to sync and how a write's result reaches a screen.
A change to the engine is a core change: it reaches both clients and is
tested once, in the core.

The dispatcher moved too, though only the web uses it: it has no browser
dependency, and moving it kept the engine's spec whole.
```

- [ ] **Step 3: Correct the design doc**

In `docs/specs/2026-10-03-tui-client-design.md`, Q4 **Decision**, replace
"The web keeps only its transport: `dispatcher`, `CHANNEL`, `LEADER_LOCK`,
`ToWorker`, `FromWorker`, `Init`, `Fatal`." with:

```md
The dispatcher and the worker's message types (`ToWorker`, `FromWorker`)
move too: they have no browser dependency, and the engine's spec tests the
dispatcher. The web keeps only the names of its browser transport:
`CHANNEL`, `LEADER_LOCK`, `Init`, `Fatal`.
```

- [ ] **Step 4: Update the stack table**

In `.claude/CLAUDE.md`, the `packages/client-core` row starts "Replica,
outbox, sync and the domain operations both clients run." Change it to
"Replica, outbox, sync, the domain operations and the long-lived engine
(`createEngine`) the clients run." Keep the rest of the row.

- [ ] **Step 5: Format and commit**

Run: `pnpm exec prettier --check docs .claude specs`
Expected: clean (run `--write` on any file it names, then re-check).

```bash
git add docs .claude
git commit -m "docs: record that the engine lives in the client core"
```

---

### Task 3: Full gates and the pull request

- [ ] **Step 1: Database for the backend tests**

Run: `docker compose -f docker/compose.yml up -d`
The backend's specs need a database ending in `_test`; `apps/backend/vitest.setup.ts`
prints the two commands to create it if it is missing.

- [ ] **Step 2: Workspace tests**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm -w exec turbo run build typecheck test`
Expected: every task succeeds.

- [ ] **Step 3: Playwright**

Run (once per machine: `pnpm --filter @todoer/web exec playwright install chromium firefox`):
`DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_e2e JWT_SECRET=$(printf 'x%.0s' {1..40}) pnpm --filter @todoer/web e2e`
Expected: pass. The Firefox guard-teardown flake (tuxedo 419) may need its CI
retry; any other failure is this change's.

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 5: Close the task spec**

Tick every step and DoD item in
`specs/tasks/active/T-2026-10-03-engine-to-core.md`, set `Status: done`, add
`- Completed: <date>` and `- Result: <PR link>` once the PR exists, `git add`
it, then `git mv` it to `specs/tasks/done/`.

- [ ] **Step 6: Changelog**

Run: `dnote add todoer -c "2026-10-03 · The sync engine moved from the web into @todoer/client-core, so the TUI runs the same engine as the web."`
(Append to the existing changelog note if the book keeps one; see the `dnote`
skill.)

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin refactor/engine-to-core
gh pr create --title "refactor: move the sync engine into the client core" --body "…"
```

The body says why, names the design doc and ADR 0018, and states that the web
changed only imports.
