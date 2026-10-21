## T-2026-10-21-web-redesign-shell — Unify the web shell and transient layouts

- Created: 2026-10-21
- Owner: Codex (Web)
- Status: in-progress
- Blockers: C1 is not on `origin/main`; transient Calendar remains unavailable for non-calendar saved views
- Spec: [web redesign context](T-2026-10-03-web-redesign-context.md), FR-001–003
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 1

### Goal

The web needs one accessible shell in which List, Kanban and Calendar are
presentations of the current filter rather than separate destinations or
implicit edits to a saved view. Its visual states must use the approved theme,
and URL history and the task drawer must preserve the user's current context.

### Scenarios

1. **Given** a saved list view, **When** the user selects Kanban, reloads, and
   navigates Back and Forward, **Then** the same filter follows the layout in
   the URL and the saved view remains list.
2. **Given** a missing or invalid layout override, **When** a view opens,
   **Then** its saved layout is shown and an invalid value is removed with
   history replacement rather than a new history entry.
3. **Given** the mode switch has focus, **When** the user presses an arrow,
   Home or End, **Then** selection and focus move within one three-mode icon
   group whose names and tooltips follow EN/RU.
4. **Given** a task was opened from a list row, board card or calendar item,
   **When** the drawer closes, **Then** all non-task query parameters survive
   and focus returns to the initiator or a stable workspace fallback.
5. **Given** a saved calendar view, **When** Calendar is active, **Then** its
   `mode` and `at` query survive layout and drawer navigation; a non-calendar
   saved view does not offer transient Calendar until C1 supplies its
   projection.

### Requirements

- **FR-001** Web MUST use the approved semantic theme tokens, hover and
  visible-focus treatment in the Nuxt UI configuration and application CSS
  (← redesign plan stage 1; context FR-007 accessibility clause).
- **FR-002** Web MUST render one page header with an accessible List/Kanban/
  Calendar icon group at its top right, active state, roving focus, localized
  names/tooltips and 44 px mobile targets; choosing a mode MUST NOT save the
  view (← context FR-001; redesign plan stage 1).
- **FR-003** Web MUST read a valid `layout=list|kanban|calendar` override from
  the URL, fall back to the saved layout when absent, ignore and replace an
  invalid override, push user switches, preserve every unrelated query
  parameter, and discard the old override when navigating to another view
  (← context FR-002; redesign plan stage 1).
- **FR-004** Web MUST keep transient Calendar unavailable unless the saved
  view is calendar while C1's watch-layout projection contract is absent;
  saved calendar views MUST retain `mode`/`at` and their span watch
  (← W1 brief option (a); core C1 dependency).
- **FR-005** Closing the task drawer MUST remove only `task`, preserve the
  filter/layout/calendar query, and restore focus to the opening control or,
  if it disappeared, the nearest task surface or workspace heading
  (← context FR-003).

### Edge cases

- Repeated `layout` query values or a non-string value → treat as invalid and
  replace it away without changing the saved view (FR-003, T002).
- Switching back to the saved layout → remove the redundant override by push,
  so reload still derives the saved default (FR-003, T002).
- A saved calendar opened with `layout=list|kanban` → no span watch; returning
  to Calendar restores a valid span from the surviving `mode`/`at` query
  (FR-003–004, T002).
- Drawer opener disappears after a task leaves the filter → focus the nearest
  remaining task surface, then the workspace heading (FR-005, T003).
- Mobile mode controls and drawer close control → at least 44 by 44 CSS pixels
  (FR-002, FR-005, T004).

### Definition of Done

- **SC-001** A person can switch supported layouts, reload and traverse browser
  history without changing the saved view or losing drawer/calendar context.
- **SC-002** EN/RU keyboard users can identify and operate the mode group and
  return from the drawer to a meaningful focus target at desktop and mobile
  widths.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001–005] Trace the current shell, route/watch and drawer focus
  contracts; confirm whether C1 landed before choosing the Calendar path —
  `apps/web/app/`, `origin/main`
- [ ] T002 [FR-002–004] Add failing-first route/history/watch tests and
  implement transient layout resolution without saved-view writes —
  `apps/web/app/utils/`, `apps/web/app/components/`, `apps/web/app/pages/`
- [ ] T003 [FR-005] Add failing-first focus/context tests and restore drawer
  focus with a stable fallback — `apps/web/app/composables/`,
  `apps/web/app/components/TaskDrawer.vue`
- [ ] T004 [FR-001–002] Apply the approved Nuxt UI theme and responsive shell,
  then update Playwright control-name contracts — `apps/web/app/app.config.ts`,
  `apps/web/app/assets/css/main.css`, `apps/web/e2e/`
- [ ] T005 [FR-001–005] Update affected documentation and run the Web tests,
  typecheck, workspace lint and production build — `docs/`, `specs/tasks/`
- **Checkpoint:** W1's shell and supported transient layouts are tested and
  production-built; Calendar's remaining dependency is explicitly C1.

### Open questions

None. The brief selects saved-calendar-only behavior when C1 has not landed.
