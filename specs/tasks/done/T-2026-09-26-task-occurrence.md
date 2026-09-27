## T-2026-09-26-task-occurrence — Store task occurrences and validate recurrence on the server

- Created: 2026-09-26
- Owner: claude
- Status: done
- Blockers: —
- Spec: [docs/specs/2026-09-26-plan-c-recurrence-design.md](../../../docs/specs/2026-09-26-plan-c-recurrence-design.md)
  (the C2 half: Q2, Q4, Q5, Q7, Q8, Q13, Q14); ADR 0002, 0005, 0006, 0009,
  0010, 0013
- Plan: [docs/plans/2026-09-26-plan-c2-task-occurrence.md](../../../docs/plans/2026-09-26-plan-c2-task-occurrence.md)
- Completed: 2026-09-26
- Result: https://github.com/kkucherenkov/todoer/pull/9

### Goal

Nothing on the server can record that a task was done: `completion` and
`exception` were never built, `rrule` and `dtstart` are columns nobody reads or
checks, and the date columns cannot even be written through `/sync` — Prisma
rejects a bare `YYYY-MM-DD`. The design also has two defects: a natural-key
unique constraint collides with tombstones (complete, undo, complete again
fails; TaskTag detach then re-attach fails today), and Postgres treats NULLs
as distinct, so a non-recurring completion dedupes nothing. This task builds
the server half of plan C so the CLI (C1) can build against a merged contract.

### Scenarios

1. **Given** a task, **When** a client marks 2026-09-28 done, undoes it, and
   marks it done again, **Then** the server holds one task occurrence for that
   date, in state `done`.
2. **Given** two offline devices, **When** one marks an occurrence done and the
   other later marks it skipped, **Then** whichever arrives first, the server
   ends with `skipped`.
3. **Given** a client writes `dueOn: "2026-09-28"`, **When** any client pulls,
   **Then** it reads `"2026-09-28"` back.
4. **Given** a client sends `rrule: "FREQ=DAILY;BYHOUR=9"`, a rule without a
   `dtstart`, or a rule on a subtask, **Then** that operation is rejected with
   a reason and nothing is stored.
5. **Given** a task with tags and completions deleted more than 90 days ago,
   **When** pruning runs, **Then** the task, its TaskTag rows and its task
   occurrences are gone, and pruning logged no error.

### Requirements

- **FR-001** `@todoer/specs` MUST export `parseRrule`, accepting exactly the
  subset FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY, BYMONTHDAY,
  BYMONTH, BYSETPOS, COUNT, UNTIL, WKST and rejecting everything else with a
  reason (← design Q14; domain design §4).
- **FR-002** `@todoer/specs` MUST export `ID_NAMESPACE`, `uuidv5`,
  `taskOccurrenceId` and `taskTagId`, whose output matches
  `vectors/ids.json` (← design Q7).
- **FR-003** `@todoer/specs` MUST ship `vectors/rrule.json` covering at least
  the last working day of a month, 29 February, a fifth Sunday, `UNTIL` on an
  occurrence, and an `INTERVAL` spanning a year boundary, with expected values
  computed independently of our code (← D18; design Q12).
- **FR-004** Date columns MUST travel as `YYYY-MM-DD` in both directions; a
  date field holding anything else MUST be rejected per operation
  (← ADR 0010; found while planning).
- **FR-005** `task_occurrence` MUST be a synchronised table: create, set and
  pull work, and `taskId` must reference a task the user owns (← design Q4).
- **FR-006** A `create` into `task_occurrence` or `task_tag` whose id is not
  the UUIDv5 derivation of its fields MUST be rejected (← design Q7).
- **FR-007** A `create` of an existing id in those tables MUST apply each field
  under per-field LWW; it answers `applied` when any field won and
  `superseded` when none did (← design Q8; plan departure 1).
- **FR-008** Those tables MUST refuse `delete` and MUST refuse `set` of an
  identity field (`taskId`, `occurrence`, `tagId`) (← design Q2).
- **FR-009** TaskTag MUST carry an `attached` boolean that detach sets to
  `false` (← design Q5; resolves the design's open thread).
- **FR-010** The server MUST reject a task whose resulting `rrule` fails
  `parseRrule`, whose `rrule` is set without `dtstart`, or whose `rrule` is set
  while `parentId` is set (← design Q14; ADR 0009).
- **FR-011** The server MUST reject a `task_occurrence.state` other than
  `open`, `done`, `skipped` (← design Q4).
- **FR-012** Pruning a tombstoned task or tag MUST delete its task occurrences
  and TaskTag rows by cascade and MUST NOT be blocked by them (← design Q13).
- **FR-013** A snapshot (`since: 0`) MUST omit task occurrences and TaskTag
  rows whose task or tag is tombstoned (← design Q13; plan departure 4).
- **FR-014** ADR 0002, 0005, 0006, 0009, 0013, the domain design (§2, §4) and
  `.claude/CLAUDE.md` trap 6 MUST describe the new behaviour (← design
  "Follow-up to the records").

### Edge cases

- `occurrence: null` created twice from two devices → one row (FR-006, T005)
- uppercase `taskId` in the fields → the derivation lowercases, the id still
  matches (FR-002, FR-006, T001, T005)
- `2026-02-30`, `2026-9-28`, `2026-09-28T00:00:00Z` in a date field →
  rejected (FR-004, T003)
- `set dtstart null` on a recurring task → rejected (FR-010, T006)
- `set parentId` on a recurring task → rejected (FR-010, T006)
- both `COUNT` and `UNTIL`, `UNTIL` with a time, lowercase `freq=daily` →
  rejected by the parser (FR-001, T001)
- a create that loses on every field → `superseded`, row unchanged, version
  unchanged (FR-007, T005)
- a TaskTag tombstone left from before this task → still pruned (FR-012, T007)
- a live task with a tombstoned tag → its TaskTag row is not in the snapshot
  (FR-013, T007)

### Definition of Done

- **SC-001** Scenario 1 and 2 reproduce against a running server with two
  `POST /sync` calls each.
- **SC-002** `pnpm --filter @todoer/specs test` passes every vector in
  `vectors/ids.json`, and every rule in `vectors/rrule.json` parses.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002, FR-003] runtime code and vectors in the spec
      package — plan Task 1
- [x] T002 [FR-005] `task_occurrence` in the contract, codegen — plan Task 2
- [x] T003 [FR-004] dates travel as `YYYY-MM-DD` — plan Task 3
- **Checkpoint:** a task with `dueOn` round-trips through `/sync`.
- [x] T004 [FR-005, FR-009, FR-012] schema and migration, table wiring —
      plan Task 4
- [x] T005 [FR-006, FR-007, FR-008, FR-009] deterministic ids, create-merge,
      no delete — plan Task 5
- **Checkpoint:** scenario 1 and 2 pass as service tests.
- [x] T006 [P] [FR-010, FR-011] row rules for recurrence and state — plan
      Task 6
- [x] T007 [FR-012, FR-013] prune by cascade, snapshot hides orphans — plan
      Task 7
- [x] T008 [FR-014] records and docs — plan Task 8
- **Checkpoint:** every FR ticked, the four gates green on the PR.

### Open questions

None.
