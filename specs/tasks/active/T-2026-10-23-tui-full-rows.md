## T-2026-10-23-tui-full-rows — Draw TUI tasks in full and make the board fill its box

- Created: 2026-10-23
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: maintainer request, 2026-10-23 — full-height rows, a blank line
  between top-level tasks, `b` toggles list ⇄ board without saving,
  board columns stretch and are split by `│` under an underlined header;
  an open task in a later status is marked `◐` in yellow
- Plan: none; the steps below are the whole change

### Goal

A long title under the cursor is drawn over the tasks below it, so moving
through a list hides tasks. Rows run together with nothing between groups.
The board is only reachable through a view saved as kanban in the web, its
columns are a fixed 22 cells wide whatever the box, and nothing but a space
separates them. The outline and the board should show every task whole,
separate them visibly, and the board should be one key away and use its box.

### Scenarios

1. **Given** a task whose title is wider than the outline, **When** the list
   is drawn, **Then** the whole title shows on as many lines as it needs and
   the tasks below it move down, cursor or not.
2. **Given** two top-level tasks, the first with subtasks, **When** the list
   is drawn, **Then** one blank line stands before the second top-level task
   and none between a parent and its subtasks.
3. **Given** a list view, **When** `b` is pressed, **Then** the board shows
   for that view; `b` again brings the list back; picking another view drops
   the override; the saved view is not written.
4. **Given** three status columns and a board box wider than 3 × 22, **When**
   the board is drawn, **Then** the columns split the whole width, a `│`
   stands between them and a `─`/`┼` line under the headers.
5. **Given** a card title wider than its column, **When** the board is drawn,
   **Then** the card wraps inside its column, and a blank line separates
   cards.

### Requirements

- **FR-001** The outline MUST draw every row's title in full, wrapped under
  its head; the row's meta stays on its first line (← maintainer).
- **FR-002** The outline MUST put one blank line before every top-level row
  but the first, and none before a subtask (← maintainer).
- **FR-003** The outline MUST scroll by lines so the cursor row, or the add's
  block, is drawn whole; a row taller than the pane shows from its start.
- **FR-004** `b` MUST switch the drawn layout between list and board for the
  current view only, without a write; picking a view resets it
  (← maintainer).
- **FR-005** The board MUST split its width evenly among the columns that
  fit at 22 cells or more, draw `│` between columns and underline the header
  row with `─` joined by `┼` (← maintainer).
- **FR-006** A board card MUST wrap inside its column, with one blank line
  between cards; the cursor's column scrolls by lines to keep its card whole.
- **FR-007** The outline MUST mark an open task in its first status, or in
  none, `○`, in any later status `◐` (yellow unless `NO_COLOR`), and a
  closed one `✓` (← maintainer).

### Edge cases

- A title with no space wider than the column → wrapped by width (FR-001,
  FR-006, T001, T002).
- A filter that keeps a subtask and its dimmed parent → parent is top-level,
  so the blank line still stands before it (FR-002, T001).
- An add row at the top level → it takes a blank line like a task (FR-002,
  T001).
- `b` in the narrow mode → one status column at a time, as a saved kanban
  view does (FR-004, T003).
- `/` while the board shows through `b` → not offered, as on a saved kanban
  view (FR-004, T003).

### Definition of Done

- **SC-001** In tmux at 140×40: a long title shows in full and pushes the
  next task down; `b` shows the board across the outline and detail columns
  with `│` columns filling the box.
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001–003] Outline: rows as line blocks, blank line before
  top-level rows, scroll by lines; replace the overlay tests —
  `apps/tui/src/outline.ts`, `apps/tui/src/outline.spec.ts`
- [x] T002 [FR-005–006] Board: stretched columns, `│` and the header rule,
  wrapped cards, line scroll — `apps/tui/src/board.ts`,
  `apps/tui/src/board.spec.ts`
- [x] T003 [FR-004] Root: `b` override, reset on pick; help and hints —
  `apps/tui/src/root.ts`, `apps/tui/src/help.ts`, `apps/tui/src/root.spec.ts`
- [x] T005 [FR-007] Status marker — `apps/tui/src/outline.ts`,
  `apps/tui/src/outline.spec.ts`
- [x] T004 Docs: Q11/Q13/Q10 in the redesign design doc —
  `docs/specs/2026-10-22-tui-ux-redesign-design.md`
- **Checkpoint:** the TUI tests, typecheck and lint pass; tmux check done.

### Open questions

—
