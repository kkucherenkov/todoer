## T-2026-10-03-tui-details — Edit every task field from a details screen

- Created: 2026-10-03
- Owner: claude
- Status: done
- Completed: 2026-10-03
- Result: (PR link below once opened)
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
  shows in `todoer list --json`
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-003] [FR-005] field parsing and recurrence presets — plan
      Task 1
- [x] T002 [FR-006] `$EDITOR` for notes — plan Task 2
- [x] T003 [FR-001] [FR-002] [FR-004] [FR-005] [FR-007] the details screen —
      plan Task 3
- [x] T004 by hand, documents, PR — plan Task 4
- **Checkpoint:** `e` opens a details screen that edits every field

### Departures from the plan

1. `customRule` checks a raw RRULE with the core's `ruleProblem`, not
   `parseRrule` alone: it also refuses a rule that produces no date from its
   start, the same check `setRecurrence` makes, so the screen never queues a
   rule the core would refuse.
2. `parseDate` returns `false` for "not a date", not `'invalid'`:
   `string | null | 'invalid'` collapses to `string | null`, which type-aware
   ESLint rejects (`no-redundant-type-constituents`) and which narrows
   nothing.
3. Every line closes only when its write is taken (`result.ok`) and keeps
   its text on a refusal, a parse refusal included; the plan's code closed
   the line before saving. `line()` takes a `save` that returns either the
   refusal to say or the write's promise.
4. The field editors are a `switch` in one function instead of the nested
   ternary; the plan offered this.
5. The status picker moves the task in `ALL`, the core's constant, not the
   literal `'all'`.
6. Notes read `1 line`, not `1 lines`.
7. Stronger tests than the plan's three: title, project and tags save alone
   and close the line; a refused priority keeps the line open with its text;
   an empty date clears; the status picker moves the task; a raw RRULE the
   core refuses keeps the line; a subtask lists under its parent and its
   Repeat writes nothing; notes go through `$VISUAL` and Ink's real
   `suspendTerminal` (`VISUAL="printf … >"`).

### By-hand run (plan Task 4 Step 1)

Backend built from this branch on port 3103 against a fresh
`todoer_tui_details` database, a scratch `HOME`, a user registered over HTTP
and `todoer login` done. `todoer-tui` in a 110×30 PTY: `e` opened the
details of a task the CLI added. Scheduled and due were set, `soon` was
refused on the status line with the line kept, and scheduled was cleared.
Repeat weekly took today's weekday (scheduled was empty), the custom
`FREQ=WEEKLY;INTERVAL=2` was taken, and none turned the task back into a
one-off scheduled on its current occurrence. Notes were edited with
`EDITOR=nano`; Ink came back intact. Title, project, tags (`q` typed into
the line did not leave the screen), priority and status were set. After each
step `todoer list --json` in another shell showed the change.

- The CLI has no `todoer show`; `todoer list --json` shows the same fields.
- `EDITOR="code --wait"` needs a GUI the PTY driver cannot drive.
  `EDITOR="sed -i '' s/skim/semi/"` exercised the same path, a command with
  arguments, and an editor exiting non-zero (`EDITOR=false`) wrote nothing.

### Open questions

- The design doc's details-panel bullet says an unparsable value "is
  reported on the field"; the screen keeps the field's line open with the
  text and says the reason on the status bar, as the line-input bullet
  above it describes. Outside this task's one-sentence edit; left for the
  maintainer.
