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
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] [FR-002] [FR-003] [FR-004] outline rows, indent target,
      move anchor — `apps/tui/src/outline-tree.ts` (plan Task 1)
- [ ] T002 [FR-001]–[FR-006] the outline pane — `apps/tui/src/outline.tsx`
      (plan Task 2)
- [ ] T003 by-hand run against a live backend (plan Task 3)
- [ ] T004 documents, gates, PR (plan Task 4)
- **Checkpoint:** the list layout is the outline; board, details and statuses
  plans are untouched

### Departures from the plan

1. The base (`feat/tui-shell`, PR #31) did not hold plan T1's `reparent` nor
   plan T1b's `Item.subtasks`; `origin/main` was merged in before the first
   edit.
2. `parentIn(items, item)` is not exported: nothing outside `outline-tree.ts`
   needs it, and the plan's version scanned `items` once per item. A private
   `parentsOf(items)` builds the set of listed ids once.

### Open questions

None.
