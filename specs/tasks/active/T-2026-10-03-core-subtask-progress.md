## T-2026-10-03-core-subtask-progress — Count subtask progress on every listed task

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: `docs/specs/2026-10-03-tui-client-design.md` (the outline);
  `docs/proposals/2026-10-03-web-ux-redesign.md` (hierarchy)
- Plan: `docs/plans/2026-10-03-plan-t1b-subtask-progress.md`

### Goal

A view of open tasks does not list closed subtasks, so a client cannot count a
parent's progress from the view. The core counts it once per listing and puts
it on every item, so the TUI's outline and the web redesign show "2/5" without
reading the closed subtasks themselves.

### Scenarios

1. **Given** a parent with two live subtasks and one tombstoned, **When** a
   view lists it, **Then** it carries `{ done: 0, total: 2 }`
2. **Given** one of those subtasks is closed, **When** the view is listed
   again, **Then** the parent carries `{ done: 1, total: 2 }`
3. **Given** a task without subtasks, **When** it is listed, **Then** its
   progress is null

### Requirements

- **FR-001** Every listed `Item` MUST carry `subtasks: { done, total }` over
  its live subtasks, or null when it has none (← design doc, T1b)
- **FR-002** `done` MUST count subtasks closed at the parent's current
  occurrence, the same as `taskDetails`' checklist (← ADR 0009)
- **FR-003** Tombstoned subtasks MUST NOT count (← plan T1b)

### Edge cases

- recurring parent whose series ended → `done` is 0, the rule `taskDetails`
  applies; not tested separately (FR-002, T001)
- a subtask outside the view's filter → still counted (FR-001, T001)

### Definition of Done

- **SC-001** the progress a listing reports equals the drawer checklist's
  closed/total for the same task
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] [FR-002] [FR-003] `Item.subtasks` counted in one pass per
      listing (plan Task 1) — `packages/client-core/src/operations.ts`
- [ ] T002 [FR-001] gates and PR (plan Task 2)
- **Checkpoint:** client-core, web and CLI build, typecheck and test green

### Departures from the plan

- `TaskDetails` already has `subtasks: Subtask[]` (the drawer checklist, read
  by the web's `SubtaskList` and plan T3c). Intersecting it with
  `Item['subtasks']` would make the field unsatisfiable, so `TaskDetails` is
  `Omit<Item, 'subtasks'> & { subtasks: Subtask[] }`: the drawer keeps the
  checklist, whose progress is its own closed/total. The plan said
  `TaskDetails` inherits the count.

### Open questions

—
