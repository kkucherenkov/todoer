## T-2026-09-26-prune-and-snapshot — Keep the tombstone-retention contract

- Created: 2026-09-26
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [docs/specs/2026-09-26-plan-b-outbox-offline-design.md](../../../docs/specs/2026-09-26-plan-b-outbox-offline-design.md)
  (the B2 half: Q9, Q10, Q11, Q12); ADR 0013, ADR 0016
- Plan: [docs/plans/2026-09-26-plan-b2-pruning-and-snapshot.md](../../../docs/plans/2026-09-26-plan-b2-pruning-and-snapshot.md)

### Goal

The server declares `410 Gone` and never sends it: nothing prunes tombstones,
so the retention window ADR 0013 calls a contract with offline clients does
not exist, and a client that misses a deletion has no way back. Separately, two
overlapping writes of one user can make a pull skip a row permanently (ADR
0016), and the client outbox of plan B1 will make such overlaps routine. This
task makes the server keep the contract and closes the race before B1 ships.

### Scenarios

1. **Given** two writes of one user in flight at once, **When** a pull runs
   between their commits, **Then** the next pull from that cursor returns both
   rows.
2. **Given** a task deleted more than 90 days ago, **When** the server has run
   for a day, **Then** the row is gone from the database and the user's prune
   watermark equals its `seq`.
3. **Given** a client whose cursor predates that pruning, **When** it pulls,
   **Then** it gets `410`; **When** it repeats with `since: 0`, **Then** it
   gets every live row and a cursor the next pull accepts.

### Requirements

- **FR-001** The server MUST take the per-user write lock
  `pg_advisory_xact_lock(1, hashtext(user_id))` as the first statement of
  every write transaction (← design Q12; ADR 0017).
- **FR-002** A pull with `0 < since < watermark` MUST be answered `410 Gone`;
  `since = watermark` MUST NOT (← design Q9; ADR 0013).
- **FR-003** A pull with `since: 0` MUST return live rows only, MUST never be
  answered `410`, and its cursor MUST be at least the watermark and at least
  every `seq` among the user's rows (← design Q11).
- **FR-004** Operations sent in a request that is answered `410` MUST replay
  their stored outcomes when resent (← plan, "Where this plan departs", 3).
- **FR-005** The server MUST delete tombstones of `task`, `project`, `tag` and
  `task_tag` older than 90 days, in-process, at startup and daily, and MUST
  never delete completions (← design Q9, Q10; ADR 0013).
- **FR-006** Pruning MUST keep a tombstone another row still references and
  MUST NOT fail because of one (← design "What is pruned").
- **FR-007** Pruning MUST raise only the pruned user's watermark, and MUST
  never lower it (← design Q9).
- **FR-008** Each user MUST be pruned in one transaction under the FR-001 lock;
  there MUST be no instance-wide lock (← plan, "Where this plan departs", 1).
- **FR-009** `openapi.yaml` MUST document `since: 0` and `410` before the
  backend implements them, with the generated client in its own commit
  (← `CLAUDE.md`, "Spec first").
- **FR-010** No ADR, spec or README MAY still describe `GET /sync/snapshot` or
  an open ADR 0016 race (← design Q11, Q12; working agreement rule 3).

### Edge cases

- A snapshot for a user whose newest live row is older than the watermark →
  cursor at the watermark, no `410` loop (FR-003, T003).
- A tombstoned project a live task still names, a tombstoned parent with a
  tombstoned subtask, a live `TaskTag` on a tombstoned tag → the referenced
  one is kept, the parent and subtask go in one run (FR-006, T004).
- Operations sent with a stale cursor → applied, then `410`; resent with
  `since: 0` → `duplicate`, nothing created twice (FR-004, T003).
- A quiet user while another user is pruned; a cursor exactly at the
  watermark → no `410` (FR-002, FR-007, T003, T004).
- A `set` on project P racing a `create` of a task in P → both applied, no
  `40P01` (FR-001, T001).

### Definition of Done

- **SC-001** Each scenario and edge case above has a DB-backed test in
  `apps/backend` that passes, and the scenario tests were seen failing first.
- **SC-002** `sh scripts/walking-skeleton.sh` prints `walking skeleton passed`
  against a server whose startup pruning run logged no error.
- **SC-003** `ugrep -rn -i 'sync/snapshot' --include='*.md' .` finds the
  endpoint only as a rejected option in the plan-B design doc, in the
  historical body of superseded ADR 0016, in `docs/plans/`,
  `specs/tasks/done/`, and in this entry's own requirement text.
- [ ] every FR has a test that failed before the code made it pass (FR-009 and
      FR-010 are documentation: checked by `pnpm spec:validate` and SC-003)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] Per-user write lock and its two tests — plan Task 1,
      `apps/backend/src/sync/user-lock.ts`, `sync.service.ts`
- **Checkpoint:** scenario 1 holds; the backend suite is green.
- [x] T002 [FR-009] Contract for `since: 0` and `410`, then codegen — plan
      Task 2, `packages/specs/openapi/openapi.yaml`
- [x] T003 [FR-002] [FR-003] [FR-004] Watermark column, `410`, the snapshot —
      plan Task 3, `apps/backend/prisma/schema.prisma`, `sync.service.ts`
- **Checkpoint:** a stale cursor gets `410` and `since: 0` recovers, against a
  hand-set watermark.
- [x] T004 [FR-005] [FR-006] [FR-007] [FR-008] Pruning service — plan Task 4,
      `apps/backend/src/sync/prune.service.ts`
- **Checkpoint:** scenarios 2 and 3 hold end to end; SC-002 holds.
- [x] T005 [FR-010] ADR 0017, ADR 0013/0012/0016, spec, README, design doc —
      plan Task 5
- **Checkpoint:** SC-003 holds; PR open with all four gates green.

### Open questions

None.
