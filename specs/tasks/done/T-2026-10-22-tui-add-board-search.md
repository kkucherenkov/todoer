## T-2026-10-22-tui-add-board-search — Add in place, a wide board and `/` in the TUI

- Created: 2026-10-22
- Owner: claude
- Status: done
- Completed: 2026-10-22
- Result: PR pending
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md)
  (Q8, Q9, Q10, Q12, Q17, "Pane boxes")
- Plan: [docs/plans/2026-10-22-plan-tui-ux-redesign.md](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md),
  PR 3, Tasks 3.1–3.3

### Goal

Step 3 of the redesign. A new task is still typed on a line under the list,
away from where it lands; the kanban is squeezed into the outline column with
its cards cut off at the bottom; and the outline has no way to narrow a long
list. Step 3 types a new task on the row where it will appear, gives the board
the outline and detail columns with the card details over it, and adds a
client-side `/` filter.

### Scenarios

1. **Given** the cursor on a task, **When** the user presses `n`, types
   `buy milk #home @shop p1` and Enter, **Then** one `add` is sent, the task
   has the project, tag and priority parsed, and the cursor is on it.
2. **Given** the input row open, **When** the user presses Esc, **Then** the
   row goes and nothing is sent.
3. **Given** the server refuses the add, **When** the reply arrives, **Then**
   the row keeps the text, marked `✗`, with the reason under it; `r` resends
   a retryable refusal with the same `opId`, Enter reopens the text and a
   save after a permanent refusal is a new add.
4. **Given** a kanban view at 140 columns, **When** it is shown, **Then** the
   board spans the outline and detail columns in one box titled `Board`, and
   the sidebar stays.
5. **Given** the board, **When** the user presses Enter on a card, **Then**
   its details open boxed over the board; Esc closes them with the cursor on
   the same card.
6. **Given** a kanban view at 80 columns, **When** it is shown, **Then** one
   status column shows under `STATUS (n/m)`, and → shows the next.
7. **Given** the outline, **When** the user presses `/` and types `milk`,
   **Then** only the rows whose title contains it stay, the Tasks box reads
   `Tasks /milk`, and Esc clears the filter.

### Requirements

- **FR-001** `n` MUST open an input row under the cursor at the screen row
  where the new task will appear; only the rows below it move, down one.
  `o` stays an alias of `n` (a sibling), `O` adds a subtask (← Q12,
  controller ruling)
- **FR-002** Enter MUST send one `add` (quick-add grammar: `#project @tag
  pN`, dates) through a held intent (`createIntent`), and the cursor MUST
  land on the new task; Esc removes the row and sends nothing (← Q12)
- **FR-003** A refused add MUST keep the text in its row, marked `✗` with
  the reason under it. `r` resends only a retryable refusal, with the same
  `opId`; Enter reopens the text, and saving after a permanent refusal is a
  new add (new `opId`); Esc discards the row (← Q8, maintainer decision
  2026-10-22)
- **FR-004** In `three` and `two` the board MUST take the outline and detail
  columns in one box titled `Board`; the sidebar box stays in `three` (← Q10)
- **FR-005** Enter on a card MUST open its details as a boxed overlay over
  the board; Esc closes it and the cursor stays on the card; the Esc order
  holds (← Q10, Q9)
- **FR-006** The board MUST scroll a column's cards so the cursor card is
  always drawn (← Q10)
- **FR-007** In `one`, one status column MUST show at a time under
  `STATUS (n/m)` (its position among the columns), switched with ←/→ or
  h/l; `J`/`K`/`H`/`L` move cards as before (← Q10)
- **FR-008** `/` MUST open an input in the top status line (INSERT); typing
  keeps the rows whose title contains the text, case-insensitively after
  `normalize('NFC')`; a matching subtask keeps its parent row, dimmed; the
  Tasks box title shows the filter (`Tasks /milk`) (← Q17, controller ruling)
- **FR-009** Enter MUST keep the filter and return to NORMAL; Esc in the
  input clears it; in NORMAL, Esc clears it last, after an input, a refusal
  and an overlay; the sidebar counts do not change (← Q17, Q9)
- **FR-010** The help screen and the hints MUST list `n`, `/` and the board
  keys; keys pi-tui takes before the app stay unbound; every frame is
  exactly the terminal's size and `NO_COLOR` holds (← Q9, Q14)

### Edge cases

- `n` on an empty view → the input row is the first row (FR-001, T001)
- `n` on a subtask → a top-level task after the parent's group (FR-001, T001)
- In a view that sorts itself, the input row stands below the cursor's
  group; the task then appears where the sort puts it (FR-001, T001)
- The input row at the bottom of the pane → the list scrolls so the row is
  drawn (FR-001, T001)
- A retryable refusal resent with `r` that is then accepted → the row goes,
  the cursor is on the new task (FR-003, T001)
- Keys while the add is in flight → ignored, the row shows `saving…` and
  the new task only there; one add is sent; the board's add line likewise
  (FR-002, T001)
- More cards than the board's height → the cursor card is drawn (FR-006,
  T002)
- A filter that matches nothing → `nothing here`; the cursor's task filtered
  out → the cursor stays at the same place (FR-008, T003)
- `Ё` and `ё` match each other (case), a decomposed `ё` matches the composed
  one (NFC) (FR-008, T003)
- A task added while filtered stays shown, the cursor on it, until the
  filter text changes (FR-008, T003)

### Definition of Done

- **SC-001** A person adds a task where it will appear, reads and moves a
  board with every card reachable, and narrows a long outline, at 80, 100 and
  140 columns.
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint` (CI on the PR)
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002, FR-003] `n` adds in place — `apps/tui/src/outline.ts`
  (Task 3.1)
- [x] T002 [FR-004, FR-005, FR-006, FR-007] The board across two columns —
  `apps/tui/src/board.ts`, `apps/tui/src/root.ts` (Task 3.2)
- [x] T003 [FR-008, FR-009] `/` filters the outline — `apps/tui/src/outline.ts`,
  `apps/tui/src/root.ts` (Task 3.3)
- [x] T004 [FR-010] Help, hints, README and the design doc — `apps/tui/src/help.ts`,
  `apps/tui/README.md`, `docs/specs/2026-10-22-tui-ux-redesign-design.md`
- **Checkpoint:** each of the scenarios above passes in a spec and in a tmux
  look at 140×36, 100×30 and 80×24.
