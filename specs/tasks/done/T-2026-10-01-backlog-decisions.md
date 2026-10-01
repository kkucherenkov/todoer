## T-2026-10-01-backlog-decisions — Settle #390, #391, #361 and #407

- Created: 2026-10-01
- Owner: claude
- Status: done
- Blockers: —
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Backlog decisions, Q4–Q7); tuxedo #390, #391, #361, #407
- Plan: [docs/plans/2026-10-01-plan-backlog-fixes.md](../../../docs/plans/2026-10-01-plan-backlog-fixes.md)
- Completed: 2026-10-01

### Goal

Four open items waited on decisions the client-shells interview made. A
repeated `done` silently rewrote completion; deleting a recurring parent left
subtasks that later looked one-off and broke ADR 0009; trap 6 depended on
memory; behind a reverse proxy the per-IP rate limits were instance-wide.

### Scenarios

1. **Given** a one-off task marked done, **When** `done` runs again, **Then**
   it exits 0 and sends nothing; `skip` exits 2 asking for `undo` first.
2. **Given** a task with a live subtask, **When** a client deletes the task
   alone, **Then** the delete is rejected; deleting the subtask first in the
   same batch succeeds.
3. **Given** a migration containing `DROP SEQUENCE "change_seq"`, **When** CI
   runs, **Then** Shell tests fail naming the file.
4. **Given** `TRUST_PROXY=1` behind one proxy, **When** clients log in,
   **Then** the limits count each client's own address.

### Requirements

- **FR-001** The CLI MUST treat the same mark on a closed one-off occurrence
  as a no-op (exit 0, nothing sent) and refuse switching done and skipped with
  exit 2 (← Q4).
- **FR-002** The server MUST reject deleting a task that has live subtasks; a
  migration MUST tombstone live subtasks of already tombstoned parents (← Q5).
- **FR-003** CI MUST fail when a migration drops `change_seq` or a `seq`
  default (← Q6).
- **FR-004** `TRUST_PROXY` (hop count or address list, unset by default) MUST
  set express's `trust proxy`; invalid values MUST refuse to start (← Q7).

### Edge cases

- a recurring task's closed occurrence named with `--on` → same rules
  (FR-001, T001)
- a parent whose subtasks are all tombstoned → delete applied (FR-002, T002)
- the repository's existing migrations → guard passes (FR-003, T003)
- `TRUST_PROXY=true` → refused (FR-004, T004)

### Definition of Done

- **SC-001** the four scenarios pass.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] marks on closed one-off tasks — plan Task 1
- [x] T002 [FR-002] no deleting a task with live subtasks — plan Task 2
- [x] T003 [FR-003] CI guard for trap 6 — plan Task 3
- [x] T004 [FR-004] TRUST_PROXY — plan Task 4
- **Checkpoint:** scenarios 1–4 pass; the four gates green on the PR.

### Open questions

None.
