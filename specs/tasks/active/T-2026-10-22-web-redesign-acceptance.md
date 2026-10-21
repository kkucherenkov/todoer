## T-2026-10-22-web-redesign-acceptance — Accept the web redesign (stage 7, reduced)

- Created: 2026-10-22
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md)
  "Decisions and tracks (2026-10-21)" item 3 and stage 7; maintainer
  decision 2026-10-21 (reduced acceptance); umbrella
  [`T-2026-10-03-web-redesign-context`](T-2026-10-03-web-redesign-context.md)
  FR-001–008, SC-001–002
- Plan: none; the steps below are the whole change

### Goal

Stages W1–W6 each shipped with their own tests, but nothing checks the
redesigned screens together at the widths, languages and themes a person
uses, nor the keyboard paths and accessibility the design system promises,
nor a real Web/terminal run on one account. This task runs that reduced
acceptance, fixes small web defects it finds, and records what remains for
the maintainer.

### Scenarios

1. **Given** each redesigned screen (gate, shell and navigation, list,
   board, calendar, drawer, view form), **When** it is shown at 390 and 1366
   px in EN and RU, light and dark, **Then** the page scrolls to its last
   item, a 120+ character title wraps without horizontal page scroll, and
   nothing is clipped.
2. **Given** the same screens, **When** axe runs, **Then** it reports no
   `serious` or `critical` violation.
3. **Given** the keyboard only, **When** every path DESIGN.md lists is
   walked, **Then** each action is reachable, focus is visible, and closing
   an overlay returns focus to its trigger.
4. **Given** the built SPA served by the backend, **When** it loads and
   reloads offline, **Then** no CSP violation is logged and the app works.
5. **Given** one account in the web and in the terminal client, **When**
   parent/child → status → progress → Undo → parent excluded → offline →
   sync, plus a recurring occurrence and a refused reparent, run across
   both, **Then** both clients agree at every step.

### Requirements

- **FR-001** The acceptance spec MUST cover the matrix 390/1366 × EN/RU ×
  light/dark on the seven screens, on chromium only (← maintainer
  2026-10-21; brief W7 item 1).
- **FR-002** The acceptance spec MUST assert no axe `serious`/`critical`
  violation per matrix screen, with `@axe-core/playwright` pinned exactly;
  every disabled rule carries a written reason (← brief item 3).
- **FR-003** Every DESIGN.md "Keyboard paths that exist" path MUST be
  walked by keyboard with visible focus and focus return (← brief item 2).
- **FR-004** CSP and the offline reload of the built bundle MUST be shown
  by a named test (← brief item 4).
- **FR-005** The Web ↔ terminal run MUST drive both clients against one
  backend and account (← brief item 5; umbrella FR-008, SC-002).
- **FR-006** Small in-scope web defects found MUST be fixed with a test, one
  commit each; others are listed as open (← brief item 7).

### Edge cases

- Kanban columns scroll sideways by design → the check is the page's own
  horizontal scroll, not the board's (FR-001, T002).
- At 390 the sidebar is a slideover → navigation is checked opened
  (FR-001, T002).
- The TUI needs a TTY → if it cannot be driven, the CLI (same client-core)
  drives the terminal side and the report says so (FR-005, T005).

### Definition of Done

- **SC-001** `e2e/acceptance.spec.ts` passes on chromium with the matrix,
  axe and keyboard tests; the full web suite passes on chromium and firefox.
- **SC-002** The report lists the matrix, axe results, keyboard paths, the
  Web ↔ terminal transcript summary, bugs fixed and open.
- [ ] every FR has a test that failed before the code made it pass
      (acceptance tests check existing behaviour; a fixed defect has a test
      that failed before its fix)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line — not written: the brief excludes it

### Steps

- [ ] T001 [FR-002] Add `@axe-core/playwright` 4.13.0 (published
      2026-08-11) — `apps/web/package.json`
- [ ] T002 [FR-001, FR-002] Matrix and axe tests — `apps/web/e2e/acceptance.spec.ts`
- [ ] T003 [FR-003] Keyboard and focus test — `apps/web/e2e/acceptance.spec.ts`
- [ ] T004 [FR-004] Name the tests that prove CSP and offline reload; add
      one if none does
- [ ] T005 [FR-005] Web ↔ terminal run on a scratch backend and account
- [ ] T006 [FR-006] Fix small web defects found, one commit and test each
- [ ] T007 Gates: web unit, typecheck, lint, build, full web e2e chromium +
      firefox; update the umbrella spec and the plan; move finished specs
      to `specs/tasks/done/`
- **Checkpoint:** the redesign is accepted within the reduced scope; touch
  and the mobile flow remain the maintainer's.

### Open questions

—
