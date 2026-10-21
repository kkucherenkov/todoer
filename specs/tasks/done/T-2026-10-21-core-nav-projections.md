## T-2026-10-21-core-nav-projections — Give the web navigation its built-in views and counts

- Created: 2026-10-21
- Owner: claude
- Status: done
- Completed: 2026-10-21
- Result: https://github.com/kkucherenkov/todoer/pull/50
- Blockers: —
- Spec: [web redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  stage 2 and the rule "Сегодня/Предстоящие используют scheduled OR due";
  W2's BLOCKED-ON-CORE report, 2026-10-21
- Plan: none; the steps below are the whole change

### Goal

W2 puts All open, Today, Upcoming and every project in the web's navigation,
each with a count. The engine resolves `watch.view` only as `all` or a saved
view id, and publishes no counts, so the web would have to filter the replica
a second time. Built-in views are plain filters the core already evaluates;
the engine needs to name them and count them.

### Scenarios

1. **Given** a task scheduled yesterday and one due today, **When** a tab
   watches `today`, **Then** both arrive; a task dated tomorrow does not.
2. **Given** a task due tomorrow, **When** a tab watches `upcoming`, **Then**
   it arrives.
3. **Given** a project with two open tasks, **When** a tab watches
   `project:<id>`, **Then** both arrive, in any layout.
4. **Given** a parent and its child both due today, **When** the catalog is
   read, **Then** `today` counts 2, and a task both scheduled and due today
   counts once.
5. **Given** a tab on `today` at 23:59, **When** the next publish happens
   after midnight, **Then** items and counts use the new date.

### Requirements

- **FR-001** `watch.view` MUST accept `today`, `upcoming` and `project:<id>`
  besides `all` and saved view ids; each resolves to a built-in `ViewSpec`
  (← plan stage 2).
- **FR-002** Today MUST match tasks whose current occurrence is scheduled or
  due on or before the local today; Upcoming those scheduled or due after it
  (← plan rules; W2 report item 4).
- **FR-003** The catalog MUST publish `nav: { key, count }[]` for `all`,
  `today`, `upcoming` and each live project, each count being the number of
  unique task ids its own projection yields, subtasks included
  (← plan stage 2, W2 report items 2–3).
- **FR-004** Items and counts MUST be computed from the publish's own
  `localDate(now())`, so the existing visible-tab tick and focus return carry
  a day rollover (← W2 report item 5).

### Edge cases

- `project:<id>` of a deleted or unknown project → the `deleted` problem a
  removed saved view gets (FR-001)
- A task in both Today and Upcoming (scheduled today, due next week) → in
  both; the views are filters, not a partition (FR-002)
- No projects → `nav` holds the three built-ins (FR-003)
- Signed out → `nav` is empty, as the rest of the catalog (FR-003)

### Definition of Done

- **SC-001** The web can render the navigation with counts and open any of
  its entries reading only what the engine publishes.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] Built-in specs `TODAY_OPEN`, `UPCOMING_OPEN`,
  `projectView(id)` next to `ALL_OPEN`, resolved by `builtInView`; `viewSpec`
  resolves their keys — `packages/client-core/src/operations.ts`,
  `engine.ts`, `engine-protocol.ts` (key constants `TODAY`, `UPCOMING`,
  `PROJECT_PREFIX`; `PROJECT` is the quick-add regex)
- [x] T002 [FR-003] `catalog.nav` from the same projections —
  `operations.ts`
- [x] T003 [FR-004] Rollover spec with a fake clock — `engine.spec.ts`
- [x] T004 Docs: the engine section of the views design names the keys —
  `docs/specs/2026-10-01-views-design.md`
- **Checkpoint:** W2 builds the navigation without touching the core.
