## T-2026-10-21-web-redesign-list — Group the list by project and show each parent's children

- Created: 2026-10-21
- Owner: claude
- Status: done
- Completed: 2026-10-21
- Result: https://github.com/kkucherenkov/todoer/pull/52
- Blockers: —
- Spec: [web redesign context](T-2026-10-03-web-redesign-context.md),
  FR-004–FR-007; maintainer-approved rules in the
  [web UX redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  "Утверждённые правила и ограничения"; the outline rules of
  [`docs/design/mockups/UX.md`](../../../docs/design/mockups/UX.md),
  "Finalized project → task → subtask outline"
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  stage 3 (track W3)

### Goal

The list draws the view's items flat, so a parent and its subtasks are
scattered, a subtask the filter left out is invisible, and progress shows only
in the drawer. The engine now publishes every item's live direct children
(`Item.children`, with `inView`) and the progress over all of them
(`Item.subtasks`, T-2026-10-21-core-redesign-projections). This task draws
them: a project outline in the list, a disclosure of all children on a list
row and a board card, and the outline's manual order and reparenting through
the existing engine writes. Nothing is counted or closed in the web that the
engine does not publish.

### Scenarios

1. **Given** tasks in two projects and some in none, **When** the list opens,
   **Then** they stand in one group per project, sorted by name, then a
   "No project" group; each group header counts the listed tasks in it.
2. **Given** a parent in the view with one child in the view and one outside
   it, **When** the list opens, **Then** the matching child is one indented
   row under its parent, the other is a link marked "Outside this filter",
   the parent shows `0/2`, and the group counts two tasks.
3. **Given** a child in the view whose parent is not, **When** the list opens,
   **Then** the child is a row of its own project's group with a link to the
   parent.
4. **Given** an expanded parent, **When** its disclosure is pressed, **Then**
   its children hide, the counts stay, and the fold holds when the layout
   switches to the board and back.
5. **Given** a contextual child, **When** its check is pressed and pressed
   again, **Then** the parent's progress goes up and back down, on the parent
   occurrence for a recurring parent.
6. **Given** a board, **When** it shows a parent and its child, **Then** the
   child is its own card in its own status column with a parent link, and the
   parent card's disclosure lists every child, marked "On this board", "Closed"
   or "Outside this filter"; column counts are cards only.
7. **Given** a manual list, **When** a root is moved by drag or by Move
   up/down, **Then** it moves among the roots of its group; a child moves
   among its siblings; neither changes parent or project.
8. **Given** a top-level row under another one, **When** Indent is chosen,
   **Then** it becomes a subtask of the root above it; Outdent makes a
   subtask top-level again; a refusal of the core shows as the failure toast.

### Requirements

- **FR-001** The list MUST group the view's top-level rows by their project,
  projects by name and "No project" last; a listed child whose parent is
  listed MUST appear once, nested under the parent, whatever its own project;
  a listed child whose parent is not listed MUST stand in its own project's
  group with a link to the parent (← context FR-004; plan stage 3).
- **FR-002** A parent's disclosure MUST show every live direct child from
  `Item.children`: the listed ones as rows, the others as contextual links
  labelled "Closed" (done or skipped, context FR-005) or "Outside this
  filter". Group counts MUST count listed tasks only, folded ones included,
  contextual links never. Parents start expanded; the fold is transient and
  kept across layouts, and adding a subtask unfolds its parent (← context
  FR-004; UX.md "One unified disclosure").
- **FR-003** A list row and a board card MUST show a parent's progress from
  `Item.subtasks`, never counted from the listed items; the label says
  closed, not done-only (← context FR-005).
- **FR-004** The board MUST keep a child as its own card with its own status;
  a parent card's disclosure MUST list every live direct child, marked
  "On this board", "Closed" or "Outside this filter"; contextual children add
  no card and no count (← plan stage 3; context FR-004).
- **FR-005** Manual order MUST keep working by drag and by Move up/down,
  among outline siblings: a group's top-level rows, or one parent's listed
  children; a drop elsewhere is ignored, and no move reparents. The board
  keeps Move to, drag between and within columns, column management and the
  redistribution confirm (← plan stage 3; UX.md "Core alignment").
- **FR-006** Ticking a contextual child MUST be the engine's `mark`
  (`done`/`undo`), with `on` set to the parent's occurrence when the parent
  repeats (ADR 0009); Indent and Outdent MUST be the engine's `reparent`;
  every refusal shows through the existing failure toast. A new child's
  project comes from core `add` (← context FR-006).
- **FR-007** Every new control MUST have EN and RU text and an accessible
  name; the disclosure is a button with `aria-expanded` and
  `aria-controls`; every drag has a keyboard path (← context FR-007).

### Edge cases

- A child in another project than its listed parent → nested under the
  parent, its own `#project` shown (FR-001, T002)
- Closed child of a one-off parent → a "Closed" link, its check reopens it
  through the same check (FR-002, FR-006, T002, T004)
- Recurring parent → the check carries `on` = the parent's occurrence; an
  ended series has no occurrence and sends none (FR-006, T004)
- All children outside the view → the parent row is a root with only
  contextual links and progress (FR-002, T002)
- A drop of a root among another root's children → read as a drop after that
  root; a child dropped outside its siblings → ignored (FR-005, T002)
- Indent of a task with children, a recurring task, or under nothing →
  disabled when the row knows it, else the core's refusal (FR-006, T004)
- Folded parent → its hidden listed children still count, and the
  disclosure's name says how many it hides (FR-002, FR-007, T002)
- A subtask added in the drawer under a folded parent → the parent unfolds
  (FR-002; UX.md "Creation unfolds the parent immediately", T002)
- A drag over another group or outside the row's siblings → no insertion
  line and no drop (FR-005, T002)
- A nested row → no parent link, the parent is the row above (FR-001, T002)

### Definition of Done

- **SC-001** Scenarios 1–8 hold in the app, EN and RU.
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002, FR-005] The outline as a pure function: groups,
  nesting, contextual children, counts, siblings and the drop/step anchors,
  failing-first unit spec — `apps/web/app/utils/outline.ts`
- [x] T002 [FR-001–FR-003, FR-005, FR-007] Draw it in the list: group
  headers, nested rows, disclosure with progress, contextual links, per-group
  drag and sibling Move up/down — `TaskList.vue`, `TaskGroup.vue`, `TaskRow.vue`,
  `ChildLinks.vue`, `useFolded.ts`, locales
- [x] T003 [P] [FR-003, FR-004, FR-007] The board card's disclosure and
  progress — `KanbanCard.vue`
- [x] T004 [FR-006] Contextual check, Indent and Outdent through `mark` and
  `reparent` — `ChildLinks.vue`, `TaskList.vue`, `TaskRow.vue`
- [x] T005 [FR-001–FR-007] Failing-first e2e of scenarios 1–8 —
  `apps/web/e2e/list.spec.ts`, `apps/web/e2e/kanban.spec.ts`
- [x] T006 Gates, plan stage 3 checkboxes, DESIGN/plan claims that turned
  false — `docs/plans/2026-10-03-plan-web-ux-redesign.md`
- **Checkpoint:** a parent and all its children are visible and operable in
  list and board, reading only what the engine publishes.

### Open questions

- None blocking. Sidebar and header counts belong to W2/C2, the drawer's
  checklist to W4.
