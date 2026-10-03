## T-2026-10-03-tui-statuses — Manage statuses from the terminal client

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q7, Routine choices: the
  statuses screen); the views design, Q8
- Plan: docs/plans/2026-10-03-plan-t3d-tui-statuses.md

### Goal

The board's columns are statuses, and the shell's `S` says "statuses is not
built yet". A person working in `todoer-tui` needs to add, rename, reorder,
mark completing and delete statuses without leaving for the web.

### Scenarios

1. **Given** three statuses, **When** `S` is pressed, **Then** they are listed
   in rank order with the completing one marked and each one's task count;
   Esc returns to the view.
2. **Given** the cursor on "To do", **When** `a`, "Review", Enter, **Then**
   "Review" ranks after "To do".
3. **Given** the cursor on "Doing", **When** `dd` then `y`, **Then** the status
   line named how many tasks move and "Doing" is gone.

### Requirements

- **FR-001** `S` MUST list the statuses in rank order with the completing one
  marked and each one's task count; Esc closes (← design, statuses screen)
- **FR-002** `a` MUST add a status after the cursor (← design)
- **FR-003** Enter MUST rename the status under the cursor (← design)
- **FR-004** `J`/`K` MUST move the status down/up (← design)
- **FR-005** `c` MUST mark the status under the cursor completing (← design, Q7)
- **FR-006** `dd` then `y` MUST delete, after asking on the status line and
  naming how many tasks move; any other key keeps it (← design, views Q8)
- **FR-007** A name input MUST close only when its write is taken and keep the
  typed text on a refusal (← shell plan, LineInput rule)

### Edge cases

- Rename to a name another status has → refused on the status line, the input
  stays open with the text (FR-007, T001)
- `J` on the last status, `K` on the first → nothing (FR-004, T001)
- `dd y` on the completing or the last open status → the core refuses, the
  status line says why (FR-006, T002)

### Definition of Done

- **SC-001** Against a live backend, a status added, renamed, reordered, made
  completing and deleted in the TUI shows the same in the CLI
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001..FR-007] The statuses screen, test first — plan Task 1;
      `apps/tui/src/statuses.tsx`, `apps/tui/src/statuses.spec.tsx`
- [ ] T002 [FR-001..FR-006] By-hand run against a live backend — plan Task 2
- [ ] T003 Gates, changelog, PR — plan Task 3
- **Checkpoint:** `S` manages statuses and the CLI agrees

### Departures from the plan

1. The rename/add `LineInput` closes in the write's `.then` when `r.ok`, not
   before the write as the plan's code did (Global Constraints rule; FR-007).
   The cursor moves onto a new status only once its write is taken.

### Open questions

None.
