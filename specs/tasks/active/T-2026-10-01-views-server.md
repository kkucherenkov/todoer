## T-2026-10-01-views-server — Sync statuses and views, and share the filter evaluator

- Created: 2026-10-01
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-views-design.md](../../../docs/specs/2026-10-01-views-design.md)
  (Q1–Q18); tuxedo #406
- Plan: [docs/plans/2026-10-01-plan-v2-views-server.md](../../../docs/plans/2026-10-01-plan-v2-views-server.md)

### Goal

Views are synced data: a view built on one device must exist on all of them,
and every client must pick the same tasks for it and put each task in the same
kanban column. The sync contract has neither a place to store views and
statuses nor a portable filter. This task adds both tables and the three task
fields to the contract and the server, and puts the filter check, the
evaluator and the board rule in `@todoer/specs` with shared vectors, so the
CLI (plan V1) and the GUI clients build on one definition.

### Scenarios

1. **Given** a view written on one device, **When** another device pulls,
   **Then** it receives the view with the same filter object.
2. **Given** a view whose filter is malformed or too large, **When** a client
   writes it, **Then** the operation is rejected with the reason and nothing
   is stored.
3. **Given** a filter "due before today" and today 2026-10-01, **When** a
   client evaluates a task due 2026-09-30, **Then** it matches; due
   2026-10-01, it does not.
4. **Given** a recurring task whose current occurrence is closed, **When** a
   board places it, **Then** it shows in the completing status; with an open
   occurrence and `statusId` at the completing status, in the first
   non-completing status.
5. **Given** a status deleted 91 days ago that a live task still references,
   **When** the pruning job runs, **Then** the status tombstone is kept.

### Requirements

- **FR-001** `@todoer/specs` MUST export `filterProblem`, which accepts
  exactly the filter grammar of the plan's Global Constraints and refuses
  everything else with a reason naming the path (← Q6, Q16–Q18; departures 1,
  4).
- **FR-002** `@todoer/specs` MUST export `matches(filter, task, today)` and
  `addDays`, pinned by `vectors/filters.json` (← Q6; departure 2).
- **FR-003** `@todoer/specs` MUST export `displayStatus`, pinned by
  `vectors/statuses.json` (← Q7–Q9; departure 3).
- **FR-004** The contract MUST accept `status` and `view` as sync tables and
  describe their fields and the three task fields (← Q1, Q2, Q13).
- **FR-005** The server MUST store and return `status` and `view` rows and
  the task fields `statusId`, `originTaskId`, `originOccurrence` through
  `POST /sync`, with references checked for ownership (← Q1, Q2, Q8, Q13;
  departure 5).
- **FR-006** The server MUST reject a view whose name, layout, sort, rank or
  filter is invalid, a status whose name, rank, completing or color is
  invalid, and a task with only one of `originTaskId`/`originOccurrence`
  (← Q6; departure 6).
- **FR-007** Status and view tombstones MUST be pruned under the retention
  contract — a status only once no task references it — and account deletion
  MUST purge both tables (← ADR 0013, plan D).
- **FR-008** The walking skeleton MUST write a status and a view over HTTP,
  and the domain design and views design MUST describe what shipped.

### Edge cases

- a filter with 10 000 leaves → rejected, `more than 256 nodes` (FR-001,
  FR-006, T001, T005)
- a task `set statusId` to a tombstoned status → applied (FR-005, T005)
- `statusId` of another user's status → rejected (FR-005, T005)
- day offsets across month and year ends and 29 February (FR-002, T001)
- two completing statuses → the lowest id is completing (FR-003, T002)
- an account with statuses, views and tasks pointing at them → deletion
  succeeds (FR-007, T006)

### Definition of Done

- **SC-001** `sh scripts/walking-skeleton.sh` writes a status and a view and
  sees an invalid filter rejected with its reason.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001, FR-002] filter check, evaluator, vectors — plan Task 1
- [ ] T002 [FR-003] the board column rule — plan Task 2
- [ ] T003 [FR-004] the contract — plan Task 3
- [ ] T004 [FR-005] schema, migration, shared spec reset — plan Task 4
- [ ] T005 [FR-005, FR-006] sync the new tables — plan Task 5
- [ ] T006 [FR-007] prune and purge — plan Task 6
- [ ] T007 [FR-008] end to end and documents — plan Task 7
- **Checkpoint:** scenarios 1–5 pass; the four gates green on the PR.

### Open questions

None.
