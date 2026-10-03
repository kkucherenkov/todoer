## T-2026-10-03-tui-insert-below — Insert a new task below the cursor in the TUI

- Created: 2026-10-03
- Owner: claude
- Status: done
- Blockers: —
- Spec: coordinator decision on the maintainer's behalf, 2026-10-03 — `o`
  and `O` insert below the cursor, as an outliner does;
  `docs/specs/2026-10-03-tui-client-design.md` (keys table)
- Plan: none; the steps below are the whole change

### Goal

`o` and `O` added a task wherever the engine's default rank put it, so in a
manual view the new task appeared far from the cursor and the user had to move
it by hand. An outliner inserts below the line you are on; the TUI should too,
without a core change: a second write, a `move` with an `after` anchor, follows
a successful add.

### Scenarios

1. **Given** a manual list view with `alpha` (subtask `a1`) and `beta`,
   **When** the cursor is on `alpha` and the user types `o new⏎`, **Then**
   `new` is a top-level task between the `alpha` group and `beta`, under the
   cursor.
2. **Given** the same view, **When** the cursor is on `a1` and the user types
   `o new⏎`, **Then** `new` is a top-level task after the `alpha` group.
3. **Given** a top-level task with subtasks, **When** the user types `O`,
   **Then** the new subtask is the parent's last; on a subtask row it lands
   right after that subtask; with no subtasks it is the first.
4. **Given** a manual board, **When** the user types `o` on a card, **Then**
   the new card is right below it in the same column.
5. **Given** a view sorted by priority, **When** the user adds a task, **Then**
   only the add is sent and the sort places it.

### Requirements

- **FR-001** The outline's `o` MUST place the new top-level task after the
  cursor's group (the top-level task and its listed subtasks) in a manual view
  (← coordinator)
- **FR-002** The outline's `O` MUST place the new subtask after the cursor's
  subtask, or after the parent's last listed subtask, or first when it has
  none, in a manual view (← coordinator)
- **FR-003** The board's `o` MUST place the new card right after the cursor's
  card in its column in a manual view (← coordinator)
- **FR-004** In a view with another sort, an add MUST be the only write
  (← coordinator)
- **FR-005** The cursor MUST move to the new task (← coordinator)

### Edge cases

- empty view or empty column → add only, nothing to follow (FR-001, FR-003,
  T002, T003)
- the `move` is refused → the task stays where the engine put it, no extra
  message beyond `useWrite`'s (FR-001)
- an add into a non-first board column → one `move` carries both `statusId`
  and `after` (FR-003, T003)

### Definition of Done

- **SC-001** In a manual view, `o`/`O` and the board's `o` show the new task
  right below the cursor, with the cursor on it
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] `insertAfter` anchor — `apps/tui/src/outline-tree.ts`
- [x] T002 [FR-001, FR-002, FR-004, FR-005] outline `o`/`O` follow the add with
      a `move` — `apps/tui/src/outline.tsx`, `outline.spec.tsx`
- [x] T003 [FR-003, FR-004, FR-005] board `o` anchors on the current card —
      `apps/tui/src/board.tsx`, `board.spec.tsx`
- [x] T004 delete the unused `FlatList` — `apps/tui/src/flat-list.tsx`
- [x] T005 design doc: keys table, and a refused date is reported on the
      status line — `docs/specs/2026-10-03-tui-client-design.md`
- **Checkpoint:** specs green; turbo gates for `@todoer/tui...` and `pnpm lint`
  green

### Departures

- `flat-list.tsx` was dead code (no pane used it after T3), so it was deleted
  instead of given `o`-below; the coordinator agreed.
- The board sends one `move` with `statusId` and `after` together instead of
  a status `move` followed by an anchor `move`: the engine ranks within the
  `statusId` column when both are present, so one write is enough.
- `o` anchors on the cursor's top-level task, not on its group's last listed
  subtask as the decision worded it. Ranks are global and the outline nests
  subtasks whatever their rank, so a subtask ranked after the next top-level
  task would put the new task past that task; following the top-level task
  itself lands it right after the whole group, which is the decision's intent.
- `o` then `O` makes a subtask of the task just added: the cursor moves to the
  new task (FR-005), so the existing spec now expects that parent.
