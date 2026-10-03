## T-2026-10-03-fix-e2e-refresh-race — Stop a reloaded tab's old worker from answering the new one

- Created: 2026-10-03
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer request, 2026-10-03 — CI run 37122464520 (PR #26) failed
  `a reload restores the session through the cookie` on chromium twice
- Plan: none; the steps below are the whole change

### Goal

The e2e test saw no `/auth/refresh` by the time the reloaded page showed the
task count. The refresh had not been missed: it had not started yet. On a
reload the old leader's database worker outlives its document for a few
milliseconds, answers the new tab's `hello` with a snapshot (`engine: ready`,
`session: signed-in`, the summary), and the new tab draws the signed-in shell
from it before its own worker has restored the session. With an expired
cookie the user would see the replica flash before the sign-in form. The
test caught a real bug; the fix belongs in the leader, not in the test.

Measured with `request.timing()`: in a failing run the count was visible at
76786 ms and the refresh started at 76834 ms; `session: signed-in` reached the
new tab 1 ms after its `new Worker(...)`, about 110 ms before that worker was
ready. Every run was controlled by the service worker, so the SW is not the
variable. The brief's hypothesis (Playwright delivering worker requests late
over a separate CDP session) was wrong.

### Scenarios

1. **Given** a signed-in tab, **When** it reloads, **Then** it shows the
   signed-in shell only after its own worker refreshed the session once.
2. **Given** a signed-out tab, **When** it reloads, **Then** no refresh is
   sent and the sign-in form shows.

### Requirements

- **FR-001** The leader tab MUST terminate its database worker when the
  document is discarded (`pagehide` not persisted), so nothing it posts
  reaches the next document (← maintainer, via the coordinator)
- **FR-002** A page entering the back-forward cache MUST keep its worker: the
  tab still holds the lock and comes back with it (← FR-001's edge)

### Edge cases

- `pagehide` with `persisted: true` → the worker stays (FR-002, T002)
- a respawn pending after a failure when the page goes → the timer dies with
  the document; nothing to do

### Definition of Done

- **SC-001** `a reload restores the session through the cookie` passes 32
  repeats on chromium and firefox (before: chromium 29/32, firefox 32/32)
- [x] every FR has a test that failed before the code made it pass — FR-002's
      passed before the fix too (no listener at all); it guards against a
      fix that ignores `persisted`
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced —
      `docs/specs/2026-10-01-client-shells-design.md` (Q10) names the rule
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] failing spec: a discarded page terminates the worker —
      `apps/web/app/db/leader.spec.ts`
- [x] T002 [FR-002] spec: a persisted `pagehide` does not —
      `apps/web/app/db/leader.spec.ts`
- [x] T003 [FR-001, FR-002] terminate on `pagehide` — `apps/web/app/db/leader.ts`
- [x] T004 [FR-001] repeat the e2e test 32 times per browser — no change to
      `apps/web/e2e/shell.spec.ts`: it already pins the behaviour
- **Checkpoint:** chromium and firefox 32/32

### Results

| Browser  | Before | After            |
| -------- | ------ | ---------------- |
| chromium | 29/32  | 32/32, and 32/32 |
| firefox  | 32/32  | 32/32            |

Repeats run in batches of 8: each repeat spends two logins (the fixture's
and the form's), and the backend allows 20 per IP per process. After the
fix the reloaded tab receives nothing from the old worker at all; before it
there were three `summary` publishes and, in failing runs, the snapshot.

The test's second half (`no hint, no refresh`) cannot pass falsely in the
same way: without the hint the new worker never refreshes at start, so there
is no late request for the assertion to miss.

### Departures from the brief

- The brief scoped the change to `apps/web/e2e/**`. The root cause is in the
  app, so the coordinator chose to fix `leader.ts` and leave the e2e test as
  it was: it fails exactly when the bug is present.
- tuxedo 419 (Firefox `waitForLoadState` in the guard's teardown) stays open:
  Firefox passed 32/32 here and the hang is a different mechanism.
