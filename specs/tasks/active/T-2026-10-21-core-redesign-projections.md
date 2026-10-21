## T-2026-10-21-core-redesign-projections — Give the redesigned web the projections it reads

- Created: 2026-10-21
- Owner: antigravity
- Status: in-review
- Blockers: —
- Spec: [web redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  task C1; [T-2026-10-03-web-redesign-context](T-2026-10-03-web-redesign-context.md)
  FR-001, FR-004
- Plan: none; the steps below are the whole change

### Goal

The redesign switches List, Kanban and Calendar without saving the view, and
expands a parent to every live child, including children the filter left
out. The engine supports neither: `publishView` picks the projection from the
saved `layout` and the `watch` command carries no layout, so a transient
calendar gets list items without placements. `taskDetails` gives a child only
its id, title and closed flag, not enough to draw its row. Both belong in the
core, so the web does not grow a second reading of the replica.

### Scenarios

1. **Given** a saved list view, **When** a tab watches it with layout
   `calendar` and a span, **Then** it receives calendar items and
   placements; the stored view still says `list`.
2. **Given** the same tab, **When** it watches with no layout, **Then** it
   receives the saved layout's projection.
3. **Given** a parent in the filter with one child in it and one outside,
   **When** the parent is expanded, **Then** both children arrive with the
   fields a row needs, the outside one marked, and the filter's count is
   unchanged.
4. **Given** tasks with no status, **When** the statuses' task counts are
   read, **Then** they land in the first column's count, where the board
   shows them (tuxedo 432).

### Requirements

- **FR-001** The `watch` command MUST accept an optional layout override; a
  valid override selects the projection, an invalid one or none falls back
  to the saved layout (← context FR-001, FR-002).
- **FR-002** The published view MUST name the layout it was projected with
  (← context FR-001).
- **FR-003** The core MUST give a watched item's live direct children with
  the fields a list row and a board card show, each marked as matching the
  filter or not, without changing the filter's count (← context FR-004,
  FR-005).
- **FR-004** `catalog.statuses[].tasks` MUST count tasks by the status they
  are displayed under, so a task with no status counts in the first
  (← tuxedo 432).

### Edge cases

- Override `calendar` without a span → the same "no span yet" reply the
  saved calendar gives today (FR-001, T002)
- Override equal to the saved layout → no difference from no override
  (FR-001, T002)
- A closed or skipped child of a recurring parent → follows the occurrence
  axis of ADR 0009, as `Item.subtasks` does (FR-003, T003)
- A child in another project → keeps its own project in the row (FR-003,
  T003)

### Definition of Done

- **SC-001** A web tab can show any saved view in any of the three layouts
  and expand any parent to all its children, reading only what the engine
  publishes.
- [ ] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-003] Set the child row's shape per coordinator brief before writing
  it; it is a public engine contract —
  `packages/client-core/src/engine-protocol.ts`
- [x] T002 [FR-001, FR-002] Layout override on `watch`, failing-first engine
  spec — `packages/client-core/src/engine.ts`,
  `packages/client-core/src/engine-protocol.ts`
- [x] T003 [FR-003] Children outside the filter, failing-first spec —
  `packages/client-core/src/operations.ts`
- [x] T004 [P] [FR-004] Status counts by display status —
  `packages/client-core/src/operations.ts`
- **Checkpoint:** W1 can add the calendar mode and W3 the expansion without
  touching the core.

### Open questions

- [Resolved: FR-003 child row shape set by coordinator brief in T001 as ChildItem: id, title, closed, statusId, projectId, priority, scheduledOn, dueOn, inView.]
