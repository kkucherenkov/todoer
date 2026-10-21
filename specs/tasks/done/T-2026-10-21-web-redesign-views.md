## T-2026-10-21-web-redesign-views — Saved views, access gate, and system states

- Created: 2026-10-21
- Owner: claude
- Status: done
- Completed: 2026-10-21
- Result: PR pending
- Blockers: —
- Spec: maintainer brief w6-antigravity.md and the W6 review findings, 2026-10-21; [web redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 6; [context spec](T-2026-10-03-web-redesign-context.md), FR-001, FR-007
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 6

### Goal

Stage 6 brings the saved view form, the access gate and the sync and update
states to the accepted prototype (`view-form.html`/`screens.js`,
`gate.html`/`screens.css`, `ux.js`/`ux.css`) without losing what the current
code does right: the raw JSON fallback, the filter tree limits, validation,
explicit save of layout, sort and filter, and sign-in and registration on the
real `db.request`, session and `registrationOpen`. The first attempt at this
stage changed little and claimed more than it verified; this spec records only
what was checked.

### Scenarios

1. **Given** a user saving a view, **When** the server refuses the save,
   **Then** the form stays open with every input kept and the refusal shows
   inside it.
2. **Given** a saved view, **When** the user deletes it and clicks Delete
   twice quickly, **Then** one delete is sent, the view is gone and the app
   returns to `/`.
3. **Given** the filter tree, **When** it shows its size, **Then** the limits
   it shows are the ones the server enforces.
4. **Given** the workspace, **When** the user looks at the sidebar footer,
   **Then** it shows the task count, "Saved on this device", the sync badges,
   the last sync and the sync button, in that order.
5. **Given** a new build or a stale tab, **When** the update prompt shows,
   **Then** it sits in the workspace alerts next to the sync problem, or on
   the gate when signed out.
6. **Given** an account with no open tasks, **When** it opens All open,
   **Then** it reads "No open tasks."

### Requirements

- **FR-001** `ViewForm` MUST save name, layout, sort and filter only on an
  explicit Save, keep the raw JSON fallback for a filter the tree cannot draw,
  and block Save while the filter has a problem or the name is blank (← brief;
  plan stage 6).
- **FR-002** `ViewForm` MUST show a refused save inline, in a `role="alert"`
  region inside the form, and keep the dialog and its input (← review b;
  coordinator ruling: inline, not a toast; `screens.js` `#view-refusal`).
- **FR-003** Deleting a view MUST go through `DeleteViewDialog`, which sends
  one `deleteView` while one is pending and navigates to `/` after it is
  accepted (← review a; `references/DeleteViewDialog.vue`).
- **FR-004** The filter tree MUST take its limits from `FILTER_MAX_DEPTH` and
  `FILTER_MAX_NODES` of `@todoer/specs`, in the code and in the shown text;
  the priority leaf starts at `[0]` (← review c; brief; ADR 0019).
- **FR-005** `SyncStatus` MUST follow `ux.js` `#sync-footer`: the task count
  at 14px/500, "Saved on this device", badges, then the last sync (← review d).
- **FR-006** `UpdatePrompt` MUST sit in the workspace alerts area next to the
  sync problem, and on the gate while signed out (← review d; prototype
  `#alerts`).
- **FR-007** The gate MUST follow `.gate-wrap`: 384px wide, 64px vertical
  margin (32px at 700px and below), 32px under the header (← review e).
- **FR-008** Sign-in and registration MUST run on the real `db.request`,
  session and `registrationOpen`, with no invite UI; the states gallery is not
  in navigation (← brief; tuxedo 423).
- **FR-009** The empty, offline, queued, refused, recovery and update states
  MUST be covered by the app's e2e specs (← brief; review f).

### Edge cases

- Blank name → Save disabled (FR-001, T002).
- Invalid or unparseable raw JSON → the problem shown, Save disabled
  (FR-001, T002).
- A refusal, then a retry that the server accepts → the alert goes, the
  dialog closes, the view is listed (FR-002, T002).
- Delete clicked twice → one write (FR-003, T003).
- Priority leaf with every value cleared → a problem, Save disabled
  (FR-004, T002).

### Definition of Done

- **SC-001** A refused view save leaves the form and its input, with the
  reason inside the form (views e2e).
- **SC-002** The filter limits shown are the specs constants (unit test).
- **SC-003** Footer, gate and alerts match the prototype's order and spacing.
- [x] every FR has a test that failed before the code made it pass —
      FR-002–007 failed against the previous build; FR-001, FR-008 and
      FR-009's offline, queued and refused states keep existing behaviour,
      pinned by views, register, screens and offline e2e that already passed
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint` — locally `pnpm lint` and the web unit
      suite pass; the CI checks run once the PR exists
- [x] no document still asserts the behaviour this task replaced
      (`docs/design/DESIGN.md` components and states)
- [ ] dnote changelog line (the coordinator writes it)

### Steps

- [x] T001 [FR-004] Limits from the specs constants in `filterTree.ts` and in
  the `filterTree.limits` text; a test that the shown limits come from them —
  `apps/web/app/utils/filterTree.ts`, `apps/web/app/utils/filterTree.spec.ts`,
  `apps/web/app/components/FilterTree.vue`, `apps/web/i18n/locales/*`
- [x] T002 [FR-001, FR-002] Inline refusal in `ViewForm`; e2e: a refused save
  keeps the input and shows the reason — `apps/web/app/components/ViewForm.vue`,
  `apps/web/e2e/views.spec.ts`
- [x] T003 [FR-003] `DeleteViewDialog` with a pending guard, wired into the
  view route; it navigates itself, because the route unmounts it once the
  view leaves the catalog — `apps/web/app/components/DeleteViewDialog.vue`,
  `apps/web/app/pages/views/[id].vue`
- [x] T004 [FR-005, FR-006] Sync footer per `ux.js`; the update prompt in the
  workspace alerts and on the gate — `apps/web/app/components/SyncStatus.vue`,
  `apps/web/app/components/AppShell.vue`, `apps/web/app/components/AppGate.vue`,
  `apps/web/app/app.vue`, `apps/web/e2e/screens.spec.ts`; the prompt also
  stays on the gate, which `tabs.spec.ts` needs while signed out
- [x] T005 [FR-007, FR-008] Gate spacing per `.gate-wrap` —
  `apps/web/app/components/AppGate.vue`, `apps/web/e2e/register.spec.ts`
- [x] T006 [FR-009] e2e for the empty state — `apps/web/e2e/screens.spec.ts`
- [x] T007 Gates: web unit, typecheck, lint, build; e2e views, register,
  screens, offline, tabs on `todoer_e2e_w6`
- **Checkpoint:** stage 6 of the plan is ticked, with the gate output in the
  report.

### Open questions

None.
