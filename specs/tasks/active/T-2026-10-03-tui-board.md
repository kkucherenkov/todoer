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

1. The specs' kanban view filters `{ and: [] }`: `filterProblem` rejects the
   plan's `{ all: [] }` (the plan allowed for this).
2. The plan's `l`, `L` after the first `L` moved the cursor to the empty
   Done column, so nothing reached Done. The spec presses `L` twice, then
   `H` to undo.
3. `o`'s input closes when the add is taken and keeps the text on a refusal;
   the plan closed it before the write. The `move` into a later column
   follows a taken add.
4. The cursor follows a card it moved or added (`follow`): the plan kept the
   row, which after `L`, `J` or an add points at another card.
5. The cursor's card is marked `▸ ` as well as inverse: without colour (the
   test renderer, `NO_COLOR`) Ink drops inverse and the cursor vanished.
6. With no statuses the plan's `target.id === null` branch could not run:
   the one null column has no neighbour. `H`/`L` say there is nowhere to
   move when the current column is the null one.
7. The columns that fit count the pane's border and padding (4) and the
   sidebar (22, from 80 columns), and the last column's margin; the plan
   subtracted 24 or 2.
8. `moveAfterIn`'s comment explains the anchor itself instead of pointing at
   the outline plan's `moveAfter`, which is not on this branch.
9. The columns spec builds a whole `Item`: the plan's cast of a partial one
   fails `tsc` (TS2352).
10. More tests than the plan's: `h`/`l`/`j`/`k`, the subtask's card, `J`/`K`
    in a manual view and a sorted one, a refused add, `m`, the scroll. The
    no-statuses board is tested on `columns` only: the engine seeds three
    statuses on a first sync, so the kit cannot render it (shell departure 8).

### By-hand run (plan Task 3)

Backend built from this branch on port 3102 against a fresh
`todoer_tui_board` database, a scratch `HOME`, a user registered over HTTP
and `todoer login` done; five statuses (the last completing) and a manual
kanban view `Board` posted to `/sync`. `todoer-tui` in a 110×24 PTY: `]`
opened the board with `columns 1–3 of 5`. `L` moved `alpha` to Doing and
the cursor went with it; `L` on into Done scrolled to `columns 3–5 of 5`
and the status line read `marked done`; `H` read `marked undo` and left it
in Blocked. `J` put `beta` below `gamma`; `l`, `o`, `delta`, Enter added
`delta` to Doing. `todoer list` showed `alpha` Blocked, `delta` Doing,
`gamma` and `beta` To do. At 60 columns the sidebar hid and two columns
fit, `columns 2–3 of 5`.

Surprising, outside this task: at 60 columns the shell's status bar runs
the status into the hints (`syncej/k move`) and wraps the hints onto a
second line.

### Open questions

None.
