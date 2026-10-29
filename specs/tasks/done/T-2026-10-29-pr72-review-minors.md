## T-2026-10-29-pr72-review-minors — fix two minor findings of a review of #72

- Created: 2026-10-29
- Owner: claude
- Status: done
- Blockers: —
- Completed: 2026-10-29
- Result: https://github.com/kkucherenkov/todoer/pull/73
- Spec: maintainer request, 2026-10-29 — fix the two minors of a review of
  `e3e74c9` (#72)
- Plan: none; the steps below are the whole change

### Goal

#72 made the hub refuse a deleted account, but it remembers deleted users
only in memory: after a backend restart, a token minted before the deletion
loads a fresh, empty engine again for up to 15 minutes. And the update
prompt's `reloadOntoNewBuild` asks for the registration outside its `try`,
so a rejected `getRegistration` leaves the button doing nothing.

### Scenarios

1. **Given** an account deleted before a backend restart, **When** its page
   reconnects with a token still valid, **Then** `/engine` and
   `/engine/events` answer 401.
2. **Given** a page whose `getRegistration` rejects, **When** the user
   presses Reload, **Then** the page reloads.

### Requirements

- **FR-001** A cold engine load asks the database whether the user exists
  and refuses a missing one with 401; a loaded engine costs no query.
- **FR-002** An unload that lands while that query runs still refuses the
  load (the in-memory list stays for this race).
- **FR-003** `reloadOntoNewBuild` falls back to a plain reload when
  `getRegistration` rejects.

### Edge cases

- `/engine/events` must refuse before it writes the head, so the check runs
  before `writeHead`.

### Definition of Done

- [x] FR-001..FR-003 covered by specs that fail without the change
- [x] Workspace tests and lint green

### Steps

- [x] T001 [FR-001, FR-002] `EngineHub.assertLive` becomes async and checks
      the database on a cold load; `request` and the stream await it
- [x] T002 [FR-003] move `getRegistration` into the `try`
