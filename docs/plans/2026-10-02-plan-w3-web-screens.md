# Plan W3: the web client's v1 screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a person signs in and works with their tasks in the browser. A
sidebar lists their views in rank order under a built-in "All open" list. A
list view shows the view's tasks with a quick-add box above them and marks
them done, skipped or undone. A kanban view shows the person's statuses as
columns, and a card moves between columns by drag or by keyboard. A drawer
edits a task. A form built from templates creates and edits views. The sync
state shows offline and refused syncs. The same PR ships the production
image: one Docker image with the backend and the built SPA, and a compose
service for a NAS.

**Architecture:** the screens render what the leader's worker computes. Tabs
send commands and receive topics over the W2 protocol, and nothing on the main
thread opens the replica. Client-core gains the operations the CLI has no
equivalent for. Task writes are `editTask` and `moveTask`; the catalog writes
are `saveView`, `deleteView`, `saveStatus`, `setCompleting` and
`deleteStatus`. On the read side it gains `viewTasks`, `boardTasks`,
`taskDetails` and `catalog`, plus a fractional-rank helper. Each has Node tests,
so the CLI can adopt any of them later. `@todoer/specs` gets a SHA-1 that runs
in a browser, because `taskTagId` and `taskOccurrenceId` reach the worker for
the first time. The engine gains write commands, a `watch` command per tab,
and three topics: `catalog`, `view` (keyed by view) and `task` (keyed by
task). Every write command carries an operation id minted in the tab, and the
core records it in the same transaction that queues the operations, so a
resend after a worker crash queues nothing twice.

**Tech Stack:** as W2 (Nuxt 4.5 SPA, Nuxt UI 4.11 default theme,
`@nuxtjs/i18n` 10.6, `@sqlite.org/sqlite-wasm` 3.53.4-build1, Vitest 5,
Playwright 1.63), plus native HTML5 drag and drop, `uuidv7` (already in the
workspace, open question 1), Docker with a multi-stage `node:24-bookworm-slim`
build.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md):
Q8, Q9, Q13, Q16 (W3), Q17, Q18, Q19, Q20, the visual design note, the W1 CSP
notes, "Departures in plan W2" (6, 7 and "For W3") and "Behaviour worth
knowing". [`docs/specs/2026-10-01-views-design.md`](../specs/2026-10-01-views-design.md):
Q1, Q2, Q5, Q7–Q10 and the V1/V2 departures. [ADR 0005](../adr/0005-client-generated-identifiers.md),
[ADR 0006](../adr/0006-three-generic-operations.md),
[ADR 0008](../adr/0008-fractional-index-for-ordering.md). Task spec:
[`specs/tasks/active/T-2026-10-02-web-screens.md`](../../specs/tasks/active/T-2026-10-02-web-screens.md).

## Decisions this plan takes as given

The design, the W2 notes and the controller settled these. They are
constraints here.

1. **v1 scope (Q8, controller):** navigation, a list layout, a kanban layout
   with full column management (Q18), a task drawer, the view template form
   (Q17), visible offline and refused-sync states. The calendar layout and the
   filter-tree editor stay deferred.
2. **The worker computes, the UI renders (Q13).** All reads and writes go
   through the leader's worker. The worker evaluates `matches`,
   `displayStatus` and the sort and pushes results.
3. **The CLI's semantics are the web's.** Quick-add uses the CLI grammar
   (`#project`, `@tag`, `p0`–`p4`) and creates labels the same way
   (`resolveLabels`). Marks use `mark`: `done` moves to the completing status
   and seeds statuses when there are none, `undo` clears `statusId`, `skip`
   leaves it (V1 departures 1–3). A recurring task is listed at its current
   occurrence (V1 departure 5). View sort follows V1 departure 4 (priority 4
   first).
4. **The board rule is `displayStatus` (Q7, V2 departure 3).** Moving a card
   into the completing status is `done`, and moving it out is `undo` (Q5).
5. **Write commands carry their operation ids from the tab** (W2 "Behaviour
   worth knowing"). A command must not nest `withWriteLock`.
6. **Nuxt UI's components and default theme**, no custom design system.
   Every string is in `en.json` and `ru.json`.
7. **The CSP is the backend's** (W1 notes). No inline handlers, no runtime
   scripts, no blob: workers, nothing from another origin. Vue `:style`
   bindings are inline styles, which `style-src 'unsafe-inline'` allows.
8. **No new dependencies** beyond open question 1. Drag and drop uses the
   native HTML5 API.
9. **The four required gate names do not change.** `Web e2e` stays a
   candidate, and this plan adds `Image` as a second candidate.

## Verified facts (2026-10-02, on `f90c81b`)

- **`uuidv5` imports `node:crypto`** (`packages/specs/src/ids.ts`, with a
  `ponytail:` comment saying the web needs another hash). `taskTagId` and
  `taskOccurrenceId` call it, and `add` (with tags) and `mark` call those. W2's
  worker never writes, so the built `worker-*.js` holds no `createHash`: the
  bundler shook it out. The first W3 mark would pull it in, and Vite's browser
  stub for `node:crypto` has no `createHash`. `crypto.subtle.digest` is
  async, and `Store.transaction` is synchronous, so the hash must be
  synchronous JS.
- **No rank helper exists.** `rank` appears only as literals: `add` writes
  `'a0'` for every task, `resolveLabels` writes `'a0'` for projects, and the
  seeded statuses are `'a0'`, `'a1'`, `'a2'`. Manual order is `rank`, then id
  (`sortFor`, `compareIds`). **Every task the CLI or quick-add ever made
  shares `rank: 'a0'`**, so ties are the normal case, not a rare one.
- **`submit` mints every op id inside its transaction** through `Core.newId`
  (`operations.ts`). The number of ops depends on the replica: `add` creates
  labels only for names it cannot find, and `mark` seeds statuses only when
  there are none. Replaying a command against a replica that already holds
  its first run's effects therefore produces a *different* op list. Byte-identical
  resends cannot be had by passing a pool of ids.
- **`outbox.op_id` is `UNIQUE`**, so enqueuing an op id twice throws. `meta`
  is `(key TEXT PRIMARY KEY, value INTEGER)`.
- **The server deduplicates by `(userId, opId)`** and answers a replay of an
  applied op with `duplicate` (`sync.service.ts`, `replay`). `Store.settle`
  removes `duplicate` entries like `applied` ones.
- **`delete` needs `baseVersion`** (`OpDelete`). A row still in the outbox
  has no `version`. `planMerge` takes part only in rows with a `version` for
  the same reason.
- **Writable fields** (`sync.service.ts`): task `title`, `notes`,
  `projectId`, `parentId`, `priority`, `scheduledOn`, `dueOn`, `rrule`,
  `dtstart`, `rank`, `statusId`, origin fields. Status `name`, `rank`,
  `color`, `completing`. View `name`, `layout`, `filter`, `sort`, `rank`.
  `rrule` needs `baseVersion`. This plan does not edit it.
- **Rows carry `fieldTs`** (`READABLE_PROTOCOL_FIELDS`), so a closed
  occurrence's `fieldTs.state` says when it closed. A row made by a pending
  create has none.
- **`listTasks` resolves a view by name** (`pickView`), and `due()` passes
  `occurrenceClosed: false` to `displayStatus` because `currentOccurrence`
  hides a closed one-off task. A list never shows closed tasks. A board needs
  them, or the completing column is always empty.
- **The engine never calls `reconcile`.** The CLI runs the duplicate-name
  merge after its pulls. W2's engine only flushes, so seeded statuses from two
  offline devices would never fold in the web.
- **`flush` takes no write lock.** Parallel flushes are the CLI's normal case
  (parallel processes), and `settle` and `advanceCursor` are idempotent.
  Store transactions are synchronous, so two commands in one worker cannot
  interleave inside one.
- **Nuxt UI 4.11 ships** `DashboardGroup`, `DashboardSidebar`,
  `DashboardPanel`, `DashboardNavbar`, `NavigationMenu`, `Slideover`,
  `Modal`, `Form`, `FormField`, `Input`, `Textarea`, `SelectMenu` (with
  `create-item`), `InputTags`, `RadioGroup`, `DropdownMenu`, `Toast` and
  `Kbd` (checked in `node_modules/@nuxt/ui/dist/runtime/components`).
  Nothing in it does drag and drop.
- **The e2e auth budget is tight** (W2): a run spends 16–17 of 20 logins and
  15 of 20 registrations per IP per 15 minutes. `POST /auth/register` accepts
  `transport: 'cookie'` (W1). A registration made through `page.request` puts
  the cookie into the page's context and costs no login.
- **Deploy facts.** `@todoer/backend` has no `files` field, and `dist/` is
  gitignored, so `pnpm deploy` would leave it out. `@todoer/specs` has
  `files: ["dist", "vectors"]`. `prisma` (the CLI that `migrate deploy`
  needs) is a dev dependency, and `postinstall` runs `prisma generate`.
  `docker/compose.yml` is the dev compose: Postgres only, published on 5433,
  and `.claude/CLAUDE.md` tells developers to `up -d` it.

## Where this plan departs from the design docs and the brief

Task 14 records these in the client-shells design doc ("Departures in plan
W3"), and number 4 also in ADR 0008.

1. **`uuidv5` gets a synchronous SHA-1 in plain TypeScript.** The design
   never said where the hash runs. One implementation serves Node and the
   browser, and the existing vectors prove it unchanged. The alternatives
   were an async `crypto.subtle` (it cannot run inside `Store.transaction`)
   or a SHA-1 library (a new dependency for about 60 lines).
2. **The replay guard is a marker, not byte-identical ops.** The tab mints
   the command's `opId`, and creates also get their entity `id` from the tab.
   `submit` records `op:<opId>` in `meta` inside the transaction that queues
   the command's ops, and a write that finds the marker queues nothing and
   only flushes. Secondary op ids (labels, seeds, moved tasks) are still
   minted in the worker. A resend in the same worker attaches to the run in
   flight (the W2 dispatcher). A resend after a crash finds the marker if the
   first run committed, or runs fresh if it did not. Markers older than 7
   days are pruned on each write. Why this and not resending the ops: see
   Verified facts. A replay against a changed replica would mint different
   ops.
3. **Deleting a status moves its tasks to `statusId: null`**, which means
   the first status, instead of to the first status's id (Q8). It is the same
   reasoning as V1 departure 2: null stays right when the columns are
   reordered, and it releases the status's foreign key so its tombstone can
   be pruned. It is still one batch.
4. **Ranks are a deterministic midpoint, and ties break by id.** ADR 0008
   says two offline insertions "produce two different strings". With a
   deterministic `rankBetween` they produce the same string, and the order
   between them is the id order, which is equally stable. Since every
   existing task has `'a0'`, a move *into* a run of equal ranks also re-ranks
   that run, as one batch of `set`s. This is the rebalancing pass ADR 0008
   foresees, kept as small as the tie run. Task 14 amends the ADR's sentence.
5. **The web seeds statuses after its first sync that reached the server**,
   when the replica has no live status. Q9 says a client that finds none
   creates three. A client that has not pulled cannot know it has found
   none. Two devices first started offline still seed twice, and the merge,
   now run by the engine, folds them.
6. **The board's completing column shows one-off tasks closed in the last 7
   days**, by `fieldTs.state` of the occurrence row (a mark still in the
   outbox counts as now). Q7 says where a closed task goes but not for how
   long. Without a bound the column grows forever. Open question 2.
7. **Dragging in a view not sorted `manual` writes no rank.** Between
   columns it sets the status, and the card lands where the sort puts it.
   Within a column it is not a drop target, and the card menu has no "move
   up/down". Q10 leaves this to the client ("writes nothing, or switches the
   view to manual"). Switching silently would rewrite a view the person
   chose.
8. **"All open" is a built-in view, not a row.** It has the filter
   `{ "and": [] }`, the list layout and manual sort, and the key `all`. It
   cannot be edited or deleted. A synced default view would be seeded by
   every device, the same duplicate problem as Q9.
9. **The template form has fixed filter shapes**, listed in Task 11. A view
   whose filter is not exactly one of them opens in raw-JSON mode. The
   design names the templates, not their trees.
10. **A recurring task's scheduled date is read-only in the drawer.** It is
    the current occurrence (V1 departure 5). Changing it means editing
    `dtstart` or `rrule`, which needs `baseVersion` and belongs with the
    calendar's "move an occurrence" (deferred).
11. **The production image ships in W3** (W2 departure 6 said "before W3
    ships"). It is the last code task and touches no W3 file, so it can move
    to its own PR without edits if the maintainer prefers. `prisma` moves
    from the backend's dev dependencies to its dependencies, so that the
    image can run `migrate deploy`. That is a move, not a new dependency. The
    NAS service sits in `docker/compose.yml` behind the profile `app`, so the
    developer's `up -d` still starts Postgres alone.

## Global Constraints

- **The CLI does not change behaviour.** `add` and `mark` gain an optional
  last argument the CLI never passes. `listTasks` keeps its signature and
  output and is reimplemented over `viewTasks`. `git diff main -- apps/cli
  scripts/` is empty. Both shell e2e scripts pass.
- **The backend changes only in `package.json`** (departure 11: `files`, and
  `prisma` moved). No source file in `apps/backend/src` changes, and the CSP
  is not loosened.
- **Dependencies:** `uuidv7` in `apps/web` only after open question 1, with
  the fallback named in Task 6. Nothing else.
- **Portability:** `@todoer/specs` and client-core's portable entry import no
  `node:*` module. Task 1 adds a test that reads `ids.ts`'s imports.
- **Workspace command:**
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test`,
  then `pnpm lint`. Each task ends with both green. Tasks 7–12 also end with
  `pnpm --filter @todoer/web e2e` green.
- **Every requirement has a test that failed first.** Each task names the
  mutation that turns its tests red. Revert it after checking.
- **Commits:** Conventional Commits with a scope. The body says why. **No
  `Co-Authored-By` trailer.** Run `pnpm format` first. Branch
  `feat/web-screens`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`. Candidates: `Web e2e`, `Image`.

## Review Focus

1. **Resend duplicates.** A worker that dies after committing a write but
   before replying gets the same request again from the tab, and the new
   worker has an empty dispatcher cache. Check that every write command's
   core operation checks `store.seen(opId)` **before** any validation, since
   `undo` after an applied undo would otherwise answer "nothing to undo". Check
   that the marker is written inside the same `store.transaction` as the
   enqueue, not after it. Check that the tab mints the `opId` once per user
   action and that a retry reuses it (`client.ts` resends `pending` as is).
   Also check that `add` uses the tab's task `id`, so the drawer can open the
   new task (Tasks 4, 6).
2. **Stale view results after a merge rewrites filters.** A pull can fold a
   tag into another, and `reconcile` then queues a `set filter` on every view
   that named the loser (V1 departure 6). Check that the engine runs
   `reconcile` after **every** pull (sync and write alike) and publishes
   after it, that view results are recomputed from the overlay, never cached,
   and that a view whose filter fails `filterProblem` publishes
   `problem` with no items rather than "all tasks" (Tasks 5, 6).
3. **A kanban drop into the completing status for a recurring task.**
   `moveTask` must call the same path as `mark done` (current occurrence,
   statusOps, seeding), not write `statusId` alone. Q7's risk: "a GUI that edits
   `statusId` alone must not imply completion". After the drop the next
   occurrence is current, and the card shows in the *first* status (its
   `statusId` is now the completing one, which `displayStatus` ignores for an
   open occurrence). Check that the toast says so ("done for 2026-10-02, next
   2026-10-03"), and that dropping a closed one-off task out of the completing
   column writes `undo` plus exactly one `statusId` set to the target, never
   a clear followed by a set with the same `ts` (Tasks 4, 10).
4. **Rank collisions on concurrent reorders.** Two devices dropping into the
   same gap produce equal ranks. Check that every sort ends in id, that
   `rankWrites` re-ranks a tie run instead of computing
   `rankBetween(x, x)` (which must throw), that the generated keys never end
   in `'0'` (there would be no room below), and that a reorder in a
   non-manual view writes nothing (departure 7) (Tasks 2, 4, 8, 10).
5. **Offline writes.** Every write must show at once and survive a reload
   offline. Check that the engine publishes **after the enqueue and before
   the network answers** (the `send` wrapper in Task 6). Check that a write
   command answers `ok` when its ops are only queued, that the sync badge
   then shows pending, and that a `delete` of a status or view that has no
   `version` yet is refused with a clear reason instead of being sent with a
   guessed `baseVersion` (Tasks 5, 6, 12).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] `specs/tasks/active/T-2026-10-02-web-screens.md` exists (FR-001…FR-022,
      steps T001–T014). Settle open questions 1–3 with the maintainer.
      Tasks 1–5 do not depend on the answers.
- [ ] Commit `docs(plans): plan the web client's v1 screens (W3)` on
      `feat/web-screens`. Body: W3 of the client-shells design. The plan
      fixes the write commands' replay guard, the board rule's write side and
      the rank helper before any screen exists.

---

### Task 1: specs: a `uuidv5` that runs in a browser

Implements FR-001 (T001). Departure 1.

**Files:**

- Modify: `packages/specs/src/ids.ts`, `ids.spec.ts`

**Interfaces:** unchanged. `uuidv5(name, namespace?)`, `taskOccurrenceId`,
`taskTagId` keep their signatures and outputs.

- [ ] **Step 1: Tests (red).** In `ids.spec.ts`:
  - the existing vectors stay as they are. They are the proof;
  - `sha1` (not exported from the package index, so import it from
    `./ids`) matches FIPS 180 vectors: `''`, `'abc'`, the 56-byte
    `'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'` (two blocks),
    and a 1 000 000 × `'a'` input, which proves the length encoding;
  - a name with non-ASCII text (`'задача:2026-10-02'`) gives the same id as
    `node:crypto` does. The test computes the expectation with
    `createHash` itself, since a spec may import `node:*`;
  - `ids.ts` has no `node:` import and no `Buffer` (read the file as text).
- [ ] **Step 2: Code.** Replace the `createHash` and `Buffer` code with a
      local `sha1(bytes: Uint8Array): Uint8Array` (big-endian words, 80
      rounds, 64-bit length padding) and `TextEncoder` for the name. Delete
      the `ponytail:` comment, since its condition has arrived.
- [ ] **Step 3: Mutations.** (a) Write the length in little-endian. The
      two-block and million-`a` vectors go red. (b) Encode the name with
      `charCodeAt & 0xff` instead of UTF-8. The Cyrillic case goes red.
      Revert both.
- [ ] **Step 4: Commit.** `fix(specs): derive ids without node:crypto`. Body:
      the web worker writes task occurrences and tag links from W3 on, and a
      browser has no synchronous SHA-1. One implementation for both, held to
      the same vectors.

**Checkpoint:** `taskTagId` and `taskOccurrenceId` run in the worker.

---

### Task 2: client-core: fractional ranks

Implements FR-002 (T002). Departure 4.

**Files:**

- Create: `packages/client-core/src/rank.ts`, `rank.spec.ts`
- Modify: `packages/client-core/src/index.ts` (export)

**Interfaces:**

```ts
/** A key strictly between `before` and `after` (ADR 0008); null is open.
 *  Digits 0-9a-z, so JS `<` and SQLite's BINARY collation agree. Throws
 *  when before >= after: callers resolve ties first (rankWrites). */
export function rankBetween(before: string | null, after: string | null): string;

/** `n` keys strictly between, ascending, of length O(log n). */
export function ranksBetween(before: string | null, after: string | null, n: number): string[];

export type Ranked = { id: string; rank: string };

/**
 * The rank writes that put `moved` right after `after` (null: first) in
 * `ordered`, a container already sorted by rank then id that does not hold
 * `moved`. One write when the neighbours differ. When they tie, the tied
 * run after the gap is re-ranked with `moved`, so the result is exactly
 * the order asked for (departure 4).
 */
export function rankWrites(ordered: readonly Ranked[], moved: string, after: string | null): Ranked[];
```

```ts
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export function rankBetween(before: string | null, after: string | null): string {
  const lo = before ?? '';
  if (after !== null && lo >= after) {
    throw new Error(`no rank between ${lo} and ${after}`);
  }
  let hi = after;
  let out = '';
  for (let i = 0; ; i += 1) {
    const l = i < lo.length ? DIGITS.indexOf(lo[i]!) : 0;
    const h = hi === null ? DIGITS.length : DIGITS.indexOf(hi[i]!);
    // Room at this digit: the midpoint is > l >= 0, so never a trailing '0'.
    if (h - l > 1) return out + DIGITS[(l + h) >> 1];
    out += DIGITS[l];
    // Below `hi` from here on: the rest only has to exceed `lo`.
    if (h - l === 1) hi = null;
  }
}
```

  `ranksBetween` takes the midpoint, then recurses on each half with
  `floor((n-1)/2)` and the remainder. `rankWrites` finds the gap index `g`.
  When `ordered[g-1].rank < ordered[g].rank` (or either side is open), it
  returns `[{ id: moved, rank: rankBetween(...) }]`. Otherwise it takes the
  run `ordered[g..j)` whose ranks are `<=` the lower neighbour, and assigns
  `ranksBetween(lower, ordered[j]?.rank ?? null, run.length + 1)` to
  `[moved, ...run]`.

- [ ] **Step 1: Tests (red).**
  - `rankBetween(null, null)`, `(null, 'a0')`, `('a0', null)`,
    `('a0', 'a1')` (→ `'a0i'`), `('az', 'b')`, `('a0z', 'a1')`: each
    strictly between, none ends in `'0'`;
  - 2 000 random pairs drawn from earlier outputs (seeded `mulberry32`, no
    dependency): `before < r < after`;
  - 200 inserts at the same gap keep every key under 40 characters;
  - `rankBetween('a0', 'a0')` and `('b', 'a')` throw;
  - `ranksBetween('a0', 'a1', 50)`: 50 ascending keys, all strictly
    inside, longest ≤ 6 characters;
  - `rankWrites`: distinct neighbours → one write; to the top and to the
    bottom → one write; four tasks all `'a0'` (ids `1`…`4`), `moved` after
    `2` → writes for `moved`, `3`, `4`, and sorting the result by rank then
    id gives `1, 2, moved, 3, 4`; `after` not in `ordered` → throws.
- [ ] **Step 2: Code** as above.
- [ ] **Step 3: Mutations.** (a) Drop `if (h - l === 1) hi = null`. The
      random property goes red (results land above `after`). (b) In
      `rankWrites`, write only `moved` on a tie. The four-`'a0'` case goes
      red. (c) Return `(l + h + 1) >> 1`. The "never ends in `'0'`" checks
      stay green but `('a0','a1')` changes, which shows the midpoint is
      pinned. Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): fractional ranks with tie
      repair`. Body: ADR 0008's rank had no helper, and every task made so far
      has rank `a0`. A move into equal ranks must re-rank them, or the drop
      lands somewhere other than where it was dropped.

**Checkpoint:** a manual order can be written as `set rank` ops.

---

### Task 3: client-core: reads by view id, boards and the task card

Implements FR-003, FR-004 (T003). Departure 6.

**Files:**

- Modify: `packages/client-core/src/operations.ts`
- Create: `packages/client-core/src/operations.spec.ts` (the reads; the CLI's
  `run.spec` keeps covering `listTasks` through the CLI)

**Interfaces:**

```ts
/** A view as the reads need it: a stored row or the built-in "All open". */
export type ViewSpec = { filter: unknown; sort: string; layout: string };
export const ALL_OPEN: ViewSpec = { filter: { and: [] }, sort: 'manual', layout: 'list' };

/** A listed task with what a screen shows: its column (`displayStatus`) and
 *  whether its occurrence is closed (only ever true on a board). */
export type Item = Due & { column: string | null; closed: boolean };

/** The open tasks a list view shows, filtered and sorted (the CLI's facts). */
export function viewTasks(store: Store, today: string, view: ViewSpec): Item[];

/** viewTasks plus one-off tasks closed within `closedDays` (departure 6),
 *  each in the completing column. */
export function boardTasks(store: Store, today: string, view: ViewSpec, closedDays = 7): Item[];

/** One task for the drawer: the row, labels, current occurrence, column,
 *  closed state; null when it is deleted or unknown. */
export function taskDetails(store: Store, today: string, id: string): (Item & { notes: string | null; rrule: string | null }) | null;

/** What the sidebar, forms and pickers need: live views by rank (with
 *  `problem` from filterProblem), live statuses by rank then id with
 *  `completing` resolved by completingStatus, live projects and tags by name. */
export function catalog(store: Store): Catalog;
export type Catalog = {
  views: { id: string; name: string; layout: string; sort: string; filter: unknown; rank: string; version: number | null; problem: string | null }[];
  statuses: { id: string; name: string; rank: string; color: string | null; completing: boolean; version: number | null }[];
  projects: { id: string; name: string }[];
  tags: { id: string; name: string }[];
};
```

  `viewTasks` is `due()` → `filterProblem` → `matches` → `sortFor`.
  `listTasks` becomes `viewTasks` over `pickView(...)` (or `ALL_OPEN` with
  no view, sorted as today), and its label filters move in front unchanged.
  An invalid filter throws `RefusalError` as `pickView` does. The engine
  catches it per view (Task 6). `boardTasks` adds, for each live one-off task
  whose `null` occurrence is closed and whose `fieldTs.state` (or "now" when
  absent) falls within `closedDays` of `today`, an item with
  `column = displayStatus(statusId, facts, true)` and `closed = true`. Those
  facts carry that column, so a `{ status }` filter sees it.

- [ ] **Step 1: Tests (red),** over `openStore(':memory:')` from
      `test-store.ts` with rows merged by `mergeChanges`:
  - `viewTasks(ALL_OPEN)` returns open tasks by rank then id, and a done
    one-off task is absent;
  - a `{ tag }` view, a `{ project: null }` view, a `{ due: { to: -1 } }`
    view on a fixed `today`;
  - sort `priority` puts 4 first, and `due` puts nulls last, both ending in
    rank then id;
  - a recurring task is listed once at its current occurrence, and its
    `scheduledOn` fact is that occurrence;
  - `boardTasks`: a one-off done today is in the completing column with
    `closed`; one done 8 days ago is absent; a recurring task done today shows
    open at its next occurrence in the first status (its `statusId` is the
    completing one); a task whose `statusId` names a deleted status shows in
    the first status (Q8);
  - with two completing statuses the lowest id is the column (Q9);
  - `taskDetails` of a deleted id → null;
  - `catalog` marks a view whose filter is `{ "tag": "X" }` with a problem,
    and orders views by rank, then id;
  - `listTasks` with and without `view` returns what it returned before.
    Add one assertion against the existing `run.spec` fixture rows.
- [ ] **Step 2: Code.** Export `Due` and `Listed`'s facts as now. Keep
      `pickView`'s name rule.
- [ ] **Step 3: Mutations.** (a) Pass `false` instead of `true` to
      `displayStatus` for closed one-offs. The completing-column test goes
      red. (b) Drop the `closedDays` bound. The 8-days test goes red.
      (c) Make `catalog` skip `filterProblem`. The problem test goes red.
      Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): view, board and task reads by
      id`. Body: the CLI picks a view by name and lists open tasks only. A
      screen picks by id, and a board needs the closed tasks too (views Q7),
      bounded so the done column does not grow forever.

**Checkpoint:** every read a screen needs is a pure function of the store.

---

### Task 4: client-core: the replay guard and the task writes

Implements FR-005, FR-006, FR-007 (T004). Departures 2, 10.

**Files:**

- Modify: `packages/client-core/src/store.ts` (`seen`, `claim`),
  `operations.ts`, `operations.spec.ts`, `store.spec.ts`

**Interfaces:**

```ts
// store.ts
/** Whether a command with this id already queued its ops (departure 2). */
seen(opId: string): boolean;
/** Records it and prunes markers older than `keepMs`; inside a transaction. */
claim(opId: string, nowMs: number, keepMs?: number): void; // default 7 days

// operations.ts
/** Minted in the tab: the command's first op id (and replay key), and for a
 *  create the new row's id. */
export type Minted = { opId: string; id?: string };

export async function submit(store, send, build, command, key?: string): Promise<boolean>;
// key given: inside the transaction, seen(key) → queue nothing; else claim(key).

export async function add(core, text, recurrence, minted?: Minted): ...;   // task id = minted.id, op id = minted.opId
export async function mark(core, command, ref, on, minted?: Minted): ...;   // occurrence op id = minted.opId

export type TaskChanges = Partial<{
  title: string;            // trimmed, non-empty
  notes: string | null;     // '' → null
  priority: number;         // 0..4
  scheduledOn: string | null; // YYYY-MM-DD; refused on a recurring task
  dueOn: string | null;
  project: string | null;   // a name, resolved like quick-add; null detaches
  tags: string[];           // the whole set, by name; attach new, detach gone
}>;
/** One `set` per changed field (plus label creates and links), one batch. */
export async function editTask(core: Core, minted: Minted, taskId: string, changes: TaskChanges): Promise<{ synced: boolean }>;

/**
 * A card moved (views Q5, Q7): into the completing status is `done` through
 * mark's path (current occurrence, statusOps, seeding); out of it, for a
 * closed task, is `undo` plus one `set statusId` to the target; between other
 * statuses one `set statusId`. `ranks` (from rankWrites) are written too.
 * statusId undefined: a reorder only.
 */
export async function moveTask(core: Core, minted: Minted, taskId: string, move: { statusId?: string | null; ranks?: Ranked[] }): Promise<{ synced: boolean; marked: 'done' | 'undo' | null; occurrence: string | null }>;
```

  Each of `editTask`, `moveTask`, and `add`/`mark` when `minted` is given,
  starts with `if (store.seen(minted.opId)) return replay` (a flush, and the
  same result shape with what can be read back). Only then does it validate.
  The first op built uses `minted.opId`, the rest `core.newId`. `mark`'s
  internals split into a `markOps(...)` builder that `moveTask` reuses, so
  there is one path to `done`.

- [ ] **Step 1: Tests (red),** with a fake `Transport` that records requests
      and can answer `applied`, fail, or hang:
  - `submit` with a key run twice over the same store (the "crash" is a
    second call) queues the ops once, and the second call sends no new op;
  - `seen` is true after the transaction commits and false when the builder
    throws (rolled back);
  - markers older than 7 days are gone after the next `claim`;
  - `add` with `minted` creates the task with `minted.id` and `minted.opId`;
    replayed after its ops were applied and settled (outbox empty), it queues
    nothing and creates no second task or label;
  - `mark undo` replayed after it was applied answers like the first call and
    does not throw "nothing to undo";
  - `editTask` title `'  '` → `UsageError`; priority `5` → `UsageError`;
    `scheduledOn` on a recurring task → `UsageError`; `dueOn: '2026-02-30'`
    → `UsageError`;
  - `editTask` `{ project: 'New' }` creates the project and sets
    `projectId` in one batch; `{ project: null }` sets null;
  - `editTask` `{ tags: ['@a', '@c'] }` on a task with `@a @b`: one
    `create task_tag` for `@c` (derived id) and one `set attached false` for
    `@b`, nothing for `@a`;
  - `moveTask` into the completing status for an open one-off: the
    occurrence op `done` and `set statusId` to completing; for a recurring
    task: `done` at the **current** occurrence, and `boardTasks` then shows
    it open at the next one;
  - `moveTask` of a closed one-off to `Doing`: occurrence `open` and exactly
    one `set statusId = Doing`, with no `null` write;
  - `moveTask` between non-completing statuses: one `set statusId`; with
    `ranks`, the rank writes too; `statusId` naming a deleted status →
    `UsageError`;
  - `moveTask` into the completing status when the user has no statuses at
    all seeds them (the `mark` rule);
  - offline (transport rejects with `TypeError`): every write returns
    `synced: false` with its ops queued.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Move `claim` after the transaction. Inject
      a throw between, and the replay test goes red. (b) Move the `seen`
      check after validation in `mark`. The undo-replay test goes red.
      (c) In `moveTask` out of completing, call `statusOps('undo')` then set
      the target. The "exactly one `set statusId`" test goes red. (d) Write
      `statusId` alone for the completing target. The recurring test goes red.
      Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): task edits, card moves and a
      replay guard`. Body: the web resends a command after a worker crash, and
      the op list a replay would mint depends on what the first run already
      wrote. A marker in the queuing transaction makes the command, not the
      op, the unit of idempotence. Moves into the completing status go through
      `mark`, so a board can never imply completion it did not write (views
      Q5, Q7).

**Checkpoint:** every task write the screens need exists, is replay-safe and
works offline.

---

### Task 5: client-core: views, statuses and their seeds

Implements FR-008, FR-009 (T005). Departures 3, 5.

**Files:** `packages/client-core/src/operations.ts`, `operations.spec.ts`

**Interfaces:**

```ts
export type ViewFields = { name: string; layout: 'list' | 'kanban' | 'calendar'; sort: 'manual' | 'priority' | 'due' | 'scheduled'; filter: unknown };

/** Create (id unknown) or update (one `set` per changed field). Refuses an
 *  empty name, a name another live view has (nameKey), a bad layout or sort,
 *  and a filter with a filterProblem (whose text is the message). A new view
 *  ranks after the last. */
export async function saveView(core: Core, minted: Minted & { id: string }, fields: ViewFields): Promise<{ synced: boolean }>;
/** Refuses a view without a `version` ("not synced yet"). */
export async function deleteView(core: Core, minted: Minted, id: string): Promise<{ synced: boolean }>;

/** Create (id unknown; ranks after `after`, or last) or rename and/or
 *  reorder (`after`: the status it follows; null: first). Names: nameKey-unique. */
export async function saveStatus(core: Core, minted: Minted & { id: string }, change: { name?: string; after?: string | null }): Promise<{ synced: boolean }>;
/** `completing: true` on this one and false on every other that has it. */
export async function setCompleting(core: Core, minted: Minted, id: string): Promise<{ synced: boolean }>;
/** One batch: `set statusId null` for every live task on it, then `delete`.
 *  Refuses the completing status, the last non-completing one, and one
 *  without a `version`. */
export async function deleteStatus(core: Core, minted: Minted, id: string): Promise<{ synced: boolean }>;

/** The Inbox, Doing, Done creates (Q9), shared with statusOps. */
export function seedOps(newId: () => string, ts: string): OpCreate[];
/** Queues seedOps when there is no live status; returns whether it did. */
export function seedStatuses(core: Core): boolean;
```

- [ ] **Step 1: Tests (red):**
  - `saveView` create writes `name`, `layout`, `sort`, `filter`, `rank`
    after the last view; update of only `sort` writes one `set`;
  - `filter: { tag: 'Work' }` → `UsageError` carrying the `filterProblem`
    text; a duplicate name (different case) → `UsageError`;
  - `deleteView` on a pending create → `UsageError` "not synced yet"; on a
    synced one → `delete` with its `version`;
  - `saveStatus` create ranks between neighbours (`rankBetween`); reorder
    with `after: null` puts it first; rename to an existing name →
    `UsageError`;
  - `setCompleting` with two completing statuses (merged seeds) clears both
    others and sets one;
  - `deleteStatus` with three tasks on it: three `set statusId null` and the
    `delete`, in that order, in one transaction (one `submit`); the completing
    status → `UsageError`; the last non-completing → `UsageError`;
  - `seedStatuses` on an empty replica queues three creates, the third
    completing; on a replica with a tombstoned status only, it seeds too; a
    second call queues nothing (the overlay sees the pending creates);
  - every one replays to nothing with the same `opId`.
- [ ] **Step 2: Code.** `statusOps` calls `seedOps`.
- [ ] **Step 3: Mutations.** (a) Drop the `set statusId null` loop. The
      three-task test goes red. (b) In `setCompleting`, set the target only.
      The merged-seeds test goes red. (c) Use `baseVersion: 0` for unsynced
      rows. The "not synced yet" tests go red. Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): view and status management`.
      Body: views and columns are synced rows only GUI clients write (views
      Q12, Q18). Here they are written once for every client, with the
      delete-moves-tasks batch of Q8 and refusals in place of a guessed
      `baseVersion`.

**Checkpoint:** client-core has every operation W3 sends. The CLI is
unchanged (`git diff main -- apps/cli` is empty).

---

### Task 6: The engine: write commands, watches and keyed topics

Implements FR-010, FR-011, FR-012 (T006). Departures 2, 5, 8.

**Files:**

- Modify: `apps/web/app/db/protocol.ts`, `engine.ts`, `engine.spec.ts`,
  `client.ts`, `client.spec.ts`, `worker.ts`, `apps/web/package.json`
  (`uuidv7`, open question 1)
- Create: `apps/web/app/db/mint.ts` (tab side: `opId()` and `id()`; the
  fallback without the dependency is a 15-line UUIDv7 over
  `crypto.getRandomValues`, with a test that the version nibble is 7 and the
  ids sort by time)

**Interfaces:**

```ts
// protocol.ts
export type Write =
  | { kind: 'add'; opId: string; id: string; text: string }
  | { kind: 'mark'; opId: string; taskId: string; mark: Mark }
  | { kind: 'edit'; opId: string; taskId: string; changes: TaskChanges }
  | { kind: 'move'; opId: string; taskId: string; view: string; statusId?: string | null; after?: string | null }
  | { kind: 'saveView'; opId: string; id: string; fields: ViewFields }
  | { kind: 'deleteView'; opId: string; id: string }
  | { kind: 'saveStatus'; opId: string; id: string; name?: string; after?: string | null }
  | { kind: 'setCompleting'; opId: string; id: string }
  | { kind: 'deleteStatus'; opId: string; id: string };

export type Command =
  | /* W2's three */ ...
  | { kind: 'watch'; view: string | null; task: string | null } // what this tab shows; 'all' is All open
  | Write;

// FAILURE_KINDS gains 'invalid': a UsageError (bad input, "undo it first").

export type Topics = {
  /* W2's four, unchanged */
  catalog: Catalog;
  /** Published for every watched key; a tab keeps only its own. */
  view: { key: string; layout: string; sort: string; problem: string | null; items: Item[] };
  task: { id: string; task: ReturnType<typeof taskDetails> };
};
export type Result = { ok: true; note?: { marked: 'done' | 'undo'; occurrence: string | null; next: string | null } } | { ok: false; failure: Failure };
```

  Engine:

  - `watches: Map<tab, { view, task }>`. `watch` replaces the tab's entry
    and publishes that tab's keys at once. The client sends
    `{ view: null, task: null }` on `pagehide`. A dead tab's entry stays
    until the worker restarts; that is the ceiling, one entry per tab, marked
    with a `ponytail:` comment.
  - `publishAll()`: `catalog`, then `view` for each distinct watched view
    key, then `task` for each watched task. `today = localDate(now())`. A
    view whose filter fails gets `problem` and no items. A key naming a
    deleted view gets `problem: 'deleted'`. No caching: every publish
    recomputes.
  - The core's `send` is wrapped: `(body) => { publishAll(); return send(body); }`.
    Every `flush` reads the outbox after the enqueue commits, so screens show
    a write before the network answers, offline included.
  - After every flush that reached the server (inside `once` and after
    each write command): `reconcile(core)`. If that queued ops, `runSync('write')`.
    Then, if the replica has no live status and a sync has reached the server
    at least once since sign-in, `seedStatuses(core)`. Then `publishAll()`.
  - Write commands require `signed-in` (else `signed-out`). They are not
    serialised against each other or against sync (Verified facts: `flush`
    takes no lock). `move` computes `ranks` with `rankWrites` from the view's
    current items in the target column (or the list) when the view sorts
    `manual` and `after` is given. Otherwise it passes no ranks (departure 7).
  - `failure()` maps `UsageError` → `invalid`.
  - `Core.newId` in the worker is `uuidv7`.

  Client:

  - Keyed topics: the tab remembers what it last watched and drops `view` and
    `task` publishes for other keys. `watch` is re-sent on `ready`, together
    with the pending requests.
  - `write(command)` fills `opId` (and `id` for creates) from `mint.ts` once,
    then `request`s. A resend from the `pending` map reuses the same object.

- [ ] **Step 1: Tests (red)** in `engine.spec.ts`, over the in-memory WASM
      store and the fake transport W2 uses:
  - two tabs watch different views. Each `view` publish carries its key, and
    both keys are published after a write;
  - `add` from tab A shows in A's `view` publish **while the transport is
    still pending** (a never-resolving `send`);
  - **crash replay:** engine 1 handles `add` (applied, settled). Engine 2 is
    built over the same store and handles the identical command: one task in
    `viewTasks`, and the transport saw no second create;
  - a pull that delivers two tags named `@Work` (the loser named in a view's
    filter) → the next `view` publish for that view already matches by the
    winner, and the transport receives the `set filter` op;
  - the first reached sync with no statuses queues the seed, and a start that
    never reaches the server does not;
  - `edit` with an empty title → `{ ok: false, failure.kind: 'invalid' }`;
  - a write while signed out → `signed-out`;
  - a view with an invalid filter (merged in from the server, as another
    client could write it) publishes `problem`, not all tasks;
  - `move` in a `priority`-sorted view with `after` writes no rank.
  - `client.spec.ts`: a `view` publish for another key leaves
    `topics.view` unchanged; on `ready` the last `watch` is re-sent before
    the pending writes, with the same `opId`.
- [ ] **Step 2: Code.** Keep the `summary` topic, since the W2 e2e reads
      `task-count`.
- [ ] **Step 3: Mutations.** (a) Remove the `send` wrapper. The
      pending-transport test goes red. (b) Skip `reconcile` in `once`. The
      merge test goes red. (c) Seed on start regardless of reach. The
      offline-start test goes red. (d) In `client.ts`, mint a new `opId` on
      resend. The `ready` test goes red. Revert all.
- [ ] **Step 4: Commit.** `feat(web): write commands, watches and view
      topics in the worker`. Body: Q13, where the worker computes and the UI
      renders. A tab says what it shows, and the worker recomputes exactly
      that after every write, pull and merge. Writes carry their ids from the
      tab, and the core's marker makes a resend after a crash queue nothing.

**Checkpoint:** every screen's data and every write exists behind the
protocol, proven in Vitest without a browser.

---

### Task 7: The shell: navigation, sync state, routes

Implements FR-013, FR-014 (T007).

**Files:**

- Modify: `apps/web/app/app.vue`, `apps/web/app/pages/index.vue`,
  `i18n/locales/en.json`, `ru.json`
- Create: `app/components/AppGate.vue` (the switch now in `index.vue`:
  insecure, failed, loading, sign-in, else the slot),
  `app/components/AppShell.vue` (`UDashboardGroup` +
  `UDashboardSidebar` + `UDashboardPanel`), `app/components/ViewNav.vue`
  (`UNavigationMenu`: "All open", then `catalog.views` by rank, each with a
  layout icon; a view with a `problem` shows a warning icon),
  `app/components/SyncStatus.vue` (what `ReplicaSummary.vue` shows, compact,
  in the sidebar footer, with its test ids unchanged),
  `app/composables/useDb.ts` (`$db` non-null under the gate, plus
  `useTopic`), `app/pages/views/[id].vue` (placeholder until Tasks 8 and 10)
- Delete: `app/components/ReplicaSummary.vue` (moved into `SyncStatus`)

  Sync state, by precedence:

  - `sync.reached === false`: a warning badge "Offline", plus "N waiting"
    when `pending > 0`.
  - `sync.problem !== null`: an error `UAlert` in the panel header with
    "Sync refused" (`errors.syncProblem`) and the problem as its detail line
    (W2 departure 7). Its action is "Sync now".
  - `failed > 0`: an error badge "N refused".

- [ ] **Step 1: Unit test (red).** `locales.spec.ts` already fails on a key
      missing in one locale. Add the keys in `en.json` first and watch it go
      red, then add `ru.json`.
- [ ] **Step 2: Code.** Routes: `/` is "All open" (`watch { view: 'all' }`),
      `/views/:id` a view, and `?task=<id>` opens the drawer (Task 9). The
      page watches on mount and on route change.
- [ ] **Step 3: e2e (red, then green).** In `e2e/screens.spec.ts` (fixture
      in Task 12, Step 1, written now): the sidebar lists "All open" and a
      view the CLI cannot make but the API can. Seed it through
      `page.request` with a `create view` op, in rank order. With the
      backend's `/api/v1/sync` routed to a 503 by `context.route` (Chromium
      only, since Firefox does not route a dedicated worker's fetch),
      "Sync now" shows the sync problem alert.
- [ ] **Step 4: Mutations.** Render `SyncStatus` without the problem
      branch. The e2e goes red. Revert.
- [ ] **Step 5: Commit.** `feat(web): navigation and a visible sync state`.
      Body: views are the navigation (views design, "Why"). W2 published
      `sync.problem` and nothing showed it, so a refused sync looked like
      being offline.

---

### Task 8: The list layout: quick-add, marks, manual order

Implements FR-015 (T008). Departure 7.

**Files:**

- Create: `app/components/TaskList.vue`, `app/components/QuickAdd.vue`,
  `app/components/TaskRow.vue`, `app/composables/useDrag.ts` (the local
  drag helper, shared with Task 10)
- Modify: `app/pages/index.vue`, `app/pages/views/[id].vue` (layout switch),
  locales

  - `QuickAdd`: `UInput` with a placeholder showing the grammar
    (`Buy milk #home @errand p2`). Enter sends `add`. Failure `invalid` keeps
    the text and shows the i18n message with the core's detail.
  - `TaskRow`: a round `UButton` (`aria-label` "Mark done") sends
    `mark done`. A `UDropdownMenu` (`aria-label` "Task actions") has Skip,
    Move up and Move down (manual sort only), and Open. The row shows the title,
    `#project`, tags, a priority badge (`p1`–`p4`; p0 shows nothing), the
    occurrence date for a recurring task, due date and the status badge
    (`column` name). Clicking the title opens the drawer.
  - After `mark` the row leaves the list (the next publish). A toast says
    "Done" or "Skipped" with an "Undo" action that sends `mark undo` with a
    new `opId`. For a recurring task the toast names the occurrence and the
    next one (`Result.note`).
  - `useDrag`: `draggable="true"` on rows, `dragstart` sets
    `application/x-todoer-task` to the id, and `dragover` on the container
    computes the gap from the pointer's Y against each row's midpoint and
    draws an insertion line. `drop` sends `move` with `after`. Under a
    non-manual sort the list is not a drop target. Keyboard: Move up/down
    sends `move` with `after` set to the row two above, or one below.
- [ ] **Step 1: e2e (red).** "list: quick-add, done, undo, reorder":
  - quick-add `Buy milk #home @errand p2` → a row with `#home`, `@errand`,
    `p2`; `cli list --json` shows the same task (cross-client);
  - Mark done → the row is gone, the toast's Undo → the row is back, and
    `cli list` agrees;
  - three tasks, all rank `a0`: drag the third above the first → the order
    holds after a reload; then Move down with the keyboard (focus the menu,
    Enter, arrows) → the order changes and holds;
  - a recurring task (`cli add "Water plants" --rrule FREQ=DAILY --from
    <today>`): Mark done → the toast names today and tomorrow, and the row
    stays with tomorrow's date.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Send `move` without `after` on drop. The
      reorder assertion goes red. (b) Hide the menu's Move items always. The
      keyboard step goes red. Revert both.
- [ ] **Step 4: Commit.** `feat(web): the list layout with quick-add and
      marks`. Body: Q8's list, with the CLI's grammar and marks, so a task
      means the same thing in both clients. Reordering works by drag and by
      keyboard, never drag only.

---

### Task 9: The task drawer

Implements FR-016 (T009). Departure 10.

**Files:**

- Create: `app/components/TaskDrawer.vue`
- Modify: `app/components/AppShell.vue` (mounts it for `?task=`), locales

  `USlideover` bound to `?task=`. It watches `task` and closes when the task
  becomes null (deleted elsewhere), with a toast. The fields are title
  (`UInput`), notes (`UTextarea`), project (`USelectMenu` over
  `catalog.projects` with `create-item`, plus "No project"), tags
  (`USelectMenu multiple` with `create-item`), priority (`URadioGroup`
  p0–p4), scheduled and due (`UInput type="date"`, native, with a clear
  button), and status (`USelectMenu` over `catalog.statuses`; choosing the
  completing one sends `move`, so done goes through the board rule).
  Each field saves on blur or change as one `edit` with one change. Esc and
  the browser back button close the drawer. For a recurring task, scheduled
  is read-only text with the rule shown beside it.

- [ ] **Step 1: e2e (red).** "drawer edits": open from a row, change the
      title, notes, project to a new `#work`, add tag `@calls`, priority p3
      and due tomorrow, then close. `cli list --json` shows each field, and
      `#work` exists once. Reopen after a reload and see the values. Choose
      the completing status → the task leaves the list.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutation.** Save the status through `edit { statusId }`
      (bypassing `move`). The "leaves the list" assertion goes red, because no
      occurrence is closed. Revert.
- [ ] **Step 4: Commit.** `feat(web): a task drawer that edits with set
      operations`. Body: Q8's task card. Every edit is one `set` (ADR 0006),
      and status changes go through the board rule.

---

### Task 10: The kanban layout and column management

Implements FR-017, FR-018 (T010). Departures 3, 4, 7.

**Files:**

- Create: `app/components/KanbanBoard.vue`, `app/components/KanbanCard.vue`,
  `app/components/ColumnsDialog.vue`
- Modify: `app/pages/views/[id].vue`, locales

  - Columns are `catalog.statuses` in order, and the completing one has a
    check icon. Cards come from `view.items` grouped by `column`, in the
    order the view publishes them. With no statuses yet (before the seed),
    the board shows the empty state "Columns appear after the first sync".
  - `KanbanCard` is focusable (`tabindex="0"`); Enter opens the drawer. Its
    menu has "Move to ▸" with one item per column (sends `move` with that
    `statusId` and no `after`), plus Move up and Move down (manual only).
  - Drag uses `useDrag`. A drop into another column sends `move { statusId,
    after }`. When the target is the completing column, the toast is the
    mark toast, with Undo. For a recurring task it also says "next
    <date>" (Review Focus 3).
  - `ColumnsDialog` (`UModal`, from the board header "Columns") lists the
    statuses with rename (inline `UInput`, `saveStatus { name }`), Move up
    and Move down (`saveStatus { after }`), "Make completing"
    (`setCompleting`), Delete (confirm with the count of tasks moving to the
    first column; `deleteStatus`), and "Add column" (`saveStatus` with a new
    id, after the last). The core's refusals show as `invalid` messages.
- [ ] **Step 1: e2e (red).** Over a kanban view made through the form (Task
      11) or, if this task lands first, through `page.request`:
  - drag a card from Inbox to Doing → it stays after a reload, and `cli list`
    shows `Doing`;
  - keyboard: focus a card, open its menu, Move to ▸ Done → `cli list` no
    longer lists it, and the card sits in Done;
  - drag it from Done back to Doing → `cli list` lists it, with status
    `Doing`;
  - a recurring card dropped on Done → the toast says next <date>, and the
    card is in the first column with that date;
  - columns: add "Review", rename it "QA", move it up, make it completing
    (Done loses the icon), make Done completing again, delete QA with one
    task on it → the task is in the first column.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Group cards by the task's own `statusId`
      instead of `column`. The recurring and Done assertions go red.
      (b) Remove "Move to" from the menu. The keyboard step goes red. Revert
      both.
- [ ] **Step 4: Commit.** `feat(web): the kanban layout and column
      management`. Body: Q8 and Q18. Columns are the user's statuses, cards
      sit where `displayStatus` puts them, and every move is also reachable
      from the keyboard.

---

### Task 11: The view template form

Implements FR-019 (T011). Departures 8, 9.

**Files:**

- Create: `app/components/ViewForm.vue`, `app/utils/templates.ts`,
  `app/utils/templates.spec.ts`
- Modify: `ViewNav.vue` ("New view"), `app/pages/views/[id].vue` ("Edit",
  "Delete"), locales

**Interfaces:**

```ts
export type Template =
  | { kind: 'today' } | { kind: 'overdue' } | { kind: 'next7' }
  | { kind: 'project'; id: string | null } | { kind: 'tag'; id: string } | { kind: 'status'; id: string };

/** The tree each template writes (departure 9). */
export function filterOf(t: Template): Filter;
/** The template a stored filter is exactly, or null (→ raw-JSON mode). */
export function templateOf(filter: unknown): Template | null;
```

| Template | Filter |
| --- | --- |
| Today | `{ "or": [ { "scheduled": { "to": 0 } }, { "due": { "to": 0 } } ] }` |
| Overdue | `{ "due": { "to": -1 } }` |
| Next 7 days | `{ "or": [ { "scheduled": { "from": 0, "to": 6 } }, { "due": { "from": 0, "to": 6 } } ] }` |
| Project… | `{ "project": "<id>" }`, or `{ "project": null }` for "No project" |
| Tag… | `{ "tag": "<id>" }` |
| Status… | `{ "status": "<id>" }` |

  `UModal` with `UForm`: name, template (`URadioGroup`, with a picker for
  the three "…" templates), layout (`list`, `kanban`; `calendar` disabled
  with "comes later"), sort, and a "Raw JSON" toggle. In raw mode a
  `UTextarea` takes the filter. On every input it runs `JSON.parse` and then
  `filterProblem`, shows the problem under the field, and disables Save while
  there is one. Save sends `saveView`. Delete (on a view page) confirms and
  sends `deleteView`, then navigates to `/`.

- [ ] **Step 1: Unit tests (red).** `templates.spec.ts`: `filterOf` →
      `filterProblem` is null for each template; `templateOf(filterOf(t))`
      round-trips every template; a reordered `or`, an extra key, and
      `{ and: [] }` → null.
- [ ] **Step 2: e2e (red).** "view form": create "Home" (Project… #home,
      list, sort due) → it is in the sidebar, it lists only #home tasks, and
      `cli views` shows it. Edit it to kanban → the board shows. Raw JSON
      `{"tag":"Work"}` → the problem text appears, and Save is disabled. Delete
      → it is gone from the sidebar and from `cli views`.
- [ ] **Step 3: Code.**
- [ ] **Step 4: Mutations.** (a) `templateOf` ignores extra keys. The unit
      test goes red. (b) Do not disable Save on a problem. The e2e goes red.
      Revert both.
- [ ] **Step 5: Commit.** `feat(web): create and edit views from templates`.
      Body: Q17. The six templates cover v1 without the tree editor, and raw
      JSON is checked by the same `filterProblem` the server runs.

---

### Task 12: Playwright: the screens suite, offline and two tabs

Implements FR-020 (T012).

**Files:**

- Modify: `apps/web/e2e/fixtures.ts`, `apps/web/e2e/screens.spec.ts`
  (gathered from Tasks 7–11), `apps/web/e2e/offline.spec.ts`

- [ ] **Step 1: The budget fixture.** A worker-scoped `screen` fixture
      registers one account per project through `page.request` with
      `transport: 'cookie'` and an invitation from `owner`. It sets
      `localStorage['todoer.session'] = '1'` by `addInitScript`, opens `/`,
      and waits for the shell. That costs one registration and no login per
      project, so a run spends 17 of 20 registrations and the same logins as
      W2. `screens.spec.ts` runs `test.describe.configure({ mode: 'serial' })`
      on that one page. Each scenario uses names with its own prefix.
- [ ] **Step 2: Offline.** Extend `offline.spec.ts`: offline → the Offline
      badge; quick-add a task, mark another done, and drag a card on a
      kanban view, each visible at once; reload while offline (served by the
      SW) → all three still visible, with "3 waiting". Back online → pending 0,
      and `cli list` agrees. The Firefox skip from W2 stays for the
      online-event step only.
- [ ] **Step 3: Two tabs.** A second page in the same context: a mark in
      one shows in the other without a reload. Each tab watches a different
      view, and neither shows the other's items.
- [ ] **Step 4: Mutation.** In `client.ts`, keep every `view` publish
      regardless of key. The two-tab step goes red. Revert.
- [ ] **Step 5: Run.** Full suite, both projects, locally against a scratch
      `todoer_e2e`, then in CI. Write the job's wall time and the auth budget
      spent (from the backend log) into the PR.
- [ ] **Step 6: Commit.** `test(web): end-to-end scenarios for every v1
      screen`. Body: Q20 names quick-add, a list through a view, kanban,
      offline and two tabs. One registration per project keeps the run inside
      the per-IP limits with room for one retry.

**Checkpoint:** each screen is proven in Chromium and Firefox under the
backend's CSP.

---

### Task 13: The production image and the NAS compose service

Implements FR-021 (T013). Departure 11.

**Files:**

- Create: `Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`
- Modify: `docker/compose.yml` (service `app`, profile `app`),
  `apps/backend/package.json` (`files: ["dist", "prisma"]`; `prisma` to
  `dependencies`), `.github/workflows/test.yml` (job `Image`), `pnpm-lock.yaml`

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -w exec turbo run build --filter=@todoer/backend... --filter=@todoer/web...
RUN pnpm --filter @todoer/backend deploy --prod /out

FROM node:24-bookworm-slim
# Prisma's query engine links against OpenSSL 3.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /src/apps/web/.output/public ./web
COPY docker/entrypoint.sh /entrypoint.sh
ENV NODE_ENV=production WEB_ROOT=/app/web PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/entrypoint.sh"]
```

  `entrypoint.sh` is POSIX `sh` (trap 4): `set -eu`, `prisma migrate deploy`,
  then `exec node dist/main.js`. `APP_VERSION` is a build arg passed into
  `ENV`. Compose `app`: `build: ..`, `profiles: [app]`, `depends_on:
  postgres: condition: service_healthy`, `DATABASE_URL` pointing at
  `postgres:5432`, `JWT_SECRET` and `TRUST_PROXY` from `.env` (required:
  `${JWT_SECRET:?set JWT_SECRET}`), `ports: ["3000:3000"]`,
  `restart: unless-stopped`.

- [ ] **Step 1: Red.** Job `Image`: `docker compose -f docker/compose.yml
      --profile app up -d --build --wait`, then `sh scripts/walking-skeleton.sh`
      against `http://localhost:3000/api/v1`, then
      `curl -fsS -H 'Accept: text/html' http://localhost:3000/` containing
      `<div id="__nuxt">`, then a header check that the response carries the
      CSP. It fails before the Dockerfile exists.
- [ ] **Step 2: Code.** Check inside the image:
      `node -e "import('@todoer/specs')"` resolves, `dist/main.js` and
      `prisma/schema.prisma` exist, and `node_modules/.prisma/client` is
      generated. If `pnpm deploy` skipped `postinstall`, add `RUN npx prisma
      generate` in `/out` in the build stage and say so in the PR.
- [ ] **Step 3: Mutations.** (a) Drop `prisma` from the `files` field. The
      container exits on `migrate deploy`, and the job goes red. (b) Unset
      `WEB_ROOT`. The `__nuxt` check goes red. Revert both.
- [ ] **Step 4: Commit.** `build: one image with the backend and the SPA`.
      Body: Q9, one image per instance, with web and API always the same
      version. The NAS runs Postgres plus this image from the repository's
      compose file. The `app` profile keeps the developer's `up -d` unchanged.

---

### Task 14: Docs, departures and the full proof

Implements FR-022 (T014).

**Files:** `README.md`, `docs/specs/2026-10-01-client-shells-design.md`,
`docs/adr/0008-fractional-index-for-ordering.md`, `.claude/CLAUDE.md`,
`specs/tasks/active/T-2026-10-02-web-screens.md`

- [ ] **Step 1: README.** "What works today": the web client's screens
      (views, list, kanban with columns, task drawer, view templates,
      offline). Drop "the feature screens come in W3". Add a "Running on a NAS"
      section with the compose profile, `.env` (`JWT_SECRET`, `TRUST_PROXY`),
      the first-run owner registration, updating (`git pull`, `up -d
      --build`), and the HTTPS note pointing at "Serving the web client".
      "Environment": `WEB_ROOT` is set by the image. Browser notes: drag and
      drop needs a pointer; on touch, use the card's "Move to" menu.
- [ ] **Step 2: Design doc.** Append "## Departures in plan W3", one
      paragraph per departure 1–11. Under "Departures in plan W2", replace
      the "For W3: `sync.problem`…" line with a pointer to W3, and departure
      6 gains "Shipped in W3 (departure 11)".
- [ ] **Step 3: ADR 0008.** Amend "Two offline insertions at the same
      position produce two different strings rather than a collision" to: they
      may produce the same string, and the tie breaks by id, which is equally
      stable; a move into a tie re-ranks the tied run (plan W3, departure 4).
      Add an "Amended" line with the date, as ADR 0011 did.
- [ ] **Step 4: `.claude/CLAUDE.md`.** "Running it": the compose profile for
      the image. Quality gates: `Image` as a candidate next to `Web e2e`.
- [ ] **Step 5: Stale-claim sweep.**

```sh
rg -n "No feature screens|feature screens come|placeholder|No production|no Dockerfile|Postgres only|For W3" \
  README.md docs/specs docs/adr .claude
```

  Every hit is updated or is a historical record (plans, earlier departures).

- [ ] **Step 6: Full proof.** The workspace command, `pnpm lint`, both shell
      e2e scripts, the Playwright suite, and the `Image` job locally. `git diff
      main -- apps/cli scripts/ apps/backend/src` is empty.
- [ ] **Step 7: Commit.** `docs: the web screens, the NAS image and plan W3's
      departures`. Tick T014, move the task spec to `done/`, add the dnote
      changelog line. Add tuxedo items for the deferred work below that has
      no item yet.

---

## What this plan does not do

- **No calendar layout and no filter-tree editor** (Q8). `calendar` is
  disabled in the form.
- **No task delete, subtasks or recurrence editing in the UI.** The CLI has
  none either. Delete has the #391 rule to honour, and recurrence edits need
  `baseVersion`.
- **No view reordering in the sidebar.** A new view ranks last. `saveView`
  can write `rank` once a UI needs it.
- **No list of failed outbox entries.** The count shows. Dropping entries
  stays the CLI's `todoer outbox drop`.
- **No touch drag and drop.** The native API needs a pointer, and the card
  menu is the touch path.
- **No image registry.** The NAS builds from the repository (open question 3).
- **No caching of view results.** Every publish recomputes. Fine for
  hundreds of tasks. Memoise per key on the store's change counter if field
  use shows lag.

## Open questions

1. **`uuidv7` in `apps/web`.** The tab mints UUIDv7 ids (ADR 0005). The
   workspace already has `uuidv7@^1.2.1` (backend, CLI), and adding it to
   `apps/web` puts nothing new in the lockfile. Fallback: a 15-line local
   generator in `mint.ts` with its own test. Default: the dependency.
2. **How long a closed one-off task stays in the completing column**
   (departure 6). Default 7 days by the occurrence's `fieldTs.state`.
   Alternatives: forever (the column grows), or "until the next day".
3. **Publish the image to a registry (GHCR) from CI?** Default: no. The NAS
   runs `up -d --build` from a checkout, and a release workflow comes later.
