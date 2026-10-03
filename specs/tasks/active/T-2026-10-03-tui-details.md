## T-2026-10-03-tui-details — Edit every task field from a details screen

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q7, Routine choices: the
  details panel)
- Plan: docs/plans/2026-10-03-plan-t3c-tui-details.md

### Goal

The shell lists tasks and edits their line, but a task has more than a line:
dates, status, recurrence, notes and subtasks. A person in the terminal
client needs to see and change all of them without dropping to the CLI.

### Scenarios

1. **Given** a task in the pane, **When** `e` is pressed, **Then** its
   details show every field, and Esc returns to the pane.
2. **Given** the details, **When** Due is set to `2026-10-09`, **Then** the
   task is due that day; **When** it is set to `soon`, **Then** the status
   line says a date is `YYYY-MM-DD` and the due date stays.
3. **Given** the details, **When** Repeat is set to daily, **Then** the task
   repeats daily.
4. **Given** a subtask's details, **When** Repeat is opened, **Then** the
   status line says a subtask repeats with its parent and nothing is written.

### Requirements

- **FR-001** `e` MUST open the task's details; Esc MUST close them (← Q7)
- **FR-002** Title, project, tags and priority MUST edit as lines and save
  alone (← Routine choices, the details panel)
- **FR-003** Scheduled and due MUST take `YYYY-MM-DD`; empty MUST clear;
  anything else MUST be refused on the status line (← ADR 0010)
- **FR-004** Status MUST edit through the status picker (← Q7)
- **FR-005** Recurrence MUST edit through presets or a raw RRULE checked
  before the write; it MUST be refused for a subtask (← the details panel)
- **FR-006** Notes MUST edit in `$EDITOR` (`vi` when unset) (← the details
  panel)
- **FR-007** The subtasks MUST be listed with their state (← the details
  panel)

### Edge cases

- A date like `2026-02-30` → refused, not written (FR-003, T001)
- A refused line → stays open with the typed text (FR-002, T003)
- A subtask's Repeat → refused before any write (FR-005, T003)
- The task deleted while open → "this task is gone" (FR-001, T003)
- `$EDITOR` exits non-zero or leaves the text unchanged → nothing written
  (FR-006, T002)

### Definition of Done

- **SC-001** Against a live backend, each field set in the details screen
  shows in `todoer show <ref>`
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-003] [FR-005] field parsing and recurrence presets — plan
      Task 1
- [ ] T002 [FR-006] `$EDITOR` for notes — plan Task 2
- [ ] T003 [FR-001] [FR-002] [FR-004] [FR-005] [FR-007] the details screen —
      plan Task 3
- [ ] T004 by hand, documents, PR — plan Task 4
- **Checkpoint:** `e` opens a details screen that edits every field

### Departures from the plan

### Open questions

None.
