## T-2026-10-28-pr71-review-findings — fix three defects a review of #71 found

- Created: 2026-10-28
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: maintainer request, 2026-10-28 — fix the findings of an afactory
  review of `a1ec2b6` (#71); finding 1's approach chosen by the maintainer:
  the hub refuses, tokens stay stateless (ADR 0014)
- Plan: none; the steps below are the whole change

### Goal

#71 moved the web onto a server-side engine. A review of it found three
defects. A deleted account's page reconnects with its still-valid access
token and the hub builds a new engine for a user that no longer exists, so
the page shows an empty, writable account for up to 15 minutes. A restore
cancelled by another tab's sign-out drops the sign-in hint even when that tab
has signed in again since, which signs it out. And the update prompt's
reload, when it came from Nuxt's build check, lands on the old build the
service worker still serves.

### Scenarios

1. **Given** a signed-in page, **When** the account is deleted from the CLI,
   **Then** the page signs out at once instead of showing an empty account.
2. **Given** tab A restoring its session and tab B signed out, **When** B
   signs in again before A's refresh settles, **Then** B stays signed in.
3. **Given** the prompt "a newer version is available" from the build check,
   **When** the user presses Reload, **Then** the page runs the new build.

### Requirements

- **FR-001** The engine hub MUST refuse `/engine` and `/engine/events` with
  a 401 for a user it unloaded because the account was deleted, for as long
  as an access token minted before the deletion can live (← maintainer,
  ADR 0014)
- **FR-002** The page MUST end its session when `/engine` answers a
  `signed-out` Result (← review finding)
- **FR-003** A restore that fails after the session already ended MUST NOT
  touch the sign-in hint (← review finding)
- **FR-004** Reload from the build-check prompt MUST activate a new service
  worker when the server has one, and plain-reload only when it has none or
  no worker controls the page (← review finding)

### Edge cases

- deletion while the user has no engine loaded → still refused (FR-001, T001)
- a request waiting when the account is deleted → `signed-out`, page signs
  out (FR-002, T003)
- service worker update fails (offline) → plain reload (FR-004, T005)

### Definition of Done

- **SC-001** after an account deletion, `/engine/events` with the old token
  answers 401 and no engine is loaded for that user
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] refuse deleted users in the hub and the stream —
      `apps/backend/src/engine/engine-hub.ts`, `engine.controller.ts`
- [x] T002 [FR-001] state the `/engine` exception — `docs/adr/0014-owner-first-registration-and-two-path-reset.md`
- [x] T003 [P] [FR-002] end the session on a `signed-out` Result —
      `apps/web/app/db/client.ts`
- [x] T004 [P] [FR-003] guard the restore's rejection — `apps/web/app/db/client.ts`
- [x] T005 [P] [FR-004] update the worker before the reload —
      `apps/web/app/utils/newBuild.ts`, `apps/web/app/components/UpdatePrompt.vue`
- **Checkpoint:** backend and web unit suites pass; lint and typecheck clean.

### Open questions

—
