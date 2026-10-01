# Sub-project 2: views — list, kanban, calendar

The domain design leaves "configurable views (list, kanban, calendar)" to this
sub-project. This document settles them. A **view** is synced data: a row in a
new `view` table holding a name, a layout, a filter and a sort key, so a view
built on one device exists on all of them. The **filter** is a JSON boolean
expression tree (`and`/`or`/`not` over predicates on tags, project, status,
priority and dates), referencing rows by id and dates by offsets from today,
evaluated by one shared evaluator in `@todoer/specs`. Kanban columns are a new
task field, **status**, whose values are a user-defined, ordered, synced table;
one status is marked **completing**, and moving a task into it is `done`.
Completion itself still lives in task occurrences (plan C), which win when the
two disagree. The calendar places a task on its scheduled day and again on its
due day; moving one occurrence of a recurring task skips it and creates a
linked one-off copy. Implementation ships as two plans, server and contract
first, then the CLI; the visual layouts belong to the client shells
(sub-project 3).

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **view** | A named, synced way of looking at tasks: a filter, a layout and a sort key. | screen, page, perspective |
| **filter** | The boolean expression that picks a view's tasks. | query, search |
| **layout** | How a view arranges its tasks: `list`, `kanban` or `calendar`. | mode, display |
| **status** | A task field naming where the task is in the user's workflow (a kanban column); a reference to a row of the user's status table. Not completion. | state, stage |
| **completing status** | The one status per user marked as completing: moving a task into it is `done`, moving it out is `undo`. | done column, final column |
| **predicate** | A leaf of the filter tree: one condition on one task property. | clause, rule |
| **moved occurrence** | An occurrence of a recurring task moved to another day: the original day is skipped and a linked one-off copy takes its place. | rescheduled instance |

## Why

A todo app's views are its navigation: "Work @office this week", a board of
what is in progress, the calendar of what is due. Defining them once and having
them everywhere is the same promise offline-first sync makes for tasks, and the
sync contract is cheapest to grow now, before three clients cache it (the
domain design's argument for adding columns early).

## Locked decisions

### Views are synced rows (Q1)

**Decision.** A new synced table `view`: `name`, `layout`
(`list` | `kanban` | `calendar`), `filter` (the expression tree below), `sort`
(next decision), `rank` (the order of views in navigation), plus the four
protocol columns. A view made on any client appears on every client.

**Rejected.** *Client-local presets* — every device is configured by hand;
*built-in views only* — no user-defined navigation.

**Cost.** One more table in every replica, and the filter must be portable — a
form every client evaluates identically.

### Tasks get a status; statuses are the user's own table (Q2, Q4)

**Decision.** `task.statusId` references a new synced table `status`: `name`,
`rank` (column order), `color`, `completing` (boolean). Kanban columns are the
user's statuses in `rank` order; dragging a card between columns sets
`statusId`. Names follow the tag rules of #362 (compared by `nameKey`).

**Rejected.**

- *Grouping by existing fields* (project, priority, tags) — recommended, but the
  maintainer chose an explicit workflow field.
- *A fixed status enum in the contract* — the first custom column ("Review")
  would need a protocol change.
- *A free string* — a typo becomes a new column, and clients drift.
- *Columns as listed tags* — a preset of grouping, not a workflow.

**Cost.** Two notions of progress (status and completion) that must be kept
consistent (next decisions), another synced table, and references to deleted
statuses to handle.

### One completing status; moving into it is `done` (Q5)

**Decision.** Exactly one status per user has `completing: true`. Moving a task
into it writes the `done` task occurrence for its current occurrence (plan C's
rules: the current occurrence, or the occurrence the client names); moving it
out writes `undo`.

**Rejected.**

- *Status without "done", with a derived Done column* — recommended, but the
  maintainer chose an explicit completing status.
- *Status and completion unrelated* — a done task could sit in "Doing".

**Cost.** The two must agree; the next decision says who wins when they don't.

### When status and occurrence disagree, the occurrence wins (Q7)

**Decision.** A board shows a task in the completing column only if its current
occurrence is closed (`done`/`skipped`); otherwise it shows the task in its
`statusId` column, or in the first status if that one is the completing status.
`done` and `undo` from any client — including the CLI — also set `statusId`:
`done` to the completing status, `undo` to the first status.

- Occurrences already understand recurrence: after `done`, the next, open
  occurrence becomes current and the task returns to the board by itself.
- Writing both on `done`/`undo` keeps them aligned almost always; the display
  rule makes the rest deterministic on every client.

**Rejected.** *Status wins* — a recurring task done yesterday would stay in
Done forever; *clients repair disagreements on sync* — a write per sync and
races between devices.

**Cost.** For a recurring task, `statusId` = completing is a hint, not the
truth.

### Deleting a status moves its tasks (Q8)

**Decision.** The client that deletes a status moves the tasks that reference
it to the first status in the same batch (`set statusId`). Tasks that still
arrive pointing at a deleted status (written offline) are displayed in the
first status.

**Rejected.** *Display-only fallback* — the server keeps dangling references;
*the server refuses to delete a status with live tasks* — unexplained refusals,
and offline deletes would fail later.

**Cost.** Deleting a column with many tasks queues one operation per task.

### New tasks default to the first status; clients seed three statuses (Q9)

**Decision.** `statusId` null means "the first status by rank"; creating a task
writes no status. A client that finds no statuses for the user creates three:
`Inbox`, `Doing`, `Done` (completing). Quick-add has no status marker.

**Cost.** Two clients first started offline seed two sets; the duplicate-name
merge of #362 is extended to statuses to fold them. If the two sets name their
completing statuses differently, the merge leaves two completing statuses — a
client that sees more than one treats the lowest id as the completing status.

### The filter is a JSON expression tree with ids and day offsets (Q6, Q16, Q17, Q18)

**Decision.** A filter is a tree:

- inner nodes: `{ "and": [ … ] }`, `{ "or": [ … ] }`, `{ "not": … }`;
- leaves (predicates): `{ "tag": "<tagId>" }`, `{ "project": "<projectId>" }`,
  `{ "status": "<statusId>" }`, `{ "priority": [0, 1, …] }`,
  `{ "scheduled": { "from": …, "to": … } }`, `{ "due": { "from": …, "to": … } }`,
  `{ "recurring": true|false }`;
- date bounds are integers — days relative to the client's local today
  (`to: -1` = before today, `from: 0, to: 0` = today) — or absolute
  `YYYY-MM-DD` strings; either bound may be absent (open-ended);
- depth at most 8.

The schema lives in `@todoer/specs` with an evaluator
(`matches(filter, task, labels, today)`) and shared test cases, like the rrule
parser and `nameKey`. The server validates a view's filter against the schema
on every write.

- Ids survive renaming a tag or project; day offsets keep "This week" correct
  every day.
- One evaluator with shared cases is the same safeguard as the rrule vectors.

**Rejected.**

- *A query string in the CLI grammar* — a second parser in every client, and
  references by name.
- *References by name in JSON* — break on rename.
- *Absolute dates only* — one-day views.
- *Named periods* (`this_week`) — raise "when does a week start"; can be added
  on top of offsets.
- *Two tag lists (all / any)* and *DNF without NOT* — recommended forms; the
  maintainer chose full boolean expressions.

**Cost.** GUI clients need a tree editor (sub-project 3). "This calendar week"
is expressed as the next 7 days in v1.

### Sorting: the view picks a key; manual order is one shared rank (Q10)

**Decision.** `view.sort` is one of `manual` (task `rank`, ADR 0008),
`priority`, `due`, `scheduled`. Manual order is the task's single `rank`,
shared by every view; dragging in a manually sorted list or column sets `rank`.

**Rejected.** *Per-view manual order* — a (view × task) table that grows with
every drag; *rank only* — common "by due date" views would need writes.

**Cost.** Dragging in a view sorted by something other than `manual` writes
nothing (or the client switches the view to manual — a client decision).

### The calendar shows both dates; moving an occurrence copies it (Q3, Q11, Q13)

**Decision.**

- A task appears on its `scheduled_on` day and again on its `due_on` day; a
  recurring task appears on each occurrence in the visible range, expanded by
  the client's expander.
- Dragging a scheduled placement sets `scheduled_on`; dragging a due placement
  sets `due_on`.
- Dragging one occurrence of a recurring task to another day skips the original
  occurrence (`skip`) and creates a one-off copy on the new day. The copy carries
  `title`, `notes`, `project`, tags, `priority` and `statusId`, no `rrule`, and two
  new task fields: `originTaskId` and `originOccurrence`. Undoing the move
  deletes the copy and undoes the skip.

**Rejected.**

- *Due date only* or *scheduled only with a due marker* — the maintainer chose
  both placements.
- *Recurring occurrences not movable* — recommended, rejected by the maintainer.
- *An occurrence-level `movedTo` field* — gives an occurrence data of its own,
  the trigger ADR 0002 names for revisiting "rule, not rows".
- *An unlinked copy* or *a title-only copy* — no undo, and the copy falls out of
  the views the original was in.

**Cost.** A task with both dates shows twice. Two new nullable task fields join
the contract now. If the original task is deleted, the copy lives on as an
ordinary one-off task.

## Routine choices

- **Two plans (Q14).** V2 server and contract first — `status` and `view`
  tables, `task.statusId`, `task.originTaskId`/`originOccurrence`, filter schema
  validation, the evaluator and its shared cases in `@todoer/specs`; then V1, the
  CLI. The layouts themselves arrive with the GUI clients (sub-project 3).
- **The CLI and views (Q12).** `todoer list --view <name>` applies a view's filter
  and sort and ignores its layout; `todoer views` lists views. Creating and
  editing views belongs to GUI clients.
- **The CLI and status (Q15).** `list` shows each task's status (text and
  `--json`); the CLI has no command to move a task between statuses (chosen by
  the maintainer over a `move` command). Its `done`/`undo` still set `statusId`
  as the occurrence rule requires.

## Verified facts

- A task has `rank` (fractional index, ADR 0008), `scheduledOn`, `dueOn`,
  `priority`, `projectId`, tags through TaskTag, and recurrence (`rrule`,
  `dtstart`); completion lives in `task_occurrence.state` (plan C).
- Tag and project names compare through `nameKey` in `@todoer/specs`, and
  duplicate names merge after each pull (#362).
- The CLI's `list` already filters by `@tag`/`#project` with AND semantics.

## Risks

- **Two sources of progress.** Status and occurrence state can still disagree in
  ways the display rule hides; a GUI that edits `statusId` alone must not imply
  completion.
- **Seeded statuses.** Offline first runs on two devices seed duplicate sets;
  the name merge folds equal names, but differently named completing statuses
  leave two — handled by "lowest id is completing" at display time.
- **Expression complexity.** Arbitrary boolean filters need an editor UI and
  careful evaluator testing; the depth limit and server-side schema validation
  bound the damage.
- **Moved-occurrence copies** accumulate as one-off tasks; their link to the
  original is informational once the original changes.

## Deferred

- **Named date periods** (`this_week`, week start).
- **Creating and editing views from the CLI.**
- **A CLI command to move a task between statuses.**
- **Grouping a list view** (by project, by status) beyond kanban's columns.

## Departures in the plan

Plan V2 (server and contract) departs from this document in six places; the
plan lists them at its top
([plan V2](../plans/2026-10-01-plan-v2-views-server.md#where-this-plan-departs-from-the-design-doc)).

1. **`{ "project": null }` matches tasks without a project.** A project leaf
   with an id alone cannot express an "Inbox" view except by naming every
   project inside a `not`.
2. **The evaluator takes facts, not rows.** `matches(filter, task, today)`
   receives a `FilterTask` (tag ids, project id, displayed status id, priority,
   both dates, whether the task recurs) that the caller resolves, so the
   evaluator never needs the replica. The `labels` argument is gone.
3. **The board rule is a shared function.** `displayStatus(statusId, statuses,
   occurrenceClosed)` lives in `@todoer/specs` with vectors, since Q7, Q8 and
   Q9 decide what every client shows. "The first status" means the first
   non-completing one by `rank`, then id; only when every status is completing
   is it the first outright, or a task with a null `statusId` would land in a
   completing column that ranks first.
4. **The filter has limits beyond depth.** At most 256 nodes, day offsets
   within ±36 600, `priority` lists of 0-4 and non-empty. `{ "and": [] }`
   matches every task and `{ "or": [] }` none; `{ "due": {} }` matches every
   task with a due date.
5. **`originTaskId` has no foreign key.** The link is informational: a key
   would block pruning the original's tombstone while a copy lives, or null
   the copy's field behind the clients' backs. The server checks ownership on
   write. `statusId` does have a foreign key, and a status tombstone is pruned
   only once no task references it.
6. **`originTaskId` and `originOccurrence` are set together.** One without the
   other names no occurrence, so the server rejects it. A `set` writes one
   field, so neither can change once the copy exists: both are given in the
   `create` of the copy.

## Open threads

None.
