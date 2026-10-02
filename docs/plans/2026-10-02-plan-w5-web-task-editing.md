# Plan W5: task delete, subtasks and recurrence editing in the web client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the task drawer can delete a task, after a dialog that says how
many live subtasks go with it. It lists a task's subtasks, adds new ones,
ticks them and opens them, and a subtask shows as an ordinary row, card or
chip with a link to its parent. A "Repeat…" dialog makes a task recurring
through four presets (Daily, Weekly on chosen weekdays, Monthly, Yearly, each
with an interval) and a start date, or through a raw RRULE field for the rest
of the supported subset. It previews the next dates, changes a rule, and makes
a recurring task one-off again. This closes tuxedo #414.

**Architecture:** as in W3 and W4, the worker computes and the tab renders.
Client-core gains three writes, `deleteTask`, `setRecurrence` and a `parentId`
on `add`, and two pure rule helpers, `ruleProblem` and `upcoming`, each with
Node tests and the W3 replay guard. `taskDetails` gains `subtasks` and
`dtstart`, and every view item gains `parentTitle`. The engine gains two
write commands (`deleteTask`, `setRule`) and passes `parentId` on `add` and
`on` on `mark`. The presets map to and from RRULE text in a pure web module,
in the style of W4's filter tree: a rule the presets cannot write exactly
opens in the raw field, so any stored rule round-trips. A rule batch carries
`baseVersion` on every op, counted from the row's `version`, so a rule
change sent against a stale version is refused instead of overwriting what
another device wrote.

**Tech Stack:** as W4 (Nuxt 4.5 SPA, Nuxt UI 4.11.3 default theme,
`@nuxtjs/i18n` 10.6, `@sqlite.org/sqlite-wasm` 3.53.4-build1, Vitest 5,
Playwright 1.63). No new dependencies.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md):
"Decisions for #414 (task editing)", #391 under "Backlog decisions", W3
departures 2 and 10, W4 "Behaviour worth knowing".
[`docs/specs/2026-09-26-plan-c-recurrence-design.md`](../specs/2026-09-26-plan-c-recurrence-design.md)
(the rule subset, Q14's one parser, stranded occurrences).
[ADR 0002](../adr/0002-recurrence-is-virtual.md),
[ADR 0004](../adr/0004-field-level-last-write-wins.md),
[ADR 0009](../adr/0009-subtask-completion-uses-the-parent-occurrence.md),
[ADR 0013](../adr/0013-tombstones-and-the-retention-contract.md). Task spec:
[`specs/tasks/active/T-2026-10-02-web-task-editing.md`](../../specs/tasks/active/T-2026-10-02-web-task-editing.md).

## Decisions this plan takes as given

The maintainer's decisions of 2026-10-02, recorded in the client-shells
design under "Decisions for #414 (task editing)":

1. **Recurrence** is a preset form (Daily, Weekly with weekdays, Monthly,
   Yearly, an interval, a start date that is `dtstart`) plus a raw RRULE field
   for the subset the presets cannot express, checked live, as the filter
   tree and raw JSON are. Marks on past occurrences stay; future occurrences
   follow the new rule. A task can be made recurring, and a recurring task
   one-off by clearing `rrule`. A rule write carries `baseVersion` (ADR 0004)
   and is refused with a reason when the row has no `version` yet. The form
   previews the next dates through the shared expander. A subtask carries no
   rule.
2. **Subtasks** show in the parent's drawer (add, mark, open). In list,
   kanban and calendar a subtask is an ordinary row with a link to its
   parent, never nested. Two levels only. A subtask of a recurring parent is
   marked on the parent's current occurrence (ADR 0009).
3. **Delete** asks "Delete task and N subtasks?", then sends one batch that
   deletes the live subtasks first and the parent last (#391). No undo.
4. **W3's write rules hold.** Every write carries its `opId` (and a create its
   `id`) from the tab. The core checks `store.seen(opId)` before any
   validation and claims it in the transaction that queues the ops (W3
   departure 2). Writes publish before the network answers. A command must not
   nest `withWriteLock`.
5. **Nuxt UI components and default theme**, every string in `en.json` and
   `ru.json`, the backend's CSP (no inline handlers, no runtime scripts,
   nothing from another origin), and a keyboard path for every action.
6. **The four required gate names do not change.** `Web e2e` and `Image`
   stay candidates.

## Verified facts (2026-10-02, on `c830d6d`)

- **Every `delete` needs an integer `baseVersion`** equal to the row's
  `version`, or it answers `conflict` (`apply-op.ts`). A `set` takes an
  optional `baseVersion` and checks it when present, **before** the
  superseded check; `rrule` is the only field that requires one
  (`FIELDS_REQUIRING_BASE_VERSION`). Every applied op raises the row's
  `version` by one; a superseded or refused op does not.
- **Each op of a batch is its own transaction** under the per-user advisory
  lock (`sync.service.ts` `applyOne`, ADR 0017). Another request of the same
  user can land between two ops of one batch.
- **`rowRejection` checks the row as it would be after the op**
  (`row-rules.ts`): `rrule` without `dtstart` is refused, so `set rrule` on a
  row with no `dtstart` fails, and a subtask (`parentId` set) cannot carry an
  `rrule`. Clearing `rrule` leaves a valid row whatever `dtstart` holds.
- **The depth rule and #391 are enforced server-side**
  (`referenceRejection`, `deleteRejection`): `parentId` must name a live task
  of the user with no parent of its own; a task with live subtasks cannot be
  given a parent, and cannot be deleted. Tombstoned subtasks do not count.
  The server never cascades.
- **Client-core already has the pieces:** `syncedRow` and `deleteOp`
  (`baseVersion` from the replica's `version`), `undoMove`'s refusal of a row
  with queued ops, `replayed` and `submitOwn`, `planMark` with `on`, and
  `recurrenceOf`, which gives a subtask its parent's rule. `mark` with `on`
  validates the date against the parent's rule for a subtask (`isOccurrence`).
  `taskDetails` returns `Item & { notes, rrule }`; `due()` lists subtasks as
  ordinary rows already.
- **A queued delete hides the row at once** (`overlay`: `deletedAt:
  'pending'`).
- **`Due` is what `todoer list --json` prints**, so a field added to `Due`
  changes the CLI's output. `Item` (`viewTasks`, `boardTasks`,
  `calendarTasks`, `taskDetails`) is read only by the web.
- **`editTask` refuses `scheduledOn` on a recurring task** ("a recurring
  task is scheduled by its rule"), and the drawer shows a recurring task's
  scheduled date read-only with `drawer.rule` (W3 departure 10). The drawer's
  `readonly` covers an ended series (`rrule` set, no occurrence).
- **The CLI makes recurring tasks** (`add --rrule … --from …`) and warns, but
  queues anyway, when a rule produces no date within `HORIZON_DAYS` of its
  start (`emptyRuleNotice`, M5). It cannot make subtasks, delete tasks or edit
  rules. `cli list --json` prints `parentId`, `rrule`, `dtstart`,
  `scheduledOn` and the current `occurrence`.
- **`apps/web` depends on `@todoer/client-core` only.** Client-core
  re-exports `filterProblem`, `filterSize` and `Filter` from `@todoer/specs`;
  `parseRrule`, `WEEKDAYS` and `Weekday` are not re-exported yet.
- **Every case in `packages/specs/vectors/rrule.json`** produces at least one
  date from its own `dtstart` (the one empty `expected` is a window before
  `dtstart`).
- **The web as built in W4:** `TaskDrawer.vue` closes with the toast
  `drawer.gone` when its task turns null, unless `returning` is set;
  `MoveDateDialog.vue` and `ColumnsDialog.vue` are `UModal` dialogs;
  `pluralForm` drives `summary.tasks.<form>`; `calendar.ts` has a UTC
  `weekday(date)` (0 = Monday); `PlacementChip` has a `UDropdownMenu`;
  `seedTask` in `e2e/fixtures.ts` takes `title`, `scheduledOn`, `dueOn`.
- **The e2e budget:** the `account` fixture hands each test the worker's
  session through one refresh, which the server does not count. New tests
  cost no logins or registrations.

## Where this plan departs from the design docs and the brief

The #414 decisions leave these open; each line gives the default this plan
takes. Task 9 records them in the client-shells design ("Departures in plan
W5"). No backend or CLI change is needed: the server already enforces the
depth rule, no rule on a subtask, no delete over live subtasks, and
`baseVersion` on `rrule`.

1. **Switching between one-off and recurring tidies the date fields.**
   Making a task one-off writes `rrule: null`, `dtstart: null` and
   `scheduledOn` = its current occurrence (null if the series ended), so the
   task stays on the day it was due. Making a task recurring writes `dtstart`
   and `rrule` and clears `scheduledOn`, which a recurring task never reads.
   The form's start date defaults to the task's `scheduledOn`, else today. A
   rule change keeps `dtstart` unless the person edits it.
2. **Every op of a rule batch carries `baseVersion` = `version + i`**, i
   being its index in the batch, although the server requires it on `rrule`
   only. A batch sent against a stale `version` is refused at its first op,
   and usually whole. `dtstart` goes first only when the row has none
   (`rowRejection` refuses `rrule` without it); otherwise `rrule` goes
   first. Known edge: each op is its own transaction, so a write by another
   device can land between two ops, and a server version that has moved on
   by exactly k writes matches the count of op k. Either way part of the
   change applies, and the badge shows the refused rest.
3. **Delete and rule writes refuse a task that is not settled**: no
   `version`, or a task op still queued for it, which would move the server's
   version past the one sent ("not synced yet", as `undoMove` already
   refuses). One helper, `settledTask`, serves `undoMove`, `deleteTask` and
   `setRecurrence`. A subtask made offline blocks its parent's delete until it
   syncs.
4. **A rule that produces no date within 10 years of its start is
   refused** (`ruleProblem`); the CLI's `add` only warns (M5). A rule whose
   dates all lie in the past is accepted: it ends the series.
5. **A rule change has no undo either.** The decisions name none; past marks
   stay, so re-entering the old rule restores the old series.
6. **A subtask takes its parent's project** when its text names none, so a
   project view shows it with its parent. The text is quick-add text (`p2`,
   `#project`, `@tag`). Subtasks are not reordered: rank `a0`, as `add`
   writes, and listed by id, which is creation order.
7. **The drawer reads and ticks a subtask at the parent's current
   occurrence** (decision 2); the list shows the subtask at its own current
   occurrence, as `due()` does today. The two differ when the parent was done
   before the subtask. For an ended series the checklist is read-only.
8. **Switching a parent between one-off and recurring moves its subtasks to
   the other axis**: their old marks no longer apply and they show open.
   Marks are not migrated.
9. **Presets write canonical text only:** `FREQ=…`, `;INTERVAL=n` when n > 1,
   and for Weekly `;BYDAY=` in `WEEKDAYS` order. Any other rule opens in the
   raw field, including `FREQ=WEEKLY` with no `BYDAY`, which the CLI can
   write. Monthly and Yearly repeat on the start date's day (no
   `BYMONTHDAY`), so a monthly rule from the 31st skips short months, as the
   expander does; the preview shows it.
10. **The parent link is a link on a row and a card, and a menu item on a
    calendar chip** ("Open parent"): a link inside the chip's button would
    nest interactive elements.
11. **Delete lives in the drawer only**, not in row, card or chip menus. An
    ended series keeps its rule editor enabled, so it can be extended or made
    one-off; its other fields stay read-only.

## Global Constraints

- **The CLI, the backend and `@todoer/specs` do not change.** `git diff main
  -- apps/cli apps/backend scripts/ packages/specs` is empty, and both shell
  e2e scripts pass. The OpenAPI document does not change.
- **Client-core re-exports `parseRrule`, `WEEKDAYS` and `type Weekday`** next
  to `filterProblem`, so the web needs no new package dependency.
- **`Due` does not change** (it is the CLI's `list --json`); new read fields
  go on `Item` and on `taskDetails`' result.
- **No new dependencies.** Dates are `YYYY-MM-DD` strings throughout (ADR
  0010); a weekday comes from `calendar.ts`' UTC `weekday`. Never format a
  local `Date` with `toISOString`.
- **Workspace command:**
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test`,
  then `pnpm lint`. Each task ends with both green. Tasks 6, 7 and 8 also end
  with `pnpm --filter @todoer/web e2e` green.
- **Every requirement has a test that failed first.** Each task names the
  mutation that turns its tests red. Revert it after checking.
- **Commits:** Conventional Commits with a scope; the body says why; no
  `Co-Authored-By` trailer; `pnpm format` first. Branch
  `feat/web-task-editing`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`. Candidates: `Web e2e`, `Image`.

## Review Focus

1. **`baseVersion` arithmetic of a rule batch.** One-off → recurring on a row
   with no `dtstart` must send `set dtstart` (`version`), `set rrule`
   (`version + 1`), `set scheduledOn null` (`version + 2`); a recurring row
   sends `rrule` first. Check that every op carries its own count, that a
   field equal to the stored value is left out before counting, that
   `settledTask` runs before any op is built, and that the partial-batch edge
   of departure 2 is documented, not hidden (Task 3).
2. **Replay of the three writes.** A worker that dies after committing gets
   the same command again: `seen(opId)` must come before every validation (a
   deleted task would read "no task", a rule already set would read as
   unchanged and queue nothing, which is right, but only by luck), and a
   subtask's `id` is minted once in the tab (`Draft` already mints it for
   `add`) (Tasks 1–4).
3. **The subtask axis.** The drawer's `closed` and the tick's `on` must both
   be the parent's current occurrence, never the subtask's own; a one-off
   parent sends no `on` (`mark` refuses it). Check the lag case: parent done
   this week, subtask not (departure 7) (Tasks 2, 7).
4. **Delete completeness.** Tombstoned subtasks are not deleted again; every
   live one is, before the parent; the queued deletes hide all of them at
   once; the drawer closes with "Task deleted", not `drawer.gone`; a copy
   whose original was deleted keeps living, and its "Return to series" is
   refused. A subtask created on another device and not pulled yet gets the
   parent's delete refused by the server: check that the badge shows it and
   nothing hides it (Tasks 1, 6).
5. **Rule round-trip.** Opening the dialog and saving without a change must
   write nothing: a canonical rule opens as its preset, any other in the raw
   field with its text unchanged, and `setRecurrence` compares strings. A
   CLI-made `FREQ=DAILY` opens as Daily, `FREQ=WEEKLY` as raw. The weekly
   default weekday comes from the start date in UTC, and the preview starts
   at the tab's local today (Tasks 3, 5, 8).
6. **Field hygiene across the switch.** After one-off → recurring the task
   has no `scheduledOn`; after recurring → one-off it has no `rrule` or
   `dtstart` and `scheduledOn` is the occurrence it was showing; marks are
   untouched in both directions, and `editTask`'s refusal of `scheduledOn` on
   a recurring task still holds (departure 1) (Task 3).

---

### Task 0: Commit the plan and the task spec (controller)

- [x] `specs/tasks/active/T-2026-10-02-web-task-editing.md` exists (FR-001…
      FR-012, steps T001–T010), and the client-shells design holds
      "Decisions for #414 (task editing)".
- [x] Commit `docs: plan W5 — task delete, subtasks and recurrence editing in
      the web` on `feat/web-task-editing`.

---

### Task 1: client-core: `deleteTask` and `settledTask`

Implements FR-001 (T001). Departure 3.

**Files:**

- Modify: `packages/client-core/src/operations.ts`, `operations.spec.ts`

**Interfaces:**

```ts
/**
 * A task a destructive op may cite by `version`: live, synced, and with no
 * task op still queued for it, since a queued op would raise the server's
 * version past the one sent (departure 3). Throws UsageError `no task <id>`
 * or `<what> <id> is not synced yet`.
 */
function settledTask(
  store: Store,
  all: Row[],
  id: string,
  what: 'task' | 'subtask',
): Row & { version: number };

/**
 * Deletes a task and its live subtasks (#391): one batch, each live
 * subtask's `delete` (by id) before the parent's, each with the row's
 * `version` as `baseVersion`. Every row must be settled. No undo.
 * Replay-safe.
 */
export async function deleteTask(
  core: Core,
  minted: Minted,
  taskId: string,
): Promise<{ synced: boolean }>;
```

  `settledTask` is `undoMove`'s two checks (queued ops, then `syncedRow`)
  moved into one helper; `undoMove` calls it, and its existing tests stay as
  they are. `deleteTask`, after `replayed(core, minted.opId)`: the parent
  through `settledTask(…, 'task')`, then each live task with `parentId ===
  taskId`, sorted by `compareIds`, through `settledTask(…, 'subtask')`. The
  ops are `deleteOp('task', row, core.newId)` for each subtask, then the
  parent's, through `submitOwn(core, ops, 'delete', minted.opId)`.

- [ ] **Step 1: Tests (red),** in a new `describe('deleteTask')`, with the
      fake transport and `put`:
  - parent `p` (version 4) with subtasks `s2` (version 3), `s1` (version 2)
    and a tombstoned `s0` → queued, in order: delete `s1` (`baseVersion` 2),
    delete `s2` (3), delete `p` (4); the first op's `opId` is `minted.opId`;
    `viewTasks` and `taskDetails` already show none of the three;
  - a subtask alone → one delete; its parent stays;
  - refusals, each with nothing queued: `p` without `version` ("task p is not
    synced yet"); `s2` without `version` ("subtask s2 is not synced yet"); a
    queued `set title` on `p`; a queued `set priority` on `s1`; an unknown id
    and a tombstoned task ("no task");
  - offline (the transport rejects): `synced: false`, the three deletes
    queued, the rows hidden;
  - replay: the same `minted` after the first run applied and settled →
    nothing queued, no "no task";
  - the origin of a moved copy deleted → the copy is still listed, and
    `undoMove` of it is refused "the original task of c is gone".
- [ ] **Step 2: Code.** Move the checks into `settledTask`, call it from
      `undoMove`, add `deleteTask`.
- [ ] **Step 3: Mutations.** (a) Put the parent's delete first. The order
      assertion goes red. (b) Drop the queued-ops check from `settledTask`.
      The queued `set title` case goes red, and `undoMove`'s "queued set
      title" case with it. (c) Include tombstoned subtasks. The `s0` case
      goes red. (d) Validate before `replayed`. The replay case goes red with
      "no task". Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): delete a task with its
      subtasks`. Body: #391 makes the client delete live subtasks first, in
      the same batch. A delete cites the row's exact version, so a row with
      writes still queued is refused rather than sent with a version the
      server will have moved past.

---

### Task 2: client-core: subtasks

Implements FR-002, FR-003 (T002). Departures 6, 7.

**Files:**

- Modify: `packages/client-core/src/operations.ts`, `operations.spec.ts`

**Interfaces:**

```ts
/** `add`: quick-add text plus already-validated recurrence fields; with
 *  `parentId`, a subtask of that task (no rule; the parent's project unless
 *  the text names one). */
export async function add(
  core: Core,
  text: string,
  recurrence: Record<string, string>,
  minted?: Minted,
  parentId?: string,
): Promise<{ synced: boolean; title: string; created: string[]; task: Row | null }>;

/** A listed task with what a screen shows. */
export type Item = Due & {
  column: string | null;
  closed: boolean;
  /** The parent's title for a subtask; null for a top-level task. */
  parentTitle: string | null;
};

/** One row of a drawer's checklist: closed at the parent's current
 *  occurrence (ADR 0009), or by its own mark under a one-off parent. */
export type Subtask = { id: string; title: string; closed: boolean };

export type TaskDetails = Item & {
  notes: string | null;
  rrule: string | null;
  dtstart: string | null;
  /** Live subtasks by rank, then id. */
  subtasks: Subtask[];
};
export function taskDetails(store: Store, today: string, id: string): TaskDetails | null;
```

  `add` with `parentId`, after the replay branch: a non-empty `recurrence` →
  UsageError "a subtask repeats with its parent"; `liveTask(all, parentId)`
  (UsageError "no task …"); a parent with a `parentId` → UsageError "a
  subtask cannot have subtasks". The create gains `parentId`, and
  `projectId` falls back to the parent's when the text names no project.

  `itemOf` takes a map of live task titles and sets `parentTitle` from
  `row.parentId`. `taskDetails`' `closed` for a subtask is
  `isClosed(stateOf(marks, childId)(details.occurrence))`, `details` being the
  parent's own row from `due()`; under a one-off parent `occurrence` is null,
  so the child's own one-off mark is read.

- [ ] **Step 1: Tests (red).**
  - `add(core, 'Dishes', {}, minted, 'p')` with `p` in project `home` →
    one `create task` with `parentId: 'p'`, `projectId` of `home`, no `rrule`
    or `dtstart`; `'Floor #garage'` → `projectId` of the new `garage` project;
  - refusals, nothing queued: a parent that is a subtask; an unknown parent;
    `recurrence` `{ rrule: 'FREQ=DAILY', dtstart: TODAY }` with a parent;
  - `taskDetails('p')`: `subtasks` holds the live children in rank-then-id
    order, a tombstoned child left out, `closed` from each child's one-off
    mark; `taskDetails` of a child has `parentTitle` = the parent's title and
    `subtasks: []`; `viewTasks` items carry `parentTitle` for children and
    null for top-level tasks; `dtstart` is the stored one or null;
  - a weekly parent `w` (`FREQ=WEEKLY;BYDAY=MO`, `dtstart` `2026-09-07`,
    today `2026-10-02`, so `w`'s current is `2026-09-28`): child `c` done at
    `2026-09-28` → `closed: true`; with `w` also done at `2026-09-28` (its
    current becomes `2026-10-05`) → `c` is `closed: false`;
  - the lag case: `w` done at `2026-09-28`, `c` done at `2026-10-05` only →
    `c` is `closed: true` in `taskDetails('w')`, while `viewTasks` lists `c`
    at its own current occurrence, `2026-09-28` (departure 7);
  - `mark(core, 'done', 'c', '2026-10-05', minted)` queues the occurrence
    `2026-10-05` for `c` (the parent's axis), and `taskDetails('w')` shows
    `c` closed.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Read `closed` at the child's own current
      occurrence. The lag case goes red. (b) Drop the project fallback. The
      `home` case goes red. (c) Drop the depth check. The subtask-parent
      refusal goes red. Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): subtasks for the drawer`. Body:
      ADR 0009 keys a subtask's completion by its parent's occurrence, so the
      drawer reads it there. The parent's title rides on each view item, not
      on `Due`, which is the CLI's JSON.

---

### Task 3: client-core: `ruleProblem`, `upcoming`, `setRecurrence`

Implements FR-004, FR-005 (T003). Departures 1, 2, 3, 4.

**Files:**

- Modify: `packages/client-core/src/occurrence.ts`, `occurrence.spec.ts`,
  `operations.ts`, `operations.spec.ts`, `index.ts` (re-export `parseRrule`,
  `WEEKDAYS`, `type Weekday`)

**Interfaces:**

```ts
// occurrence.ts
/**
 * Why `rrule` from `dtstart` cannot be a task's rule, or null: the parser's
 * message, a start that is not a date ("the start must be a date,
 * YYYY-MM-DD"), or a rule that produces no date within HORIZON_DAYS of its
 * start ("this rule produces no date from <dtstart>"). The one check the
 * form and setRecurrence share (departure 4).
 */
export function ruleProblem(rrule: string, dtstart: string): string | null;

/** The first `n` dates of a rule on or after `from` (and on or after
 *  `dtstart`), within HORIZON_DAYS of `from`; [] when ruleProblem refuses it. */
export function upcoming(rrule: string, dtstart: string, from: string, n = 5): string[];

// operations.ts
export type Rule = { rrule: string; dtstart: string };

/**
 * Sets, changes or clears (null) a task's rule (#414 decision 1), one batch.
 * Op i carries baseVersion `version + i` (departure 2). Recurring → one-off:
 * rrule null, dtstart null, scheduledOn = the current occurrence. One-off →
 * recurring: dtstart (when it differs), rrule, scheduledOn null. Recurring →
 * recurring: rrule, then dtstart, each when it differs. Fields equal to the
 * stored value are left out; an unchanged rule queues nothing. Refuses a
 * subtask, a rule ruleProblem refuses, and (when anything would be written)
 * a task that is not settled. Replay-safe.
 */
export async function setRecurrence(
  core: Core,
  minted: Minted,
  taskId: string,
  rule: Rule | null,
): Promise<{ synced: boolean }>;
```

  `setRecurrence`, after `replayed`: `liveTask`; `task.parentId` set →
  UsageError "a subtask repeats with its parent"; `rule !== null` and
  `ruleProblem(rule.rrule, rule.dtstart)` → UsageError with that text. The
  current occurrence for the one-off switch is
  `currentOccurrence(recurrenceOf(task, undefined), stateOf(marks, taskId),
  localDate(core.now()))?.occurrence ?? null`. With the field list empty,
  `submitOwn(core, [], 'rule', minted.opId)` claims the key and only
  flushes. Otherwise `const row = settledTask(store, all, taskId, 'task')`,
  and op i is `{ ...setTask(task, field, value, core.newId, ts), baseVersion:
  row.version + i }`.

- [ ] **Step 1: Tests (red),** `occurrence.spec.ts`:
  - `ruleProblem` is null for every case in `vectors/rrule.json` from its
    `dtstart`; `'FREQ=HOURLY'` → the parser's message; `('FREQ=DAILY',
    '2026-02-30')` → the start message; `'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'`
    → "produces no date"; `'FREQ=DAILY;UNTIL=20200101'` from `2019-12-30` →
    null (a series that ended is a valid rule);
  - `upcoming('FREQ=MONTHLY', '2026-01-31', '2026-02-01', 3)` →
    `['2026-03-31', '2026-05-31', '2026-07-31']`; a `from` before `dtstart`
    starts at `dtstart`; `n` is respected; `'FREQ=HOURLY'` → `[]`.
- [ ] **Step 2: Tests (red),** `operations.spec.ts`, `describe('setRecurrence')`:
  - one-off `o2` (version 5, a leftover `dtstart` `2026-10-05`, no `rrule`,
    no `scheduledOn`) with the same rule → `set rrule` (`baseVersion` 5)
    alone;
  - one-off `o` (version 5, `scheduledOn` `2026-10-03`, no `dtstart`) with
    `{ rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2026-10-05' }` → queued, in
    order: `set dtstart` (`baseVersion` 5), `set rrule` (6), `set scheduledOn
    null` (7); the first `opId` is `minted.opId`; `taskDetails('o')` shows
    the rule and occurrence `2026-10-05` at once;
  - recurring `r` (version 2, `FREQ=DAILY` from `2026-09-01`, `2026-09-30`
    done) to `FREQ=WEEKLY;BYDAY=MO` with the same `dtstart` → one `set rrule`
    (`baseVersion` 2); the `2026-09-30` mark is untouched in the store; the
    current occurrence follows the weekly rule;
  - `r` with a new rule and a new `dtstart` → `set rrule` (2), then `set
    dtstart` (3);
  - `r` cleared (`FREQ=WEEKLY;BYDAY=MO` from `2026-09-07`, `2026-09-28` open,
    today `2026-10-02`) → `set rrule null` (2), `set dtstart null` (3), `set
    scheduledOn '2026-09-28'` (4); the marks are untouched; `taskDetails`
    shows a one-off task scheduled on `2026-09-28`, and `editTask` may now
    change `scheduledOn`;
  - an ended series (`FREQ=DAILY;COUNT=1`, its date done) cleared → `rrule`
    and `dtstart` only;
  - an unchanged rule, and `null` on a one-off → nothing queued, no refusal,
    even for a task without `version`;
  - refusals, nothing queued: a subtask; a task without `version` ("not
    synced yet"); a queued `set title` on the task; `'FREQ=HOURLY'`; a start
    of `'2026-02-30'`; `'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30'`;
  - offline: `synced: false`, ops queued, `taskDetails` follows at once;
  - replay after the first run applied and settled → nothing queued;
  - the transport answers `conflict` for every op → the call rejects, as a
    conflicting `deleteStatus` does.
- [ ] **Step 3: Code.**
- [ ] **Step 4: Mutations.** (a) Give every op the same `baseVersion`. The
      one-off case goes red. (b) Send `rrule` before `dtstart` for a row
      without one. The order assertion goes red. (c) Write `scheduledOn` from
      today instead of the current occurrence. The cleared case goes red. (d)
      Skip the subtask refusal. Red. (e) Count `baseVersion` before leaving
      out unchanged fields. The `o2` case goes red (5 → 6). Revert all.
- [ ] **Step 5: Commit.** `feat(client-core): edit a task's recurrence rule`.
      Body: ADR 0004 guards a rule change with `baseVersion` because it
      strands occurrences. Each op of the batch counts its own version, so a
      change sent against a stale version is refused instead of overwriting
      another device's, and the form and the core check a rule with the same
      function.

**Checkpoint:** client-core holds every W5 operation with Node tests, and the
CLI is unchanged (`git diff main -- apps/cli` is empty).

---

### Task 4: The engine: delete, rule, subtask and `on` commands

Implements FR-006 (T004).

**Files:**

- Modify: `apps/web/app/db/protocol.ts`, `engine.ts`, `engine.spec.ts`

**Interfaces:**

```ts
// protocol.ts
export type Write =
  | {
      kind: 'add';
      opId: string;
      id: string;
      text: string;
      /** Makes the task a subtask of this one. */
      parentId?: string;
    }
  | {
      kind: 'mark';
      opId: string;
      taskId: string;
      mark: Mark;
      /** A subtask's parent occurrence (ADR 0009). */
      on?: string;
    }
  | /* edit, move, saveView, deleteView, saveStatus, setCompleting,
       deleteStatus, moveOccurrence, undoMove as in W4 */ ...
  | { kind: 'deleteTask'; opId: string; taskId: string }
  | { kind: 'setRule'; opId: string; taskId: string; rule: Rule | null };
```

  `Topics['task']` stays `{ id; task: ReturnType<typeof taskDetails> }`, so
  it carries `subtasks`, `dtstart` and `parentTitle` without a change.
  `Draft` already mints `id` for `add`. `apply`:

  - `add` → `add(core, w.text, {}, { opId, id: w.id }, w.parentId)`;
  - `mark` → `mark(core, w.mark, w.taskId, w.on, { opId })`;
  - `deleteTask` → `deleteTask(core, { opId }, w.taskId)`;
  - `setRule` → `setRecurrence(core, { opId }, w.taskId, w.rule)`.

- [ ] **Step 1: Tests (red)** in `engine.spec.ts`, over the in-memory WASM
      store and the fake transport:
  - "reach their operations with the tab ids" covers `deleteTask`, `setRule`,
    `add` with `parentId` and `mark` with `on`;
  - `deleteTask` of a synced parent with a synced subtask → the watched view
    drops both and the watched task publishes `null` **while the transport is
    still pending**;
  - `deleteTask` of a task created offline → `{ ok: false, failure.kind:
    'invalid' }`, detail "not synced yet";
  - `add` with `parentId` → the parent's task topic lists the subtask while
    the transport is pending;
  - `mark` with `on` → the transport saw the occurrence op with that date;
  - `setRule` on a synced one-off → the task topic shows `rrule`, `dtstart`
    and the current occurrence while pending; the transport saw three `set`s
    with `baseVersion` v, v + 1, v + 2;
  - crash replay: engine 2 over the same store handles the identical
    `deleteTask` → the transport saw no second batch;
  - each new write while signed out → `signed-out`.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Drop `w.on`. The `on` test goes red. (b)
      Drop `w.parentId`. The subtask test goes red. Revert both.
- [ ] **Step 4: Commit.** `feat(web): delete, rule and subtask commands in the
      worker`. Body: the drawer's three new writes reach their client-core
      operations with the tab's ids, so a resend after a crash queues
      nothing.

**Checkpoint:** every W5 write exists behind the protocol, proven in Vitest
without a browser.

---

### Task 5: Presets to and from RRULE

Implements FR-007 (T005). Departure 9.

**Files:**

- Create: `apps/web/app/utils/recurrence.ts`, `recurrence.spec.ts`

**Interfaces:**

```ts
import { parseRrule, WEEKDAYS, type Weekday } from '@todoer/client-core';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type Preset = { freq: Freq; interval: number; byDay: Weekday[] };

/** Canonical text: FREQ, INTERVAL only when > 1, BYDAY only for WEEKLY and
 *  in WEEKDAYS order. Weekly with no day gives `FREQ=WEEKLY…` with no BYDAY;
 *  the form never sends that (FR-010). */
export function toRrule(p: Preset): string;
/** The preset that writes exactly `rrule`, or null (raw mode): unparseable,
 *  a part beyond FREQ/INTERVAL/BYDAY, BYDAY outside WEEKLY or with an
 *  ordinal, Weekly without BYDAY, or text that is not toRrule's own. */
export function presetOf(rrule: string): Preset | null;
/** Daily, every 1, with the start date's weekday ready for Weekly. */
export function blankPreset(dtstart: string): Preset;
```

  `presetOf` parses, rebuilds a preset from `freq`, `interval` and plain
  `byDay` days, and returns it only when `toRrule(preset) === rrule`.
  `blankPreset` takes the weekday from `calendar.ts`' `weekday`.

- [ ] **Step 1: Tests (red).**
  - `toRrule`: `{DAILY, 1}` → `FREQ=DAILY`; `{WEEKLY, 2, [WE, MO]}` →
    `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE`; `{MONTHLY, 3}` →
    `FREQ=MONTHLY;INTERVAL=3`; `{YEARLY, 1}` → `FREQ=YEARLY`; Daily with
    `byDay` writes no BYDAY;
  - `presetOf` round-trips each of those; it is null for `FREQ=WEEKLY`,
    `FREQ=WEEKLY;BYDAY=WE,MO`, `FREQ=DAILY;INTERVAL=1`,
    `FREQ=MONTHLY;BYMONTHDAY=15`, `FREQ=MONTHLY;BYDAY=1MO`,
    `FREQ=DAILY;COUNT=5`, `FREQ=WEEKLY;BYDAY=MO;WKST=SU`, `FREQ=HOURLY`;
  - every `toRrule` output with a weekday has `ruleProblem(…, '2026-10-05')`
    null;
  - `blankPreset('2026-10-04').byDay` is `['SU']` with `process.env.TZ` set
    to `Pacific/Kiritimati` and to `America/Adak`.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Always write `INTERVAL`. The Daily case goes
      red. (b) Return the parsed preset without the canonical check. The
      `BYDAY=WE,MO` case goes red. (c) Take the weekday from a local `new
      Date(...)`. One TZ run goes red. Revert all.
- [ ] **Step 4: Commit.** `feat(web): recurrence presets as RRULE text`.
      Body: the presets write one canonical text, and any other rule stays in
      the raw field, so opening and saving a rule never rewrites it.

---

### Task 6: Delete from the drawer

Implements FR-008, FR-011 (T006). Departure 11.

**Files:**

- Create: `apps/web/app/components/DeleteTaskDialog.vue`,
  `apps/web/e2e/editing.spec.ts`
- Modify: `apps/web/app/components/TaskDrawer.vue`,
  `apps/web/e2e/fixtures.ts` (`seedTask` takes any task fields),
  `apps/web/e2e/offline.spec.ts`, `apps/web/i18n/locales/en.json`, `ru.json`

  - `TaskDrawer` gets a "Delete" button (`color="error"`, `variant="outline"`,
    `i-lucide-trash-2`) under the form, for every live task, also a closed or
    ended one.
  - `DeleteTaskDialog` is a `UModal` like `MoveDateDialog`: the title "Delete
    task", the text `deleteTask.confirm` ("Delete “{title}”?") or
    `deleteTask.confirmWith` ("Delete “{title}” and {subtasks}?", with
    `drawer.subtasks.<pluralForm>` = "{n} subtask(s)"), "This cannot be
    undone.", Cancel and Delete. Delete has the focus when the dialog opens,
    so Enter confirms. N is `task.subtasks.length`.
  - On confirm the drawer sets `deleting` (which, like `returning`,
    suppresses `drawer.gone`), sends `{ kind: 'deleteTask', taskId }`, and on
    `ok` closes with the toast `deleteTask.done` ("Task deleted"). A refusal
    stays in the drawer with `fail(result)`.
  - `seedTask(request, token, fields: { title: string } & Record<string,
    unknown>)`, so a test can seed `parentId`, `rrule`, `dtstart` and
    `projectId`.

- [ ] **Step 1: e2e (red).** `editing.spec.ts`, "editing: delete a task and
      its subtasks", with `account`:
  - seed "Trip", its subtasks "Passport" and "Tickets", and "Lone";
  - open Trip's drawer, Delete → the dialog reads "Delete “Trip” and 2
    subtasks?"; Cancel → Trip is still listed;
  - Delete, Delete → the drawer closes, the toast says "Task deleted", All
    open lists none of the three; reload → still none; `cli list --json`
    holds none of them;
  - keyboard alone: focus Lone's row, open it, Tab to Delete, Enter, Enter →
    the dialog read "Delete “Lone”?", and Lone is gone.
- [ ] **Step 2: e2e (red), offline.** In `offline.spec.ts`, "offline: a delete
      shows at once, an unsynced task cannot be deleted": with "Errand"
      synced, go offline, delete it → gone at once and after a reload, the
      badge shows pending; quick-add "Draft", open it, Delete, Delete → the
      `invalid` message with "not synced yet", and Draft stays; online →
      pending 0, `cli list --json` lacks Errand and holds Draft. The W2
      Firefox skip stays for the `online` event only.
- [ ] **Step 3: Code.**
- [ ] **Step 4: Mutations.** (a) Drop the `deleting` guard. The "Task
      deleted" assertion goes red (the drawer says `drawer.gone`). (b) Send
      the delete on the first click, without the dialog. The Cancel step goes
      red. Revert both.
- [ ] **Step 5: Commit.** `feat(web): delete a task from the drawer`. Body:
      #414 decision 3. The dialog names the subtasks that go with the task,
      since the batch deletes them too and nothing undoes it.

---

### Task 7: Subtasks in the drawer, parent links on rows

Implements FR-009, FR-011 (T007). Departures 6, 7, 10.

**Files:**

- Create: `apps/web/app/components/SubtaskList.vue`
- Modify: `apps/web/app/components/TaskDrawer.vue`, `TaskRow.vue`,
  `KanbanCard.vue`, `PlacementChip.vue`, `apps/web/e2e/editing.spec.ts`,
  locales

  - `SubtaskList` (in the drawer of a task without a parent): the heading
    "Subtasks" and `drawer.progress` ("{done} of {total} done"), one row per
    subtask (a `UCheckbox` with the `aria-label` "Done: {title}", and the
    title as a link button that opens `?task=<id>`), and an "Add subtask"
    `UInput` that sends `{ kind: 'add', text, parentId }` on Enter and clears
    itself on `ok`. A tick sends `mark` `done` or `undo`, with `on:
    task.occurrence` when the parent has a rule and an occurrence, and no
    `on` otherwise. The list is disabled when the drawer is `readonly`.
  - The drawer of a subtask shows `drawer.subtaskOf` ("Subtask of {title}") as
    a link to the parent, and no checklist.
  - `TaskRow` and `KanbanCard`: under the title of an item with
    `parentTitle`, a `UButton` `variant="link"` with
    `i-lucide-corner-down-right`, the parent's title and the `aria-label`
    "Open parent: {title}", which opens `?task=<parentId>`.
  - `PlacementChip`'s menu gains "Open parent" for a subtask.

- [ ] **Step 1: e2e (red).** In `editing.spec.ts`, "editing: subtasks in the
      drawer and as rows":
  - `cli add "Clean kitchen #house"`; open its drawer; type "Dishes" Enter
    and "Floor #garage" Enter → the checklist shows both and "0 of 2 done";
    tick Dishes → "1 of 2 done";
  - `cli list --json`: Dishes and Floor have `parentId` = Clean kitchen's
    id; Dishes is in project house, Floor in garage;
  - close the drawer: All open lists Floor as a row with the link "Clean
    kitchen" (Dishes is done, so hidden); the link opens the parent's drawer;
  - open Floor: "Subtask of Clean kitchen", no "Add subtask" field;
  - a kanban view (`seedView`) shows Floor's card with the same link;
  - recurring parent: `cli add "Weekly review" --rrule FREQ=WEEKLY --from
    <today>`, add "Inbox zero" in its drawer, then `cli done <Weekly
    review>`; reopen the drawer → "0 of 1 done" at the next week; tick Inbox
    zero → "1 of 1 done", and after a reload still ticked.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Send the tick without `on`. The recurring
      case goes red after the reload (the mark lands on this week, the
      drawer reads next week). (b) Show the checklist in a subtask's drawer.
      The Floor step goes red. (c) Drop the link from `TaskRow`. Red. Revert
      all.
- [ ] **Step 4: Commit.** `feat(web): subtasks in the drawer and parent
      links`. Body: #414 decision 2. A subtask is an ordinary row everywhere
      but the parent's drawer, and it is ticked on the parent's occurrence
      (ADR 0009), so a weekly checklist starts over every week.

---

### Task 8: The recurrence dialog

Implements FR-010, FR-011 (T008). Departures 1, 4, 9, 11.

**Files:**

- Create: `apps/web/app/components/RecurrenceDialog.vue`
- Modify: `apps/web/app/components/TaskDrawer.vue`,
  `apps/web/e2e/editing.spec.ts`, `apps/web/e2e/offline.spec.ts`, locales

  - The drawer's scheduled row: for a one-off task, the date input plus a
    "Repeat…" button; for a recurring task, the read-only date,
    `drawer.rule`, and "Edit repeat…". A subtask has neither button. The
    buttons stay enabled on an ended series; `drawer.ended` becomes "This
    series has ended; only its rule can be changed."
  - `RecurrenceDialog` (`UModal`): a `USelect` "Repeat" with Does not repeat,
    Daily, Weekly, Monthly, Yearly and Custom (RRULE); for the presets a
    `UInputNumber` "Every" (min 1) with the unit; for Weekly a
    `UCheckboxGroup` of the seven days (`Intl.DateTimeFormat(locale, {
    weekday: 'short', timeZone: 'UTC' })`, Monday first, values `WEEKDAYS`);
    a `UInput type="date"` "Starts" for every mode but Does not repeat; for
    Custom a monospace `UInput` "RRULE".
  - Opening: no rule → Does not repeat, start = `scheduledOn` or the tab's
    `localDate(new Date())`, preset `blankPreset(start)`; a rule →
    `presetOf(rrule)` and its mode, or Custom with the text as stored.
  - Live, from the rule text (`toRrule(preset)` or the raw text) and the
    start: `ruleProblem` in an alert (`role="alert"`,
    `data-testid="rule-problem"`), Weekly with no day → "Pick at least one
    day", and otherwise `upcoming(text, start, today)` as an ordered list
    (`data-testid="rule-preview"`, each date in `Intl` long form with the ISO
    date in a `<time datetime>`).
  - Save is disabled while there is a problem and while nothing changed (Does
    not repeat on a one-off, or the same text and start). It sends `{ kind:
    'setRule', taskId, rule }`, `null` for Does not repeat; on `ok` the
    dialog closes; a refusal stays in the dialog with `fail(result)`.

- [ ] **Step 1: e2e (red).** In `editing.spec.ts`, "editing: recurrence", with
      `account`:
  - seed "Gym" with `scheduledOn` = tomorrow; Repeat… → Weekly; untick the
    preselected day, tick Monday and Wednesday, Every 2, Starts = next
    Monday → the preview's first two dates are next Monday and next
    Wednesday; Save → the drawer shows "Repeats:
    FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"; `cli list --json`: that `rrule`,
    `dtstart` = next Monday, `scheduledOn` null;
  - Edit repeat… → Weekly, Monday and Wednesday ticked, Every 2, and Save is
    disabled;
  - untick both days → "Pick at least one day", Save disabled;
  - Custom: `FREQ=HOURLY` → the problem shows, Save disabled;
    `FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30` → "produces no date";
    `FREQ=MONTHLY;BYDAY=1MO` → the preview lists first Mondays; Save →
    `cli list --json` shows it; Edit repeat… → Custom with that text;
  - Does not repeat → Save → the scheduled date is an editable input holding
    the occurrence it showed; `cli list --json`: `rrule` and `dtstart` null,
    `scheduledOn` that date;
  - `cli add "Stretch" --rrule FREQ=DAILY --from <today>` → Edit repeat…
    opens in Daily; `cli add "Walk" --rrule FREQ=WEEKLY --from <today>` →
    Custom with `FREQ=WEEKLY`;
  - seed "Move" and its subtask "Pack" (`seedTask` with `parentId`): Pack's
    drawer has neither "Repeat…" nor "Edit repeat…".
- [ ] **Step 2: e2e (red), offline.** In `offline.spec.ts`: offline,
      quick-add "Plan", open it, Repeat… → Daily → Save → the `invalid`
      message with "not synced yet", the dialog stays open, and nothing is
      queued beyond the add.
- [ ] **Step 3: Code.**
- [ ] **Step 4: Mutations.** (a) Fall back to Daily when `presetOf` is null.
      The Custom reopen step goes red. (b) Leave Save enabled with a problem.
      The `FREQ=HOURLY` step goes red. (c) Show "Repeat…" for a subtask. The
      Pack step goes red. Revert all.
- [ ] **Step 5: Commit.** `feat(web): edit a task's recurrence from the
      drawer`. Body: #414 decision 1. Presets cover the common rules, the raw
      field the rest of the subset, and the form checks and previews with the
      function the core uses to refuse, so what Save sends is what the server
      takes.

**Checkpoint:** delete, subtasks and rule editing are proven in Chromium and
Firefox under the CSP.

---

### Task 9: Docs and departures

Implements FR-012 (T009).

**Files:** `README.md`, `docs/specs/2026-10-01-client-shells-design.md`,
`specs/tasks/active/T-2026-10-02-web-task-editing.md`

- [ ] **Step 1: README, "Using the web client".** "Task drawer": Delete (a
      dialog that counts the subtasks; no undo; refused until the task and
      its subtasks are synced), a checklist of subtasks (add, tick, open; a
      recurring parent's checklist starts over at each occurrence), "Subtask
      of …", and "Repeat…" (presets, start date, raw RRULE, preview, Does not
      repeat; refused until synced). Drop "A recurring task's scheduled date
      is read-only" in favour of "is set by its rule". A new **Subtasks**
      item: an ordinary row, card or chip with a link to the parent; two
      levels only.
- [ ] **Step 2: Client-shells design.** W3 departure 10's last sentence
      becomes "editing `dtstart` and `rrule` shipped in W5". Under "Verified
      facts", "The CLI has no `delete` command, so no client deletes tasks
      today." gains "*(The web deletes tasks since W5.)*". Append "##
      Departures in plan W5" with departures 1–11 (short, each with the
      decision it fills in) and "### Behaviour worth knowing in W5": the
      partial rule batch of departure 2, the parent delete refused for a
      subtask not yet pulled (#391's cost), the subtask that reads open in
      the drawer and listed at another date (departure 7), and marks that
      stop applying when a parent switches axis (departure 8).
- [ ] **Step 3: Stale-claim sweep.**

```sh
rg -n "no client deletes|still not built|read-only|cannot edit|subtasks? (are|is) not|Repeat" \
  README.md docs/specs docs/adr .claude apps/web/app apps/web/i18n
```

  Every hit is updated or is a historical record (plans, earlier departures).

- [ ] **Step 4: Commit.** `docs: task delete, subtasks and rule editing in the
      web, and plan W5's departures`. Tick T009.

---

### Task 10: Full proof and close-out (controller)

Implements FR-011, FR-012 (T010).

- [ ] **Step 1: Full proof.** The workspace command, `pnpm lint`, both shell
      e2e scripts, `./node_modules/.bin/prettier --check .` redirected to a
      file (exit 0), and the Playwright suite in both projects on a fresh
      `todoer_e2e` at PORT 3010, with the auth budget read from the backend
      log (no more logins than W4's run). `git diff main -- apps/cli
      apps/backend scripts/ packages/specs` is empty.
- [ ] **Step 2: Close the task.** Tick T010 and every Definition of Done
      item, set `Status: done`, add `Completed` and `Result`, `git add`, then
      `git mv` the spec to `specs/tasks/done/`. Commit `docs: move the web
      task editing spec to done`.
- [ ] **Step 3: Memory.** The dnote changelog line (book `todoer`); close
      tuxedo #414; a tuxedo item for each follow-up the reviews left open.
- [ ] **Step 4: Hand-off.** Ask the maintainer about the PR
      (`feat(web): task delete, subtasks and recurrence editing`); nothing is
      pushed without that.

---

## What this plan does not do

- **No undo of a delete or of a rule change** (decision 3, departure 5).
- **No reparenting.** A task cannot be moved under another or out of one;
  subtasks are created under their parent.
- **No reordering of subtasks**, and no nesting in list, kanban or calendar.
- **No delete from rows, cards or chips** (departure 11).
- **No bulk subtask actions.** Completing a parent completes none of its
  subtasks, and the reverse (ADR 0009).
- **No dropping of unsent ops** to delete an unsynced task (departure 3, W4
  open question 3).
- **No `COUNT` or `UNTIL` in the presets**; the raw field takes them.
- **No migration of marks** when a rule or a parent's axis changes
  (departures 1, 8); stranded occurrences stay, as plan C accepted.

## Open questions

None. The maintainer's decisions of 2026-10-02 settle scope; the departures
above are the defaults for what they leave open, each reversible before its
task starts.
