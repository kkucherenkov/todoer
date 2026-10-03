## T-2026-10-03-core-reparent — Re-parent a task in the client core

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q6, Risks)
- Plan: docs/plans/2026-10-03-plan-t1-reparent.md

### Goal

The TUI indents and outdents tasks. The server already accepts
`set parentId` under the two-level rule; the client core has no operation
for it, and a refused indent must not reach the outbox.

### Scenarios

1. **Given** top-level tasks `a` and `b`, **When** `b` is indented under
   `a`, **Then** one `set parentId a` is queued and `b` lists as `a`'s
   subtask.
2. **Given** subtask `b` of `a`, **When** it is outdented, **Then** one
   `set parentId null` is queued.
3. **Given** two processes on one replica file, **When** both flush at once,
   **Then** every queued operation reaches the server and both outboxes end
   empty.

### Requirements

- **FR-001** The core MUST set or clear a task's parent with one
  `set parentId` (← design Q6)
- **FR-002** The core MUST refuse, queuing nothing: a task as its own parent,
  a parent that has a parent, a task with live subtasks, a recurring task
  under a parent (← design Q6; server rules)
- **FR-003** A resend of the same `opId` MUST only flush (← ADR 0015 §4)
- **FR-004** The engine MUST accept `kind: 'reparent'` (← design Q6)
- **FR-005** Two stores on one file flushing at once MUST leave no operation
  unsent and both outboxes empty (← design Risks)

### Edge cases

- The parent is already the requested one → nothing queued, still flushes
  (FR-001, T001)
- Unknown or deleted task or parent → `no task <id>` (FR-002, T001)
- A tombstoned subtask does not count as a live subtask (FR-002, T001)

### Definition of Done

- **SC-001** an indent and an outdent from the engine show in `viewTasks`
  at once, offline included
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] [FR-002] [FR-003] `reparent` — plan Task 1
- [x] T002 [P] [FR-005] two stores, one file — plan Task 2
- [ ] T003 [FR-004] engine write kind, after T0 merges — plan Task 3
- [ ] T004 documents, gates, PR — plan Task 4
- **Checkpoint:** the TUI can call `engine.handle({ kind: 'reparent', … })`

### Departures

- T002: plan Task 2's fake server answered `applied` to every sight of an
  opId. Two stores flushing at once each send the shared outbox, so every op
  reached it twice. The fake now answers `duplicate` after the first sight,
  as the backend's `replay` does, and the test pins it: each op applied once,
  sent at most twice. The design doc had made "sent twice" a trigger for a
  write lock in `flush`; the coordinator ruled the duplicate harmless (ADR
  0005) and a lock across a network call harmful, and the Risks entry now
  says so.

### Open questions

None.
