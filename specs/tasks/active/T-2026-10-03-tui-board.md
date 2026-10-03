## T-2026-10-03-tui-board — Show kanban views as a board in the terminal client

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q7, Routine choices:
  keys, changing status)
- Plan: docs/plans/2026-10-03-plan-t3b-tui-board.md

### Goal

The shell renders a kanban view as a flat list. A person who keeps a board
on the web should see the same columns in the terminal and move cards across
and within them from the keyboard.

### Scenarios

1. **Given** a kanban view over three statuses, **When** it is opened,
   **Then** each status is a column with its cards in the view's order.
2. **Given** a card in the first column, **When** `L` is pressed twice,
   **Then** it lands in the completing column, is marked done, and the
   status line says so.
3. **Given** the cursor in the second column, **When** `o` adds `gamma`,
   **Then** `gamma` is a card in that column.

### Requirements

- **FR-001** The board MUST show one column per status in rank order, cards
  in the view's order; a subtask's card names its parent (`parent › title`)
  (← design Q7, the board's cards)
- **FR-002** `h`/`l` MUST change the column and `j`/`k` the card (← keys)
- **FR-003** `H`/`L` MUST move the card to the neighbouring column; into the
  completing column it is marked done and the status line says so (← keys,
  changing status)
- **FR-004** `J`/`K` MUST reorder within a column in a manual view only
  (← web departure 7)
- **FR-005** `o` MUST add a card to the current column (← keys)
- **FR-006** The shared task keys, `m` included, MUST work on a card (← keys)
- **FR-007** More columns than fit MUST scroll horizontally with the cursor
  (← design Q7)

### Edge cases

- No statuses → one column, "Tasks"; `H`/`L` say there is nowhere to move
  (FR-001, FR-003, T001)
- The cursor's card moves to another column or place → the cursor follows it
  (FR-003, FR-004, T002)
- `J`/`K` in a view not sorted manual → the status line says why nothing
  moved (FR-004, T002)
- The add is refused → the input stays open with the text (FR-005, T002)

### Definition of Done

- **SC-001** Against a live backend, a card moved across and within columns,
  into the completing column and back, and a card added to a column, each
  show the same in `todoer list`
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] [FR-007] columns, the visible window, the in-column
      anchor — plan Task 1
- [ ] T002 [FR-001]–[FR-007] the board pane — plan Task 2
- [ ] T003 by hand against a live backend — plan Task 3
- [ ] T004 documents, gates, PR — plan Task 4
- **Checkpoint:** a kanban view renders as a board and its cards move

### Departures from the plan

### Open questions

None.
