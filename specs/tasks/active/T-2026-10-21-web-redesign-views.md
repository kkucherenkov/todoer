## T-2026-10-21-web-redesign-views — Saved views, access gate, and system states

- Created: 2026-10-21
- Owner: Antigravity (Web)
- Status: ready
- Blockers: —
- Spec: maintainer brief w6-antigravity.md, 2026-10-21; [web redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 6; [context spec](T-2026-10-03-web-redesign-context.md), FR-001, FR-007
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 6

### Goal

Deliver the redesigned saved view editing, filter tree builder, access gate (sign-in and owner registration), sync status, update prompts, and application state representations in `apps/web`. The components preserve the raw JSON fallback, filter tree limits (`FILTER_MAX_DEPTH`, `FILTER_MAX_NODES` sourced from `@todoer/specs`), priority scale alignment (starting value `[0]` for P0 highest per ADR 0019), and explicit saves without modifying saved views implicitly. Authentication and registration operate on real `db.request` and session state without mock or fixture short-circuits. System states (empty, loading, offline, queued, refused, recovery, update) reflect real client topics and fixtures without adding demo galleries to user navigation.

### Scenarios

1. **Given** a user creating or editing a saved view, **When** they configure name, layout, sort, and conditions in `FilterTree` or raw JSON mode, **Then** the view is saved explicitly via `db.write({ kind: 'saveView' })`, invalid filters show validation problems and disable saving, and priority leaf starts at `[0]` (P0).
2. **Given** a view with conditions near or at the limits (`FILTER_MAX_DEPTH = 8`, `FILTER_MAX_NODES = 256`), **When** interacting with the filter tree, **Then** tree modifications respect depth and node count constraints, preventing invalid expansion while allowing removal/trimming.
3. **Given** an unauthenticated session on an instance with no users, **When** opening the app, **Then** `AppGate` renders `RegisterForm` with owner setup, client-side confirmation check, and real `register` request; on an initialized instance, `SignInForm` renders with real credentials validation and error display.
4. **Given** a network failure or server 4xx/5xx rejection during sync, **When** viewing the shell or initiating manual sync, **Then** `SyncStatus` shows offline badge, pending queue count, or refusal alert with real failure reason, retaining queued writes and offering recovery on reconnect.
5. **Given** an app update or service worker refresh, **When** a new build is detected or db is marked stale, **Then** `UpdatePrompt` displays an accessible notification allowing clean reload without loss of state.

### Requirements

- **FR-001** `ViewForm` MUST explicitly save view fields (`name`, `layout`, `sort`, `filter`) via `db.write({ kind: 'saveView' })`, provide raw JSON editing with fallback for unparseable/custom filters, and block saving when `filterProblem` reports a violation or name is blank (← brief; redesign plan stage 6).
- **FR-002** `FilterTree` and `FilterNode` MUST enforce filter limits (`FILTER_MAX_DEPTH = 8`, `FILTER_MAX_NODES = 256` from `@todoer/specs`), initialize priority leaf with `[0]` (P0 highest per ADR 0019), and maintain immutable tree edits with lower-cased catalog ids and unknown id preservation (← brief; redesign plan stage 6; ADR 0019).
- **FR-003** `AppGate` MUST restrict access to the application replica until `session.state === 'signed-in'` and `engine.state === 'ready'`, rendering responsive gate layout, skeleton loading during startup/restoration, `RegisterForm` when `registrationOpen` is true, `SignInForm` otherwise, and engine failure alerts (← brief; mockup `gate.vue`; redesign plan stage 6).
- **FR-004** `SignInForm` and `RegisterForm` MUST execute via real `db.request` (`kind: 'signIn'` and `'register'`), validate password confirmation on submission without blur layout shifts, display structured failures, and never use fixture shortcuts or invite flows (← brief; redesign plan stage 6; tuxedo 423).
- **FR-005** `SyncStatus` MUST display relative last-sync time, reactive task counts with locale pluralization, and badges for offline, pending writes queue, and sync failures with manual sync trigger and sign-out (← brief; redesign plan stage 6).
- **FR-006** `UpdatePrompt` MUST notify users when a service worker update is available or the database is stale, providing a single reload action without cluttering everyday workspace navigation (← brief; redesign plan stage 6).
- **FR-007** System states (empty views, loading skeletons, offline indicators, queued operations, refused sync, recovery via manual sync, update prompts) MUST be verified via application unit tests and test fixtures in e2e specs without adding demo state galleries to application navigation (← brief; redesign plan stage 6).

### Edge cases

- Empty name or whitespace-only name in ViewForm → Save button is disabled (FR-001, T002).
- Non-JSON or invalid JSON in raw filter mode → Error message displayed, Save disabled, toggling back to tree mode disabled until valid (FR-001, T002).
- Adding condition when tree depth is 8 or node count is 256 → `canAdd` and `canToggleNot` return false, Add menu disabled or prevents violation (FR-002, T002).
- Priority leaf created → starts at `[0]` (P0), checkboxes allow toggling 0..4, deselecting all renders invalid filter blocking save (FR-002, T002).
- Password mismatch on registration → inline form error displayed without sending network request (FR-004, T003).
- Registration refused (403 forbidden) → error alert displays server detail message, form remains visible with inputs intact (FR-004, T003).
- Network drops while writes are performed → writes accepted locally, pending badge increments, offline badge shown, no data lost (FR-005, FR-007, T004).
- Sync refused with 403 → sync-problem alert displayed with reason and retry action; 503 → offline badge shown (FR-005, FR-007, T004).

### Definition of Done

- **SC-001** Views can be created, edited with FilterTree (including P0 priority leaf) and raw JSON, and deleted, with full keyboard and validation support in EN and RU.
- **SC-002** Sign-in and owner registration operate on live engine requests, handle errors and password mismatch gracefully, and guard the app shell.
- **SC-003** Offline, queued writes, sync refusal, recovery, and update prompts behave accurately in tests without demo galleries in the main UI.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001–002] Link `@todoer/specs` in `apps/web/package.json` to source `FILTER_MAX_DEPTH` and `FILTER_MAX_NODES`, update `filterTree.ts`, and verify filterTree unit tests — `apps/web/package.json`, `apps/web/app/utils/filterTree.ts`, `apps/web/app/utils/filterTree.spec.ts`
- [x] T002 [FR-001–002] Align `ViewForm.vue`, `FilterTree.vue`, and `FilterNode.vue` with redesign styling, reactive computed start kinds, and e2e contract coverage for priority leaf and limits — `apps/web/app/components/ViewForm.vue`, `apps/web/app/components/FilterNode.vue`, `apps/web/e2e/views.spec.ts`
- [x] T003 [FR-003–004] Align `AppGate.vue`, `SignInForm.vue`, and `RegisterForm.vue` with design layout tokens (`max-w-sm mx-auto py-12`), ensuring strict real session and db.request handling — `apps/web/app/components/AppGate.vue`, `apps/web/app/components/SignInForm.vue`, `apps/web/app/components/RegisterForm.vue`, `apps/web/e2e/register.spec.ts`
- [x] T004 [FR-005–007] Verify and refine `SyncStatus.vue`, `UpdatePrompt.vue`, and states handling (empty, loading, offline, queued, refused, recovery, update) in unit and e2e test contracts — `apps/web/app/components/SyncStatus.vue`, `apps/web/app/components/UpdatePrompt.vue`, `apps/web/e2e/screens.spec.ts`, `apps/web/e2e/offline.spec.ts`
- [x] T005 [FR-001–007] Verify i18n keys for EN and RU, execute quality gates (`pnpm --filter @todoer/web test`, `typecheck`, `build`, `pnpm lint`), and prepare `.superpowers/w6-report.md` — `apps/web/i18n/locales/*`, `.superpowers/w6-report.md`
- **Checkpoint:** Stage W6 components, utils, specs, and gates pass cleanly.

### Open questions

None. Requirements follow the W6 brief, mockups, and approved redesign plan.
