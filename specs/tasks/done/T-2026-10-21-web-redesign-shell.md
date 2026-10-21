## T-2026-10-21-web-redesign-shell — Unify the web shell and transient layouts

- Created: 2026-10-21
- Owner: Codex (Web)
- Status: done
- Completed: 2026-10-21
- Result: https://github.com/kkucherenkov/todoer/pull/51
- Blockers: —
- Spec: [web redesign context](../active/T-2026-10-03-web-redesign-context.md), FR-001–003
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
   `mode` and `at` query survive layout and drawer navigation.
6. **Given** a saved list view, **When** it opens with `?layout=calendar`,
   **Then** it shows calendar placements; **given** a saved calendar view,
   **when** the user selects List or Kanban, **then** it shows that layout's
   projection; without the override either view opens in its saved layout.

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
- **FR-004** Web MUST offer every layout on every view: it MUST send the
  override in `watch.layout` (null without one), watch with a span whenever
  the effective layout is Calendar, and accept a published view only when its
  key, span and layout match the watch (the saved layout, from the catalog,
  when there is no override) (← core C1 `watch.layout`).
- **FR-005** Closing the task drawer MUST remove only `task`, preserve the
  filter/layout/calendar query, and restore focus to the opening control or,
  if it disappeared, the nearest task surface or workspace heading
  (← context FR-003).

### Edge cases

- Repeated `layout` query values or a non-string value → treat as invalid and
  replace it away without changing the saved view (FR-003, T002).
- Switching back to the saved layout → remove the redundant override by push,
  so reload still derives the saved default (FR-003, T002).
- A saved calendar opened with `layout=list|kanban` → that projection, with no
  span in the watch; `mode`/`at` stay in the URL for the way back
  (FR-003–004, T006).
- Two tabs on one view in two layouts → each keeps only its own layout's
  publish (FR-004, T006).
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
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001–005] Trace the current shell, route/watch and drawer focus
  contracts; confirm whether C1 landed before choosing the Calendar path —
  `apps/web/app/`, `origin/main`
- [x] T002 [FR-002–004] Add failing-first route/history/watch tests and
  implement transient layout resolution without saved-view writes —
  `apps/web/app/utils/`, `apps/web/app/components/`, `apps/web/app/pages/`
- [x] T003 [FR-005] Add failing-first focus/context tests and restore drawer
  focus with a stable fallback — `apps/web/app/composables/`,
  `apps/web/app/components/TaskDrawer.vue`
- [x] T004 [FR-001–002] Apply the approved Nuxt UI theme and responsive shell,
  then update Playwright control-name contracts — `apps/web/app/app.config.ts`,
  `apps/web/app/assets/css/main.css`, `apps/web/e2e/`
- [x] T005 [FR-001–005] Update affected documentation and run the Web tests,
  typecheck, workspace lint and production build — `docs/`, `specs/tasks/`
- [x] T006 [FR-003–004] After C1: failing-first unit (`layout.spec.ts`,
  `client.spec.ts`) and e2e (`shell.spec.ts`) tests, then send
  `watch.layout`, match publishes on layout, and remove the availability
  restriction and its UI — `apps/web/app/utils/layout.ts`,
  `apps/web/app/db/client.ts`, `apps/web/app/composables/useDb.ts`,
  `apps/web/app/components/`
- **Checkpoint:** W1's shell and all three transient layouts on every view
  are tested and production-built.

### Open questions

None.
