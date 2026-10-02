## T-2026-10-02-web-owner-registration — Register the owner from the browser

- Created: 2026-10-02
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: maintainer request, 2026-10-02 — the web shows a registration form
  while the instance has no users; ADR 0014
- Plan: none; the steps below are the whole change

### Goal

A new instance can only get its owner through curl or the CLI, so the person
who just deployed the image and opened it in a browser sees a sign-in form for
an account that does not exist. The web should offer registration exactly
while the server would accept one without an invitation, and be unchanged
otherwise.

### Scenarios

1. **Given** an instance with no users, **When** someone opens the web client,
   **Then** they see a registration form (email, password, confirm password)
   instead of the sign-in form.
2. **Given** that form, **When** they submit a valid address and a password the
   server accepts, **Then** they are signed in (cookie transport) and land in
   the app.
3. **Given** that form, **When** the server refuses (weak password, closed,
   429), **Then** the form stays and shows the server's reason.
4. **Given** an instance with users, **When** someone opens the web client,
   **Then** the sign-in screen is exactly as before.

### Requirements

- **FR-001** The server MUST answer `GET /api/v1/auth/registration` without
  authentication with `200 { "open": boolean }`, where `open` is true exactly
  when `POST /auth/register` accepts a registration without an invitation —
  one check in `AccountsService` serves both (← maintainer)
- **FR-002** The route MUST be in the OpenAPI document before the backend, with
  the generated client regenerated in its own commit (← CLAUDE.md)
- **FR-003** The web MUST show the registration form instead of the sign-in
  form when the status says `open`, and the sign-in form when it says closed
  or the status request fails (← maintainer)
- **FR-004** The form MUST refuse a confirmation that differs from the password
  before sending anything, state the password rule, and show the server's
  refusal text when the server refuses (← maintainer)
- **FR-005** A successful registration MUST sign in exactly as the sign-in form
  does: `transport: cookie`, the same account adoption and first sync
  (← maintainer, ADR 0011)
- **FR-006** ADR 0014 MUST record, as an amendment, that the instance discloses
  whether registration is open (← maintainer)

### Edge cases

- status request fails or times out → sign-in form (FR-003, T006)
- status says open but someone registered in between → the server answers 403
  `registration is closed`, shown as the refusal (FR-004, T007)
- signed out after registering → the status is asked again and is closed, so
  the sign-in form shows (FR-003, T005)
- a replica with another account's queued operations → refused like a sign-in
  as another account (FR-005, T004)
- the status route and rate limits → it reads one count and touches no limiter,
  so it cannot reset or spend a budget; it is not limited itself (FR-001, T002)

### Definition of Done

- **SC-001** on an empty instance the browser shows the registration form, and
  registering lands in the app; with a user it shows the sign-in form
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-002] `GET /auth/registration` and `RegistrationStatus`, then
      regenerate — `packages/specs/openapi/openapi.yaml`
- [ ] T002 [FR-001] `AccountsService.registrationOpen()` used by `register`'s
      early refusal and the new route; HTTP spec: open on an empty database,
      closed after the first registration — `apps/backend/src/auth/`,
      `apps/backend/src/create-app.spec.ts`
- [ ] T003 [FR-005] `CookieAuthApi.register` with the cookie transport; a
      refusal carries the problem's `detail` — `packages/client-core/src/auth.ts`
- [ ] T004 [FR-005] a `register` command that shares the sign-in path —
      `apps/web/app/db/engine.ts`, `apps/web/app/db/protocol.ts`
- [ ] T005 [P] [FR-003] the gate asks for the status whenever it is signed out —
      `apps/web/app/components/AppGate.vue`
- [ ] T006 [P] [FR-003] `registrationOpen()`: false on any failure —
      `apps/web/app/utils/registration.ts`
- [ ] T007 [FR-004] `RegisterForm.vue`, RU and EN strings; e2e with the status
      and the register call intercepted — `apps/web/app/components/`,
      `apps/web/e2e/register.spec.ts`
- **Checkpoint:** the form shows on an intercepted `open: true`, refuses a
  mismatch, shows a refusal and signs in on success, in Chromium and Firefox
- [ ] T008 [FR-006] ADR 0014 amendment, README, client-shells design doc
