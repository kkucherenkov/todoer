## T-2026-09-28-cli-recurrence — Let the CLI create recurring tasks and mark occurrences done

- Created: 2026-09-28
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-09-26-plan-c-recurrence-design.md](../../../docs/specs/2026-09-26-plan-c-recurrence-design.md)
  (the C1 half: Q3, Q6, Q9, Q10, Q11, "Notes for C1"); ADR 0002, 0009, 0010,
  0015
- Plan: [docs/plans/2026-09-28-plan-c1-cli-recurrence.md](../../../docs/plans/2026-09-28-plan-c1-cli-recurrence.md)

### Goal

The server stores task occurrences since C2, but no client can write one: the
CLI has only `add`, `list` and `outbox`, so a task can be created and never
finished, and a recurring task cannot be created at all. This task gives the
CLI its own rule expander, recurrence on `add`, a short reference for every
task in `list`, and `done`/`skip`/`undo`, all of which work offline like
every other command.

### Scenarios

1. **Given** no tasks, **When** a caller runs
   `todoer add "water the plants" --rrule FREQ=DAILY`, **Then** `list` shows it
   with today's date.
2. **Given** that task, **When** the caller runs `todoer done <ref>`, **Then**
   `list` shows it with tomorrow's date, and a second client sees the same
   after it syncs.
3. **Given** a one-off task, **When** the caller runs `todoer done <ref>`,
   **Then** it leaves `list`; `todoer undo <ref>` brings it back.
4. **Given** no server, **When** the caller runs `done`, **Then** it exits 5,
   `list` already reflects it, and a later command delivers it.
5. **Given** a daily task missed for five days, **When** the caller lists,
   **Then** it shows once, at today's date.

### Requirements

- **FR-001** The CLI MUST expand a rule exactly as `vectors/rrule.json`
  expects, for every case in it (← design Q3, Q6; D18).
- **FR-002** `add` MUST accept `--rrule <RRULE>` and `--from YYYY-MM-DD`
  (default: today, local date), refuse a rule `parseRrule` refuses, a bad
  date, or `--from` without `--rrule`, with exit 2 and nothing queued
  (← design Q9).
- **FR-003** `list` MUST show each live task once with a short reference (the
  last 6 characters of its id); a recurring task at its current occurrence,
  a one-off task only while not done or skipped (← design Q10, Q11).
- **FR-004** The current occurrence MUST be the latest occurrence on or before
  today if it is open, otherwise the first open occurrence after today; a
  task with neither is not listed (← design Q11; plan departure 2).
- **FR-005** `done`, `skip`, `undo` MUST accept a full id or a unique suffix
  of at least 4 hex digits, and refuse an ambiguous or unknown one with exit 2
  naming the candidates (← design Q10).
- **FR-006** `done` and `skip` MUST act on the current occurrence, `undo` on
  the latest done or skipped one, unless `--on YYYY-MM-DD` names an
  occurrence of the rule; `--on` on a one-off task, or on a date the rule does
  not produce, is exit 2 (← design Q11; plan departure 1).
- **FR-007** `done`/`skip`/`undo` MUST queue one `create` of `task_occurrence`
  with the derived id and `state` done/skipped/open; `completedAt` is set by
  `done` and null otherwise; the exit code follows the same rules as `add`
  (← design Q2, Q8; "Notes for C1").
- **FR-008** A pending `create` of an existing task occurrence MUST show merged
  over the stored row, so `list` reflects an offline `done` or `undo` at once
  (← design Q8).
- **FR-009** The CLI MUST read done/skipped from `state` only, and ignore task
  occurrences whose task is tombstoned or absent (← "Notes for C1").
- **FR-010** A subtask MUST use its parent's rule and dates (← ADR 0009; plan
  departure 3).
- **FR-011** HELP, README and `scripts/walking-skeleton.sh` MUST describe and
  prove recurrence end to end (← project rule 3).

### Edge cases

- today before `dtstart` → the first occurrence is shown (FR-004, T003)
- a rule that has ended (COUNT or UNTIL passed, all done) → not listed;
  `done` without `--on` is exit 2 (FR-004, FR-006, T003, T005)
- a future occurrence marked done in advance → skipped when finding the next
  open one (FR-004, T003)
- `undo` with nothing done → exit 2 (FR-006, T005)
- the title contains the literal text `--rrule` inside one quoted argument →
  it stays part of the title (FR-002, T004)
- a suffix shorter than 4, or containing non-hex characters → exit 2
  (FR-005, T002)
- a rule that never matches (`BYMONTH=2;BYMONTHDAY=31`) → expansion
  terminates with nothing (FR-001, T001)

### Definition of Done

- **SC-001** `sh scripts/walking-skeleton.sh` against a running server
  creates a daily task in one replica, marks it done, and a second replica
  lists it at a date other than today.
- **SC-002** `pnpm --filter @todoer/cli test` passes every case of
  `vectors/rrule.json`.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] expander and two new vectors — plan Task 1
- [x] T002 [FR-005, FR-008] task references; overlay merges derived-id
      creates — plan Task 2
- [x] T003 [FR-004, FR-006, FR-009, FR-010] current occurrence, recurrence of
      a task, latest closed — plan Task 3
- **Checkpoint:** every pure piece is tested; nothing user-visible changed.
- [x] T004 [FR-002, FR-007] `add --rrule/--from`; one submit path for every
      write — plan Task 4
- [ ] T005 [FR-003, FR-006, FR-007, FR-009] `list` with refs and dates;
      `done`/`skip`/`undo` — plan Task 5
- [ ] T006 [FR-011] HELP, README, walking skeleton, design departures — plan
      Task 6
- **Checkpoint:** scenarios 1–5 pass; the four gates green on the PR.

### Open questions

None.
