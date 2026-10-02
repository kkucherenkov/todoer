# Plan W4: the web client's calendar and the filter-tree editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a view can use the calendar layout. A week or month grid shows each
task the view's filter selects on its scheduled day and again on its due day,
and a recurring task on each of its occurrences in the visible range. A
person drags a placement to another day, or uses "Move to date…" from the
keyboard or on a touch screen. Moving one occurrence of a recurring task skips
it and creates a linked one-off copy, and Undo, from the toast or later from
the copy's drawer, deletes the copy and reopens the occurrence. The view form
gains a filter-tree editor: `and`/`or`/`not` groups and every leaf the filter
has, checked live by `filterProblem`, with the depth and node limits shown.
The six templates stay as quick starts that fill the tree. This closes tuxedo
#413 and the deferral in client-shells Q8.

**Architecture:** as in W3, the worker computes and the tab renders.
Client-core gains one read, `calendarTasks` (placements for a view and a date
span), and two writes, `moveOccurrence` and `undoMove`, each with Node tests
and the W3 replay guard. The engine gains the two write commands. A tab's
`watch` can carry a span, and the `view` topic gains `today`, `span` and
`placements`. A placement names its task by id, so a daily task in a month
view does not send its item 42 times. Date edits of one-off placements reuse
W3's `edit`. The grid, its navigation and the drag-to-day helper are
hand-built on Nuxt UI primitives; the grid's date math is a pure module over
`addDays`. The filter editor edits the `Filter` JSON itself through pure,
path-based helpers. No model sits between the editor and the stored filter,
so any filter the templates or raw JSON produce round-trips by construction.
`@todoer/specs` gains `filterSize`, so the limits the editor shows are
counted the way `filterProblem` counts them.

**Tech Stack:** as W3 (Nuxt 4.5 SPA, Nuxt UI 4.11.3 default theme,
`@nuxtjs/i18n` 10.6, `@sqlite.org/sqlite-wasm` 3.53.4-build1, Vitest 5,
Playwright 1.63, native HTML5 drag and drop). No new dependencies.

**Spec:** [`docs/specs/2026-10-01-views-design.md`](../specs/2026-10-01-views-design.md):
Q3/Q11/Q13 (the calendar), Q6/Q16–Q18 (the filter), Q7 (the board rule) and
the V1, V2 and W3 departures.
[`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md):
Q8 (the deferral), Q13, Q19, the visual design note, the W1 CSP notes, W2's
"Behaviour worth knowing" and "Departures in plan W3" (2, 6, 9, 10).
[ADR 0002](../adr/0002-recurrence-is-virtual.md),
[ADR 0009](../adr/0009-subtask-completion-uses-the-parent-occurrence.md),
[ADR 0010](../adr/0010-dates-without-times.md). Task spec:
[`specs/tasks/active/T-2026-10-02-web-calendar.md`](../../specs/tasks/active/T-2026-10-02-web-calendar.md).

## Decisions this plan takes as given

1. **Placements (Q11).** A task appears on its `scheduledOn` day and again on
   its `dueOn` day; a recurring task appears on each occurrence in the visible
   range, expanded by client-core's `expand`. A task with both dates on one
   day shows twice, as the design's "Cost" says.
2. **Moves (Q13).** Dragging a scheduled placement sets `scheduledOn`, and a
   due placement sets `dueOn`. Moving one occurrence of a recurring task
   writes `skip` for it and creates a one-off copy carrying `title`, `notes`,
   `projectId`, tags, `priority` and `statusId`, no `rrule`, plus
   `originTaskId` and `originOccurrence`, in one batch. Undo deletes the copy
   and undoes the skip.
3. **Origin fields are set together, at create, and never change** (V2
   departures 5, 6). `originTaskId` is checked for ownership and has no
   foreign key.
4. **The filter is the V2 tree:** depth ≤ 8, ≤ 256 nodes, day offsets within
   ±36 600 or absolute `YYYY-MM-DD`, lower-case ids, `{ "project": null }` for
   tasks without a project, `filterProblem` as the one validator.
5. **W3's write rules hold.** Every write carries its `opId` (and a create its
   `id`) from the tab. The core checks `store.seen(opId)` before any
   validation, and claims it in the transaction that queues the ops (W3
   departure 2). Writes publish before the network answers. A command must not
   nest `withWriteLock`.
6. **Nuxt UI components and default theme**, every string in `en.json` and
   `ru.json`, the backend's CSP (no inline handlers, no runtime scripts,
   nothing from another origin), and a keyboard or touch path for every drag.
7. **The four required gate names do not change.** `Web e2e` and `Image`
   stay candidates.

## Verified facts (2026-10-02, on `50d8c2c`)

- **`due()` evaluates a view's filter once per task, with the facts of its
  current occurrence** (`operations.ts`): a recurring task's `scheduledOn`
  fact is its current occurrence and its `dueOn` the task's own field (V1
  departure 5). With `closedSince` it also returns one-off tasks closed since
  that date, by `fieldTs.state` of the occurrence row, a pending mark counting
  as now (W3 departure 6). A recurring task whose series ended is absent.
- **`expand(rule, dtstart, from, to, limit)` walks every period from
  `dtstart`** (`expand.ts`, with a `ponytail:` note: a daily rule anchored
  decades back costs about 10 000 iterations per call). `currentOccurrence`
  already calls it twice per recurring task on every publish.
- **`recurrenceOf` gives a subtask its parent's rule** (ADR 0009). A copy that
  kept `parentId` under a recurring parent would itself recur on the parent's
  axis.
- **`planMark` validates an occurrence named by `on`** (`isOccurrence`), and
  refuses one closed the other way ("already done — undo it first"). A repeat
  of the same mark returns `closed` and queues nothing. `skip` writes no
  `statusId` (V1 departure 3). A mark is a `create task_occurrence` with the
  derived id, which the server applies as an upsert.
- **Server rules** (`apps/backend/src/sync`): `rowRejection` refuses a task
  with only one of `originTaskId`/`originOccurrence`; `originOccurrence` is a
  date field; `referenceRejection` checks that `originTaskId` names a row the
  user owns, and checks liveness only for `parentId`. A `delete` needs the
  row's exact `baseVersion` and answers `conflict` otherwise. A task with
  live subtasks cannot be deleted (#391). A subtask cannot carry an `rrule`.
  Each op in a batch gets its own result; only a 400 or 413 refuses the batch
  as a whole.
- **A pull after an applied write gives the replica the row's `version`**
  (`flush` → `applyResponse`). A row created offline has no `version` until a
  sync reaches the server.
- **The CLI cannot set dates, make subtasks or edit a rule.** `cli list
  --json` prints whole rows, origin fields included. Playwright seeds dates
  through `page.request` ops, as W3 seeded views.
- **The web as built in W3:** the `view` topic carries `key`, `layout`,
  `sort`, `problem` and `items`; `client.ts` drops a `view` publish whose
  `key` differs from the watched one; `Draft` mints an `id` only for `add`,
  `saveView` and `saveStatus`; `ViewForm` offers `calendar` disabled ("comes
  later"); `ViewBody` prints `view.soon` for a calendar view; `useDrag` finds
  a gap between rows by the pointer's Y, which a day cell does not need;
  `templateOf` decides between the template radio and raw JSON.
- **`@todoer/specs` dates helpers are `isIsoDate` and `addDays`**, both
  UTC-safe. `localDate(now)` (client-core) is the local calendar date.
- **`packages/specs/vectors/filters.json`** holds evaluator cases and invalid
  filters; `filter.spec.ts` runs them.
- **Nuxt UI 4.11.3 ships** `Calendar` and `InputDate` (date pickers),
  `InputNumber`, `CheckboxGroup`, `FieldGroup`, `Tabs`, `Popover`,
  `DropdownMenu`, `Modal` and `Tree` (checked in
  `node_modules/@nuxt/ui/dist/runtime/components`). Nothing in it lays out
  tasks on a grid of days, and nothing drags.
- **The e2e budget:** the `account` fixture hands each test the worker's
  session through one refresh, which the server does not count. New tests
  cost no logins or registrations.

## Where this plan departs from the design docs and the brief

Task 10 records these in the views design ("Departures in the plan") and in
the client-shells design ("Departures in plan W4").

1. **The filter selects tasks, not placements.** It is evaluated once per
   task with the facts of its current occurrence, the same facts a list and
   a board use (V1 departure 5). A selected recurring task then shows every
   occurrence in the span, so a "Next 7 days" view in month mode shows a
   daily task beyond the seventh day. Filtering each occurrence by its own
   date would give the same view different members in different layouts.
2. **Which occurrences a calendar shows** (open question 1). An open
   occurrence shows from the current occurrence on; earlier open ones, which
   the list never shows either, do not. A `done` occurrence shows as closed
   while it was closed within the last 7 days, the board's window (W3
   departure 6). A skipped occurrence of a recurring task never shows: it is
   either moved, and its copy shows, or dropped. A one-off task closed within
   7 days shows as closed on its dates, as on the board. Closed placements
   cannot be moved.
3. **A recurring task's due placement is its own `dueOn`, once**, and
   dragging it sets `dueOn` (V1 departure 5). Only scheduled placements stand
   for occurrences.
4. **The copy has no `dueOn` and no `parentId`, and takes the original's
   `rank`.** Q13 lists the fields a copy carries, and `dueOn` is not among
   them. A copy of a subtask is a top-level task (open question 2): under a
   recurring parent a one-off copy would recur on the parent's axis (ADR
   0009). The copy is created **before** the skip in the batch, so a
   batch that stops halfway leaves a copy and no lost occurrence. If the
   original was deleted elsewhere, the server still applies the skip and the
   copy lives on, as the design says it does; Undo is what refuses later.
5. **Undo is refused in four cases:** the task is not a copy; the copy is not
   synced or has writes still queued, since a delete needs its exact
   `baseVersion` (W3's "not synced yet", open question 3); the copy has live
   subtasks (#391); or the original is gone, in which case the copy lives on.
   Undo reopens the occurrence only while it is still skipped, and does not
   check that the rule still produces it, so it works after the rule was
   edited.
6. **Undo is reachable later, from the copy's drawer** ("Return to series"),
   not only from the toast right after the move. A drag of a one-off placement
   gets an Undo too, which writes the old date back.
7. **The grid's week starts on Monday in both locales** (open question 4), the
   order of `WEEKDAYS` and of ISO weeks. A span is at most 42 days (six
   weeks), and the worker refuses a wider one. Week and month, and the
   anchor date, live in the URL (`?mode=month&at=2026-10-01`).
8. **The tree is the view form's editor; the templates fill it.** W3
   departure 9 opened a filter that is not exactly a template in raw-JSON
   mode. Every stored filter now opens in the tree. "Start from" replaces the
   tree with a template's filter, and raw JSON stays as a toggle. `templateOf`
   is deleted.
9. **`filterSize` joins `@todoer/specs`.** The editor shows `nodes/256` and
   `depth/8`, and disables "add" at either limit. Counting in the web would
   be a second count of what `filterProblem` refuses.

## Global Constraints

- **The CLI and the backend do not change.** `git diff main -- apps/cli
  apps/backend scripts/` is empty, and both shell e2e scripts pass. The
  OpenAPI document does not change.
- **`@todoer/specs` changes in `filter.ts` only** (`filterSize`), with no wire
  change. Client-core re-exports it next to `filterProblem`.
- **No new dependencies.** Date math goes through `addDays`, `isIsoDate` and
  UTC `Date` arithmetic. Never format a local `Date` with `toISOString`.
- **Workspace command:**
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test`,
  then `pnpm lint`. Each task ends with both green. Tasks 6, 7 and 9 also end
  with `pnpm --filter @todoer/web e2e` green.
- **Every requirement has a test that failed first.** Each task names the
  mutation that turns its tests red. Revert it after checking.
- **Commits:** Conventional Commits with a scope; the body says why; no
  `Co-Authored-By` trailer; `pnpm format` first. Branch `feat/web-calendar`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`. Candidates: `Web e2e`, `Image`.

## Review Focus

1. **Day boundaries and time zones.** Every date is a `YYYY-MM-DD` string
   from end to end (ADR 0010). Check that the grid math never builds a local
   `Date` and calls `toISOString` (in UTC+ zones that lands on the previous
   day), that a drop writes the cell's `data-date` string as is, that the
   today marker comes from the worker's `localDate(now())` in the `view`
   topic, and that a tab left open past midnight moves the marker on the next
   tick's publish. The closed window is measured in UTC (`fieldTs.state`), the
   same edge W3 departure 6 names (Tasks 2, 5, 6).
2. **Replay and partial batches of a move.** A worker that dies after
   committing `moveOccurrence` gets the same command again: check that
   `seen(opId)` comes before every validation (the occurrence is skipped by
   then, and would read as "already skipped"), that the copy's `id` is minted
   once in the tab and reused on resend (`Draft` must mint `id` for
   `moveOccurrence`), and that the copy is the batch's first op and the skip
   its last (departure 4) (Tasks 3, 4).
3. **Undo after the copy changed.** Check each refusal of departure 5: a copy
   with a pending create or a pending `set` is refused, so no stale
   `baseVersion` is sent from this device. A copy edited on another device and
   not yet pulled still sends a stale version: the delete comes back
   `conflict` while the reopen lands, so the original occurrence and the copy
   both show, and the badge counts one refused entry. The plan accepts this
   and documents it; check that nothing hides it. After the rule was edited
   (through the API, since no client edits rules), Undo still deletes the copy
   and writes `open` for a date the rule may no longer produce, which nothing
   reads (Task 3).
4. **The copy's fields.** `originOccurrence` is the occurrence that moved,
   never the target day. The copy has no `rrule`, `dtstart`, `dueOn` or
   `parentId`, and its tags are `create task_tag` with
   `taskTagId(copyId, tagId)` for each attached live tag. A copy of a subtask
   keeps the subtask's own `projectId`, which is what views already read for
   it. A copy of a copy is impossible, since a copy is a one-off (Task 3).
5. **Expansion cost of a month view.** Check that `calendarTasks` filters
   first and expands only the selected recurring tasks, only within the span
   (≤ 42 days, so ≤ 42 placements per task), that placements refer to items by
   id, and that the engine refuses a wider span rather than expanding it. The
   expander's walk from `dtstart` is the existing ceiling (its `ponytail:`
   note) (Tasks 2, 4).
6. **Filter round-trip.** Opening, viewing and saving a filter without
   touching it must write nothing: check that `saveView` sees an equal
   filter, that untouched subtrees keep their identity through every edit
   helper, that a leaf naming an id missing from the catalog shows it as
   unknown instead of replacing it, that new ids go in lower-case, and that
   `editable` (the shape) and `filterProblem` (the validity) are not confused:
   an incomplete leaf is editable and unsavable (Tasks 8, 9).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] `specs/tasks/active/T-2026-10-02-web-calendar.md` exists (FR-001…FR-013,
      steps T001–T010). Settle open questions 1–4 with the maintainer. Tasks
      1, 5 and 8 do not depend on the answers.
- [ ] Commit `docs(plans): plan the web calendar and the filter-tree editor
      (W4)` on `feat/web-calendar`. Body: W4 closes the deferral in
      client-shells Q8. The plan fixes which occurrences a calendar shows,
      what a moved occurrence's copy carries, and when Undo refuses, before
      any screen exists.

---

### Task 1: specs: `filterSize`

Implements FR-001 (T001). Departure 9.

**Files:**

- Modify: `packages/specs/src/filter.ts`, `filter.spec.ts`,
  `packages/client-core/src/index.ts` (re-export)

**Interfaces:**

```ts
/** How many nodes the tree has and how deep it goes, counted the way
 *  filterProblem counts them: every object is a node, the root is depth 1.
 *  Total for any input; a non-object counts as one node at its depth. */
export function filterSize(filter: unknown): { nodes: number; depth: number };
```

- [ ] **Step 1: Tests (red).**
  - `{ and: [] }` → `{ nodes: 1, depth: 1 }`; `{ not: { tag: id } }` →
    `{ nodes: 2, depth: 2 }`; every valid vector in `filters.json` has
    `nodes ≤ 256` and `depth ≤ 8`;
  - a chain of `not` 8 deep passes `filterProblem` and has `depth: 8`; 9 deep
    fails it and has `depth: 9`;
  - an `and` of 255 tags has `nodes: 256` and passes; 256 tags → `257` and
    `filterProblem` says "more than 256 nodes".
- [ ] **Step 2: Code.** A walk over `and`/`or` arrays and `not`, like
      `check` in `filterProblem`, without the validation.
- [ ] **Step 3: Mutation.** Count only leaves. The 255-tag case goes red.
      Revert.
- [ ] **Step 4: Commit.** `feat(specs): count a filter's nodes and depth`.
      Body: the filter editor shows the limits, and a count of its own would
      drift from what the server refuses.

---

### Task 2: client-core: `calendarTasks`

Implements FR-002 (T002). Departures 1, 2, 3.

**Files:**

- Modify: `packages/client-core/src/operations.ts`, `operations.spec.ts`

**Interfaces:**

```ts
/** A span of calendar days, both inclusive. */
export type Span = { from: string; to: string };
/** The widest span a calendar asks for: six weeks. */
export const MAX_SPAN_DAYS = 42;

/** One day a task stands on (views Q11). */
export type Placement = {
  taskId: string;
  date: string;
  kind: 'scheduled' | 'due';
  /** The occurrence a recurring task's scheduled placement stands for;
   *  null for a one-off task and for every due placement. */
  occurrence: string | null;
  /** Closed within `closedDays` (departure 2): shown, not movable. */
  closed: boolean;
};
export type Calendar = { items: Item[]; placements: Placement[] };

/**
 * The view's tasks placed on the days of `span`: the filter and sort of
 * boardTasks (departure 1), then each task's placements. Placements are
 * ordered by date, then by the view's order, then scheduled before due.
 * `items` holds only tasks with a placement in the span. Throws UsageError
 * for a span that is not two dates in order, or wider than MAX_SPAN_DAYS.
 */
export function calendarTasks(
  store: Store,
  today: string,
  view: ViewSpec,
  span: Span,
  closedDays = 7,
): Calendar;
```

  The items are `selected(store, today, view, addDays(today, -closedDays))`,
  W3's board read. For each item:

  - a one-off task: a `scheduled` placement on `scheduledOn` and a `due`
    placement on `dueOn`, each when in the span, `closed` as the item is;
  - a recurring task (its own rule or its parent's, `recurrenceOf`): for each
    date `expand` gives within the span, by its occurrence state: `skipped` →
    nothing; `done` → a closed placement while the mark's `fieldTs.state` (or
    now, if pending) is on or after `today − closedDays`; open → a placement
    when the date is on or after `item.occurrence`. Then a `due` placement on
    the task's `dueOn` when in the span.

- [ ] **Step 1: Tests (red),** over `openStore(':memory:')` with rows merged
      by `mergeChanges`, `today = '2026-10-07'` (a Wednesday):
  - a one-off with `scheduledOn` 10-08 and `dueOn` 10-10 → two placements,
    `scheduled` then `due`; with both on 10-08 → two placements on 10-08;
  - a daily task from 10-01 with nothing marked, span 10-05..10-11 → open
    placements 10-07..10-11, none before today (the current occurrence is
    10-07);
  - the same with 10-06 done (closed today) → a closed placement on 10-06;
    done with `fieldTs.state` 10-01 (inside 7 days) still shows, 09-29 (8
    days) does not;
  - 10-09 skipped → no placement on 10-09;
  - a recurring task with `dueOn` 10-10 → one `due` placement, `occurrence`
    null;
  - a subtask of a daily parent → placements on the parent's dates;
  - a one-off done today → closed placements on its dates; done 8 days ago →
    absent;
  - a `{ tag }` view selects tasks: an untagged daily task has no placements;
  - a `{ scheduled: { from: 0, to: 0 } }` view in a 6-week span still shows a
    daily task on every day from today on (departure 1);
  - `items` holds only tasks with placements, and placements reference them
    by `taskId`;
  - span `{ from: '2026-10-11', to: '2026-10-05' }`, a 43-day span, and
    `'2026-02-30'` each throw `UsageError`;
  - an invalid filter throws `RefusalError`, as `viewTasks` does.
- [ ] **Step 2: Code.** Keep the per-occurrence state lookup on `stateOf`.
      Read the closed time from the occurrence row's `fieldTs.state`, as
      `due()` does for one-offs.
- [ ] **Step 3: Mutations.** (a) Drop the `date >= item.occurrence` bound.
      The "none before today" case goes red. (b) Show skipped occurrences as
      closed. The 10-09 case goes red. (c) Expand from `dtstart` to `span.to`
      and filter afterwards, with no lower bound. Nothing goes red, which
      shows the bound is a cost, not a behaviour; restore it and keep a
      comment. (d) Drop the span-width check. The 43-day case goes red.
      Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): calendar placements for a view
      and a span`. Body: views Q11 puts a task on its scheduled and due days
      and a recurring task on each occurrence. The filter still selects tasks
      at their current occurrence, so a view has the same members in every
      layout, and closed placements follow the board's 7-day window.

**Checkpoint:** a calendar's content is a pure function of the store, the
view and the span.

---

### Task 3: client-core: `moveOccurrence` and `undoMove`

Implements FR-003, FR-004 (T003). Departures 4, 5.

**Files:**

- Modify: `packages/client-core/src/operations.ts`, `operations.spec.ts`

**Interfaces:**

```ts
/**
 * Moves one occurrence of a recurring task to `to` (views Q13): a one-off
 * copy with id `minted.id` on `to`, carrying title, notes, projectId, the
 * attached tags, priority, statusId and the original's rank, plus
 * originTaskId and originOccurrence; then `skip` of the occurrence. One
 * batch, the copy first (departure 4). Replay-safe.
 */
export async function moveOccurrence(
  core: Core,
  minted: Minted & { id: string },
  taskId: string,
  occurrence: string,
  to: string,
): Promise<{ synced: boolean }>;

/**
 * Undoes a move (views Q13): deletes the copy, then reopens its origin
 * occurrence if it is still skipped. One batch. Refuses (UsageError) a task
 * without origin fields, a copy with no `version` or with queued ops, a copy
 * with live subtasks, and a copy whose original is not live (departure 5).
 * Replay-safe.
 */
export async function undoMove(
  core: Core,
  minted: Minted,
  copyId: string,
): Promise<{ synced: boolean }>;
```

  `moveOccurrence`, after `replayed(core, minted.opId)`: the task is live
  and recurring (`recurrenceOf` not null), `to` is a date and differs from
  `occurrence`. `planMark(core, 'skip', task, all, occurrence, undefined)`
  validates the occurrence (it must be one the rule produces) and refuses one
  that is done. A `closed` result (already skipped) is refused too. The ops are the copy's
  `create` with `opId: minted.opId`, one `create task_tag` per attached live
  tag (`labelsOf`'s ids, `taskTagId(minted.id, tagId)`), then `plan.op` with
  a worker-minted op id. Null fields (`notes`, `projectId`, `statusId`) are
  left out of `fields`.

  `undoMove`, after `replayed`: the copy is live and has both origin fields;
  it has a numeric `version` and no op in `store.pending()` names it; no live
  task has `parentId` equal to it; `liveTask(all, originTaskId)` exists. The
  ops are `delete` (`baseVersion: copy.version`, `opId: minted.opId`) and,
  when `stateOf(marks, originTaskId)(originOccurrence) === 'skipped'`, a
  `create task_occurrence` with `state: 'open'`, `completedAt: null` and the
  derived id. It writes no `statusId`, as `undo` after `skip` writes none.

- [ ] **Step 1: Tests (red),** with W3's fake transport:
  - a daily task with tags `@a @b`, project, notes, priority 3, status Doing
    and `dueOn`: `moveOccurrence(10-08 → 10-10)` queues, in order, the copy's
    create (id = `minted.id`, `opId` = `minted.opId`, `scheduledOn` 10-10,
    `originOccurrence` 10-08, the original's `rank`, no `rrule`, `dtstart`,
    `dueOn` or `parentId`), two `task_tag` creates, then the `skipped`
    occurrence; `calendarTasks` then shows the copy on 10-10 and nothing on
    10-08;
  - a subtask of a daily parent: the copy has no `parentId`, the skip names
    the subtask and the parent's date;
  - refusals: a one-off task, `to === occurrence`, a date the rule does not
    produce, `to: '2026-02-30'`, a done occurrence ("undo it first"), an
    already skipped one;
  - offline (the transport rejects): `synced: false`, ops queued, and
    `calendarTasks` already shows the copy;
  - replay: the same `minted` again after the first run was applied and
    settled → nothing queued, one copy, and no "already skipped";
  - `undoMove` on a synced copy: `delete` with its `version`, then `open` for
    the origin occurrence; the calendar shows the occurrence again;
  - `undoMove` when the occurrence was reopened meanwhile → the `delete`
    only;
  - `undoMove` after the original's rule changed so that the occurrence is no
    longer produced → still `delete` plus `open`, no refusal;
  - refusals: a task without origin fields; a copy still pending its create
    ("not synced yet"); a synced copy with a queued `set title`; a copy with a
    live subtask; a copy whose original is deleted;
  - replay of `undoMove` after it applied → `ok`, nothing queued, no "no
    task".
- [ ] **Step 2: Code.** Reuse `planMark`, `withFirstId`-style id placement,
      `syncedRow`'s version rule and `submitOwn`.
- [ ] **Step 3: Mutations.** (a) Put the skip first. The order assertion goes
      red. (b) Copy `dueOn`. The fields assertion goes red. (c) Keep
      `parentId`. The subtask case goes red (the copy recurs, and
      `calendarTasks` places it daily). (d) Check `seen` after `planMark`. The
      replay case goes red with "already skipped". (e) Drop the pending-ops
      check. The queued `set title` case goes red. (f) Reopen without checking
      the state. The "reopened meanwhile" case goes red. Revert all.
- [ ] **Step 4: Commit.** `feat(client-core): move one occurrence and undo
      the move`. Body: views Q13. The copy goes first, so a refused skip never
      loses an occurrence. Undo refuses what it cannot do exactly (an
      unsynced copy, a copy with subtasks, a gone original) instead of
      guessing a `baseVersion`.

**Checkpoint:** client-core holds every W4 operation with Node tests, and the
CLI is unchanged (`git diff main -- apps/cli` is empty).

---

### Task 4: The engine: span watches, placements and the move commands

Implements FR-005, FR-006 (T004).

**Files:**

- Modify: `apps/web/app/db/protocol.ts`, `engine.ts`, `engine.spec.ts`,
  `client.ts`, `client.spec.ts`, `apps/web/app/composables/useDb.ts`
  (`useWatch`)

**Interfaces:**

```ts
// protocol.ts
export type Write =
  | /* W3's nine */ ...
  | { kind: 'moveOccurrence'; opId: string; id: string; taskId: string; occurrence: string; to: string }
  | { kind: 'undoMove'; opId: string; taskId: string }; // taskId: the copy

export type Command =
  | ...
  /** `span`: the days a calendar shows; null for other layouts. */
  | { kind: 'watch'; view: string | null; task: string | null; span?: Span | null }
  | Write;

export type Topics = {
  ...
  view: {
    key: string;
    layout: string;
    sort: string;
    problem: string | null;
    /** The worker's local date: the calendar's today marker. */
    today: string;
    /** The span this publish answers; null for list and kanban. */
    span: Span | null;
    items: Item[];
    /** Calendar layout only; [] otherwise. */
    placements: Placement[];
  };
};

// client.ts
export type Draft<W = Write> = W extends {
  kind: 'add' | 'saveView' | 'saveStatus' | 'moveOccurrence';
} ? Omit<W, 'opId' | 'id'> & { id?: string } : ...;
watch(view: string | null, task: string | null, span?: Span | null): void;

// useDb.ts
export function useWatch(view: () => string, span?: () => Span | null): void;
```

  Engine:

  - `Watch` gains `span`. `publishKeys` takes `{ key, span }` pairs and
    dedupes them by `key` plus span, so two tabs on one calendar view with
    different spans each get theirs.
  - `publishView`: `today` always. A calendar view with a span publishes
    `calendarTasks(store, today, spec, span)`. One without a span publishes no
    items and no placements (the tab sends its span with the next `watch`).
    `calendarTasks`' `UsageError` for a bad span becomes `problem: 'span'`.
    List and kanban views keep `viewTasks` and `boardTasks`, with
    `span: null, placements: []`.
  - `apply`: `moveOccurrence` → `moveOccurrence(core, { opId, id: w.id },
    w.taskId, w.occurrence, w.to)`; `undoMove` → `undoMove(core, { opId },
    w.taskId)`. Neither returns a note: the tab already knows the dates and
    the copy's id.

  Client:

  - A `view` publish is kept when its `key` matches and its `span` equals the
    watched one (both null for list and kanban). `watch` resets `topics.view`
    when the span changes, so the grid never draws another span's data.
  - `ready` resends the last `watch`, span included, before the pending
    writes.

- [ ] **Step 1: Tests (red)** in `engine.spec.ts`, over the in-memory WASM
      store and the fake transport:
  - a calendar view watched with a span publishes `placements` and `today`;
    a second tab on the same view with another span gets its own publish, and
    both are published after a write;
  - the same view watched without a span publishes `items: []`;
  - a 43-day span → `problem: 'span'`, no items;
  - `moveOccurrence` shows the copy in the watched calendar **while the
    transport is still pending**;
  - crash replay: engine 1 handles `moveOccurrence` (applied, settled);
    engine 2 over the same store handles the identical command → one copy in
    `calendarTasks`, and the transport saw no second create;
  - `undoMove` on a copy created offline → `{ ok: false, failure.kind:
    'invalid' }`;
  - a write while signed out → `signed-out`;
  - list and kanban publishes carry `span: null, placements: []`.
  - `client.spec.ts`: a publish for the watched key with another span leaves
    `topics.view` unchanged; on `ready` the last `watch` is re-sent with its
    span; `mint` of a `moveOccurrence` draft fills `id` once, and a resend
    reuses it.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Dedupe watches by key only. The two-spans
      test goes red. (b) In `client.ts`, ignore `span` when keeping a publish.
      The client test goes red. (c) Leave `moveOccurrence` out of `Draft`'s
      create kinds. The mint test goes red (no `id`). Revert all.
- [ ] **Step 4: Commit.** `feat(web): calendar spans and occurrence moves in
      the worker`. Body: a calendar asks for the days it shows, and the worker
      expands recurrences for that span only. A move carries the copy's id
      from the tab, so a resend after a crash creates no second copy.

**Checkpoint:** every calendar read and write exists behind the protocol,
proven in Vitest without a browser.

---

### Task 5: The grid's date math and the placement writes

Implements FR-007, FR-008 (T005). Departures 6, 7.

**Files:**

- Create: `apps/web/app/utils/calendar.ts`, `calendar.spec.ts`

**Interfaces:**

```ts
export type Mode = 'week' | 'month';

/** 0 = Monday … 6 = Sunday (departure 7). UTC: a date has no zone. */
export function weekday(date: string): number;
/** The days a grid shows: Monday to Sunday of `at`'s week, or every week
 *  that holds a day of `at`'s month (28 to 42 days). */
export function gridSpan(mode: Mode, at: string): Span;
/** Every date of a span, in order. */
export function days(span: Span): string[];
/** `at` moved by `n` weeks or months; a month move lands on the 1st. */
export function shift(mode: Mode, at: string, n: number): string;
/** The `?mode=&at=` query read back; anything invalid falls back to
 *  week mode at `today`. */
export function fromQuery(query: Record<string, unknown>, today: string): { mode: Mode; at: string };

/** The write a placement dropped on `to` sends, and the write that undoes
 *  it (departure 6). A recurring scheduled placement moves its occurrence;
 *  any other sets its own date. null when `to` is the placement's day. */
export function placeWrite(
  p: Placement,
  task: Item,
  to: string,
): { write: Draft; undo: (minted: Write) => Draft } | null;
```

  `placeWrite`: `p.occurrence !== null` → `{ kind: 'moveOccurrence',
  taskId, occurrence, to }`, undone by `{ kind: 'undoMove', taskId:
  minted.id }`; otherwise `{ kind: 'edit', taskId, changes: { [p.kind ===
  'due' ? 'dueOn' : 'scheduledOn']: to } }`, undone by the same edit with
  `p.date`.

- [ ] **Step 1: Tests (red).**
  - `weekday('2026-10-05') === 0`, `('2026-10-11') === 6`;
  - `gridSpan('week', '2026-10-07')` → 10-05..10-11;
    `gridSpan('month', '2027-02-10')` (February 2027 starts on a Monday
    and has 28 days) → exactly 28 days; August 2026 (starts Saturday, 31 days) → 42
    days; no span exceeds `MAX_SPAN_DAYS`;
  - `shift('month', '2026-01-31', 1) === '2026-02-01'`;
    `shift('week', '2026-12-28', 1) === '2027-01-04'`;
  - the same results with `process.env.TZ` set to `Pacific/Kiritimati` and to
    `America/Adak` before each call;
  - `fromQuery({ mode: 'year', at: '2026-02-30' }, today)` → week at today;
  - `placeWrite`: a recurring scheduled placement → `moveOccurrence`, undone
    by `undoMove` with the minted copy id; a recurring due placement →
    `edit dueOn`; a one-off scheduled → `edit scheduledOn`, undone with the old
    date; a drop on the same day → null.
- [ ] **Step 2: Code.** Build every date with `addDays` or
      `Date.UTC(...)` read back with `toISOString().slice(0, 10)`.
- [ ] **Step 3: Mutations.** (a) Compute `weekday` with `getDay()` on a local
      `new Date(y, m, d)`. The Kiritimati and Adak runs go red. (b) Route
      every placement through `edit`. The recurring case goes red. Revert both.
- [ ] **Step 4: Commit.** `feat(web): calendar grid dates and placement
      writes`. Body: a calendar date has no time zone (ADR 0010), so the grid
      is computed in UTC and never from a local midnight. What a drop writes
      is a pure function, testable without a browser.

---

### Task 6: The calendar layout: grid, navigation, placements

Implements FR-007 (T006). Departures 2, 7.

**Files:**

- Create: `app/components/CalendarView.vue` (header and grid),
  `app/components/CalendarDay.vue` (one cell), `app/components/PlacementChip.vue`
- Modify: `app/components/ViewBody.vue` (calendar branch, `view.soon`
  removed), `app/pages/views/[id].vue` (`useWatch` with the span),
  `app/components/ViewNav.vue` (calendar icon),
  `app/components/ViewForm.vue` (`calendar` enabled, "comes later"
  removed), `apps/web/e2e/fixtures.ts` (`seedTask`), locales

  - The span comes from the URL alone: `[id].vue` reads `fromQuery` and the
    catalog's layout, and passes `gridSpan(mode, at)` to `useWatch` for a
    calendar view. `CalendarView` reads the same query, so a reload or the
    back button restores the grid.
  - Header: Previous and Next (`UButton`, `aria-label`s, `shift`), Today
    (sets `at` to `view.today`), a week/month `UTabs`, and the title through
    `Intl.DateTimeFormat(locale, { timeZone: 'UTC' })` on `Date.UTC`, such as
    "October 2026" or "5–11 Oct 2026".
  - Grid: weekday names from `Intl.DateTimeFormat(locale, { weekday: 'short',
    timeZone: 'UTC' })`. Each cell is `CalendarDay`, a
    `role="region"` with an `aria-label` of the long date and `data-date`. The
    week view is `grid-cols-1 sm:grid-cols-7`, so a phone gets a column of
    days. The month view keeps seven columns, shows at most three chips per
    cell, and a "+N" button switches to week mode at that day. Days outside
    the month are muted. The cell whose date equals `view.today` gets the
    today marker (`aria-current="date"` and a primary ring).
  - `PlacementChip` (a `UButton`-styled element with `data-testid="placement"`,
    `data-kind`, `data-task-id`): the title, an icon for the kind (scheduled
    `i-lucide-calendar`, due `i-lucide-flag`), a repeat icon for an
    occurrence, the priority badge. A closed placement is struck through and
    muted, with a check icon. Enter or a click opens the drawer (`?task=`).
  - While `view.span` differs from the watched span, the grid shows a
    skeleton, not stale chips.
  - `seedTask(request, token, fields)` creates a task through one `create
    task` op and returns its id, so a test can set `scheduledOn` and `dueOn`,
    which the CLI cannot.

- [ ] **Step 1: e2e (red).** `e2e/calendar.spec.ts`, "calendar: placements,
      navigation", with `account`:
  - seed a calendar view (`seedView(..., 'calendar')`), a one-off "Report"
    with `scheduledOn` = next Tuesday and `dueOn` = next Thursday
    (`seedTask`), and `cli add "Water plants" --rrule FREQ=DAILY --from
    <today>`;
  - open the view: week mode, today's cell has `aria-current="date"`; Next →
    Report shows on Tuesday (`data-kind="scheduled"`) and on Thursday
    (`data-kind="due"`), Water plants on all seven days; reload → still next
    week;
  - month mode → next Tuesday's cell holds Report; Today → back to the
    current week;
  - `cli done <Water plants>` → today's chip is struck through, tomorrow's is
    open.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Drop `aria-current` from the today cell. The
      marker assertion goes red. (b) Drop the closed styling. The struck-through assertion goes red.
      Revert both.
- [ ] **Step 4: Commit.** `feat(web): the calendar layout`. Body: client-shells
      Q8 deferred the calendar to this plan. The grid shows what the worker
      places for the span the URL names, so a reload, the back button and two
      tabs all agree.

---

### Task 7: Calendar moves: drag, "Move to date…", Undo

Implements FR-008, FR-009 (T007). Departures 4, 5, 6.

**Files:**

- Create: `app/components/MoveDateDialog.vue`
- Modify: `app/composables/useDrag.ts` (`useDayDrag`),
  `app/components/CalendarView.vue`, `CalendarDay.vue`, `PlacementChip.vue`,
  `app/components/TaskDrawer.vue` ("Return to series"),
  `apps/web/e2e/calendar.spec.ts`, `apps/web/e2e/offline.spec.ts`, locales

**Interfaces:**

```ts
/** Drag a placement onto a day cell. The payload type is
 *  `application/x-todoer-placement`; the tab remembers its own drag, as
 *  useDrag does, because dragover cannot read the data. */
export function useDayDrag(drop: (p: Placement, to: string) => void): {
  over: Ref<string | null>; // the date under the pointer, for the highlight
  chipEvents: (p: Placement) => Record<string, unknown>;
  dayEvents: (date: string) => Record<string, unknown>;
};
```

  - A closed placement is not draggable and has no "Move to date…".
  - A drop calls `placeWrite`, mints the write once (`db.mint`), sends it,
    and on `ok` shows a toast: "Moved to 9 Oct", or for an occurrence "8 Oct
    moved to 10 Oct", with Undo. Undo sends `placeWrite(...).undo(minted)`
    with a fresh `opId`. A refusal shows the `invalid` message with the core's
    detail ("not synced yet" for an offline copy).
  - The chip's menu (`UDropdownMenu`, `aria-label` "Placement actions"): Open,
    and "Move to date…", which opens `MoveDateDialog`: a `UModal` with
    `UInput type="date"` set to the placement's day and a Move button. Enter
    submits. It sends the same `placeWrite`, so keyboard, touch and drag share
    one path.
  - `TaskDrawer`: a task with `originTaskId` shows "Moved from <date>" and a
    "Return to series" button that sends `undoMove`. On `ok` the drawer
    closes, since the task is deleted. A refusal stays in the drawer with
    its reason.

- [ ] **Step 1: e2e (red).** In `calendar.spec.ts`, "calendar: moves and
      undo", over the same seed:
  - drag Report's scheduled chip from Tuesday to Wednesday → after a reload
    it is on Wednesday, and `cli list --json` shows that `scheduledOn`;
  - drag Report's due chip from Thursday to Friday → `dueOn` is Friday; the
    toast's Undo → back on Thursday;
  - drag Water plants from Monday to Saturday → Monday has no Water plants,
    Saturday has two; `cli list --json` holds a "Water plants" with
    `originOccurrence` = Monday, `scheduledOn` = Saturday, `rrule` null; the
    toast's Undo → Monday is back, Saturday has one, and `cli list` shows one
    Water plants;
  - keyboard: focus Tuesday's Water plants chip, open its menu, "Move to
    date…", type Wednesday, Enter → Tuesday is empty and Wednesday has two;
    open the copy, "Return to series" → Tuesday is back and the drawer is
    closed.
- [ ] **Step 2: e2e (red), offline.** In `offline.spec.ts`: offline, drag a
      Water plants occurrence → the copy shows at once and survives a reload;
      the toast's Undo → the `invalid` message "not synced yet"; online →
      pending 0, and `cli list --json` shows the copy. The W2 Firefox skip
      stays for the `online` event only.
- [ ] **Step 3: Code.**
- [ ] **Step 4: Mutations.** (a) Send `edit scheduledOn` for an occurrence
      drop. The "Monday has no Water plants" assertion goes red. (b) Make
      Undo re-mint the copy id instead of using the minted one. The Undo
      assertion goes red (no task with that id). (c) Hide "Move to date…".
      The keyboard step goes red. Revert all.
- [ ] **Step 5: Commit.** `feat(web): move calendar placements and undo
      occurrence moves`. Body: views Q13 through every input: drag, a
      keyboard dialog and touch. Undo also lives in the copy's drawer, because
      the toast is gone by the time a person changes their mind.

**Checkpoint:** the calendar is complete and proven in Chromium and Firefox
under the CSP.

---

### Task 8: The filter tree's edit helpers

Implements FR-010 (T008). Departures 8, 9.

**Files:**

- Create: `apps/web/app/utils/filterTree.ts`, `filterTree.spec.ts`
- Modify: `apps/web/app/utils/templates.ts`, `templates.spec.ts`
  (`templateOf` deleted)

**Interfaces:**

```ts
/** Child indexes from the root; a `not` has one child, at 0. */
export type Path = readonly number[];
export type LeafKind = 'tag' | 'project' | 'status' | 'priority' | 'scheduled' | 'due' | 'recurring';

/** Whether the tree can be drawn: every node one known key with the right
 *  container (arrays under and/or, an object under not). Leaf values may
 *  be invalid; filterProblem says so. Bounded at depth 9 and 257 nodes. */
export function editable(filter: unknown): filter is Filter;
export function children(node: Filter): Filter[];
export function at(root: Filter, path: Path): Filter;
/** A new tree with `node` at `path`; every untouched subtree is the same object. */
export function replace(root: Filter, path: Path, node: Filter): Filter;
/** Removes the node from its group; inside a `not` removes the `not`; the
 *  root becomes { and: [] }. */
export function remove(root: Filter, path: Path): Filter;
export function append(root: Filter, group: Path, node: Filter): Filter;
/** Wraps the node in a `not`, or unwraps a `not`. */
export function toggleNot(root: Filter, path: Path): Filter;
/** and ↔ or, keeping the children. */
export function setGroup(root: Filter, path: Path, op: 'and' | 'or'): Filter;
/** A new leaf or group: tag and status take the first catalog id in
 *  lower-case, or '' (which filterProblem refuses); project null;
 *  priority [4]; ranges {}; recurring true. */
export function blank(kind: LeafKind | 'and' | 'or', catalog: Catalog): Filter;
/** Whether a child can be added to the group at `path` without passing the
 *  limits (filterSize). */
export function canAdd(root: Filter, path: Path): boolean;
```

- [ ] **Step 1: Tests (red).**
  - every template's `filterOf` and every valid filter in `filters.json` is
    `editable`; `replace(f, [], f)` returns `f`; `at` of every path that
    `children` reaches returns the node there;
  - `replace` deep in an `or` keeps every other child `===` to the old one;
  - `remove` of the only child of a `not` removes the `not`; of the root →
    `{ and: [] }`;
  - `toggleNot` twice returns an equal tree;
  - `setGroup` keeps the children's identity;
  - `blank('tag', catalog)` is lower-case even when the catalog id is not;
    with no tags it is `{ tag: '' }`, which is `editable` and has a
    `filterProblem`;
  - `canAdd` is false at depth 8 and at 256 nodes, true one below each;
  - `editable` is false for `{ "tag": "x", "and": [] }`, `{ "and": {} }`,
    `{ "foo": 1 }` and a 10-deep `not` chain;
  - `templates.spec.ts`: `filterOf` of each template passes `filterProblem`
    (the `templateOf` cases go with it).
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Rebuild every child in `replace`
      (`map(clone)`). The identity case goes red. (b) Skip the lower-casing
      in `blank`. The lower-case case goes red. (c) Allow depth 9 in
      `canAdd`. The limit case goes red. Revert all.
- [ ] **Step 4: Commit.** `feat(web): edit helpers for the filter tree`.
      Body: the editor edits the filter JSON itself by path, so whatever the
      templates or raw JSON wrote comes back unchanged unless the person
      changes it.

---

### Task 9: The filter-tree editor in the view form

Implements FR-011 (T009). Departure 8.

**Files:**

- Create: `app/components/FilterTree.vue` (the root, the limits line, the
  problem), `app/components/FilterNode.vue` (recursive: a group or a leaf)
- Modify: `app/components/ViewForm.vue`, `apps/web/e2e/views.spec.ts`,
  locales

  - `FilterTree` holds the filter as `v-model` and provides `edit(fn: (root)
    => Filter)` to its nodes, which call the Task 8 helpers with their path.
    Index keys are safe because the nodes keep no state of their own.
  - A group row: a `USelect` "All of" / "Any of" (`setGroup`), a "Not" switch
    (`toggleNot`), an "Add" `UDropdownMenu` with the seven leaf kinds and
    "Group" (`append(blank(...))`, disabled when `!canAdd`), and Remove. The
    children sit indented under a left border.
  - Leaf editors: tag, project (with "No project" for `null`) and status as
    `USelect` over the catalog; an id missing from the catalog is kept as an
    option labelled "Unknown (deleted?)", never replaced. Priority is a
    `UCheckboxGroup` p0–p4, written sorted when the person toggles it.
    `scheduled` and `due` take two bounds, each "none", "days from today"
    (`UInputNumber`, with the hint "0 = today, −1 = yesterday") or "date"
    (`UInput type="date"`). Recurring is a yes/no `USelect`. Each leaf has a
    "Not" switch and Remove.
  - Under the tree: "N/256 conditions · depth D/8" (`filterSize`), and the
    `filterProblem` text in an alert (`role="alert"`,
    `data-testid="filter-problem"`, as W3).
  - `ViewForm`: the template radio becomes "Start from" (`UDropdownMenu`):
    Today, Overdue and Next 7 days replace the tree with `filterOf`; Project…,
    Tag… and Status… replace it with a leaf holding the catalog's first id.
    The tree is the default mode for every view. The raw-JSON toggle stays,
    and leaves raw mode only when the text parses and is `editable`. Save
    stays disabled while there is a problem. `calendar` is a layout like the
    others (Task 6).

- [ ] **Step 1: e2e (red).** In `views.spec.ts`, "view form: filter tree",
      with `account` and `cli add "Buy milk #home @errand"`:
  - New view → Start from "Next 7 days" → the tree shows "Any of" with two
    date leaves; Add → Group; set it to "All of", add a tag leaf `@errand`,
    switch its Not on; the limits line reads `6/256` and depth `4/8`;
  - Raw JSON shows `{"or":[…,{"and":[{"not":{"tag":"<id>"}}]}]}` with the
    errand tag's lower-case id; back to the tree;
  - add a Due leaf and set its "from" bound to an empty date → the problem
    shows and Save is disabled; Remove the leaf → Save is enabled;
  - layout Calendar, Save → the sidebar shows the view with the calendar
    icon, and `cli views` lists it;
  - Edit → the same tree; Save without changes → no new op (the sync badge
    shows nothing pending), and the raw JSON equals what was saved;
  - a view seeded with `{ "tag": "<a random lower-case uuid>" }`: Edit shows
    the leaf as "Unknown", and Save without changes queues nothing.
  - The W3 raw-JSON case (`{"tag":"Work"}` → problem, Save disabled) stays.
- [ ] **Step 2: Code.**
- [ ] **Step 3: Mutations.** (a) Fall back to the catalog's first id when
      a leaf's id is unknown. The seeded-unknown step goes red (the save
      queues a `set filter`). (b) Leave Save enabled on a problem. The Due
      leaf step goes red. Revert both.
- [ ] **Step 4: Commit.** `feat(web): a filter-tree editor in the view
      form`. Body: views Q6 left GUI clients a tree editor. The templates
      stay as quick starts, raw JSON stays for pasting, and `filterProblem`
      checks all three the way the server will.

**Checkpoint:** every filter the server accepts can be built, viewed and
changed without typing JSON.

---

### Task 10: Docs, departures and the full proof

Implements FR-012, FR-013 (T010).

**Files:** `README.md`, `docs/specs/2026-10-01-views-design.md`,
`docs/specs/2026-10-01-client-shells-design.md`,
`specs/tasks/active/T-2026-10-02-web-calendar.md`

- [ ] **Step 1: README, "Using the web client".** Views: the layouts are list,
      kanban and calendar; the form's filter is a tree with "Start from"
      templates and raw JSON; drop "Calendar and a filter-tree editor are not
      built". A new **Calendar** item: week and month, a task on its scheduled
      and due days, a recurring task on each occurrence from the current one
      on, closed placements for 7 days, drag or "Move to date…" (the touch
      path), moving an occurrence makes a linked copy, Undo from the toast or
      the copy's drawer, and Undo needs the copy synced. Task drawer: "Return
      to series".
- [ ] **Step 2: Views design.** Under "Departures in the plan", a "Plan W4"
      list with departures 1–6 and 8–9, each with its decision (Q11, Q13, Q6).
- [ ] **Step 3: Client-shells design.** "Deferred": drop the calendar and
      filter-editor item (shipped in W4). Q8's routine choice gains "Shipped
      in plan W4". W3 departure 9 gains "Replaced in W4 (departure 8): the
      tree is the editor". W3 departure 10's "belongs with the calendar's
      'move an occurrence' (deferred)" becomes: moving one occurrence is the
      calendar's (W4); editing `dtstart` or `rrule` is still not built. Append
      "## Departures in plan W4" with departure 7 and pointers to the views
      design for the rest, plus "Behaviour worth knowing in W4": the
      stale-version conflict of Review Focus 3, and that dragging a copy back
      to its original day leaves it a copy.
- [ ] **Step 4: Stale-claim sweep.**

```sh
rg -n "not built|comes later|filter-tree editor|Calendar layout and|templateOf|raw-JSON mode|view\.soon" \
  README.md docs/specs docs/adr .claude apps/web/app apps/web/i18n
```

  Every hit is updated or is a historical record (plans, earlier
  departures).

- [ ] **Step 5: Full proof.** The workspace command, `pnpm lint`, both shell
      e2e scripts, the Playwright suite in both projects with the auth budget
      read from the backend log (no more logins than W3's run), and `git diff
      main -- apps/cli apps/backend scripts/` empty.
- [ ] **Step 6: Commit.** `docs: the web calendar, the filter tree and plan
      W4's departures`. Tick T010, move the task spec to `done/`, add the
      dnote changelog line, close tuxedo #413, and add tuxedo items for the
      work below that has none.

---

## What this plan does not do

- **No rule editing.** `dtstart` and `rrule` need `baseVersion` (W3
  departure 10). Moving one occurrence is the calendar's only recurrence
  write.
- **No drag of a whole series.** Dragging an occurrence moves that occurrence.
- **No per-occurrence filtering** (departure 1).
- **No day or agenda view, and no time of day.** Dates have no times (ADR
  0010).
- **No offline Undo of an unsynced copy** (departure 5, open question 3).
- **No moving a parent's subtasks along with it.** A copy has no subtasks;
  the subtasks stay with the series.
- **No arrow-key navigation between days.** Every chip is reachable with Tab,
  and every move with "Move to date…".
- **No caching of placements.** Every publish recomputes, as in W3. Memoise
  per (view, span) on the store's change counter if a profile shows it.

## Open questions

1. **Which closed placements show** (departure 2). Default: `done`
   occurrences and closed one-offs for 7 days by `fieldTs.state` (the board's
   window), skipped occurrences of a recurring task never, missed open
   occurrences before the current one never. Alternatives: every `done`
   occurrence in the span, whenever it closed; or no closed placements.
2. **Moving an occurrence of a subtask** (departure 4). Default: allowed, and
   the copy is a top-level one-off task. Alternative: refuse it ("move the
   parent's occurrence"), since a copy outside the parent leaves its
   checklist.
3. **Undo of a copy that is not synced yet** (departure 5). Default: refused
   with "not synced yet", as W3 refuses deleting an unsynced status or view.
   Alternative: drop the copy's still-unsent ops from the outbox, which needs
   a guarantee that no flush has them in flight.
4. **Week start** (departure 7). Default: Monday in both locales.
   Alternative: by locale (Sunday for English), with `Intl.Locale` week info
   where the browser has it and Monday elsewhere.
