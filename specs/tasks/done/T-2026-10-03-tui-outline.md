## T-2026-10-03-tui-outline — Show the TUI's list layout as an outline

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q6, Routine choices: the
  outline, keys)
- Plan: docs/plans/2026-10-03-plan-t3a-tui-outline.md

### Goal

The shell shows a list view as a flat list, so a subtask stands apart from its
parent and the outline the design promises (todool-style: nesting, folding,
indent and outdent, moving among siblings) is missing. This task replaces the
stub with that outline.

### Scenarios

1. **Given** a task with a subtask, **When** the list view opens, **Then** the
   subtask sits indented under its parent; `h` folds it away and the parent
   shows `+1`; `l` brings it back.
2. **Given** two top-level tasks, **When** `Tab` is pressed on the second,
   **Then** it becomes a subtask of the first; `Shift-Tab` makes it top-level
   again.
3. **Given** a task with subtasks, **When** `Tab` is pressed on it, **Then**
   the status line says a task with subtasks cannot become a subtask.
4. **Given** a manual view, **When** `J` is pressed, **Then** the task moves
   below its next sibling; in a view with any other sort the status line says
   so and nothing is written.
5. **Given** a top-level task, **When** `O` and a title are typed, **Then**
   the new task is its subtask.

### Requirements

- **FR-001** The outline MUST nest a listed subtask under its listed parent; a
  subtask whose parent is not listed stands at the top level with `parent ›`
  (← design, the outline)
- **FR-002** `h`/`l` MUST fold and unfold; a folded parent shows `+N`
  (← design, keys)
- **FR-003** `Tab` MUST indent under the nearest top-level task above;
  `Shift-Tab` outdents; refusals reach the status line (← design, keys)
- **FR-004** `J`/`K` MUST move a task among its siblings in a manual view only
  (← web departure 7: ranks only in a manual view)
- **FR-005** `o` MUST add a task, `O` a subtask of the current top-level task
  (← design, keys)
- **FR-006** The shared task keys MUST work on every row (← shell plan)

### Edge cases

- Subtask whose parent the view does not list → top level with `parent ›`
  (FR-001, T001)
- Folding a task without listed subtasks → no-op (FR-002, T001)
- `Tab` on the first row or on a subtask → nothing above / two levels only
  (FR-003, T001, T002)
- `J` on the last sibling, `K` on the first → nothing written (FR-004, T001)
- A refused `O` keeps the typed text (FR-005, T002)

### Definition of Done

- **SC-001** In `todoer-tui` against a live backend a person folds, indents,
  outdents, moves and adds a subtask, and `todoer list` shows the same nesting
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] [FR-002] [FR-003] [FR-004] outline rows, indent target,
      move anchor — `apps/tui/src/outline-tree.ts` (plan Task 1)
- [x] T002 [FR-001]–[FR-006] the outline pane — `apps/tui/src/outline.tsx`
      (plan Task 2)
- [x] T003 by-hand run against a live backend (plan Task 3)
- [x] T004 documents, gates, PR (plan Task 4)
- **Checkpoint:** the list layout is the outline; board, details and statuses
  plans are untouched

### Departures from the plan

1. The base (`feat/tui-shell`, PR #31) did not hold plan T1's `reparent` nor
   plan T1b's `Item.subtasks`; `origin/main` was merged in before the first
   edit.
2. `parentIn(items, item)` is not exported: nothing outside `outline-tree.ts`
   needs it, and the plan's version scanned `items` once per item. A private
   `parentsOf(items)` builds the set of listed ids once.
3. The plan's render spec used ids like `'alpha'`; the engine finds a task by
   uuid or a hex id suffix, so `x` on such a row was refused. The spec mints
   uuids and names tasks by title. Its sorted view's filter is `{ and: [] }`:
   `{ all: [] }` (as in `app.spec.tsx`) is an invalid filter, and the view
   then shows nothing.
4. The cursor follows its task by id instead of `setAt(i + step)` after a
   move. A top-level task moving past a sibling with subtasks travels more
   than one row, and before any `j`/`k` the index pointed at whatever row
   came first after the write (`J` then `K` moved nothing). It is pinned to
   the task under it on every key; a task that leaves the view leaves the
   cursor at the same place.
5. `j`/`k` and the arrows skip `key.meta`: in the plan the `j` branch came
   first and took `Alt-↓`, so `Alt-↓`/`Alt-↑` never moved a task.
6. Shift-Tab also matches `input === '\u001b[Z'`, as the plan's note
   allowed for terminals that do not set `shift`.
7. The add line closes only when the write is taken (the plan's constraint;
   its code closed before the write).
8. More tests than the plan's: `o`, `O` on a subtask adds a sibling, a refused
   `O` keeps its text, `Tab` on the first row, `J` in a sorted view writes
   nothing, `Alt-↓`/`Alt-↑`, and `x` on a subtask row (FR-006).

9. `todoer list` prints no nesting, so the by-hand check compared
   `todoer list --json`'s `parentId` instead.

### By-hand run (plan Task 3)

Backend built from this branch on port 3101 against a fresh
`todoer_tui_outline` database, a scratch `HOME`, a user registered over HTTP
and `todoer login` done; three tasks added with the CLI. `todoer-tui` in a
110×20 tmux pane (macOS): `Tab` put `milk` and then `laundry` under
`groceries` (bar `0/1`, then `0/2`); `h` folded it to `▸ groceries  +2`, `l`
unfolded; `Shift-Tab` (tmux sends `\e[Z`) made `milk` top-level again. `K`,
`J`, `Alt-↑` and `Alt-↓` each moved `milk` past the `groceries` block, the
cursor staying on `milk`. `O` on `laundry` added `eggs` under `groceries`;
`x` completed a task. `todoer list --json` then showed `laundry` and `eggs`
with `groceries` as their parent.

### Open questions

None.
