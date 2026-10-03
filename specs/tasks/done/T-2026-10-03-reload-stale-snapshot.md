## T-2026-10-03-reload-stale-snapshot — Ignore a former leader's messages after a reload

- Created: 2026-10-03
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer request, 2026-10-03 — CI run 37125853246 (PR #30, head
  50d42b1, contains the `pagehide` fix of
  [T-2026-10-03-fix-e2e-refresh-race](../done/T-2026-10-03-fix-e2e-refresh-race.md))
  failed `a reload restores the session through the cookie` on chromium twice
- Plan: none; the steps below are the whole change

### Goal

The `pagehide` fix made the old worker's answer unlikely, not impossible.
`Worker.terminate()` and a document's destruction only ask the worker thread
to stop; a thread that still has the new page's `hello` in its queue answers
it first. CI's trace shows it: after the reload there is no `/auth/refresh`
and no `/sync` at all, yet the page shows the signed-in shell with `0 tasks`,
`Not synced yet`, `3 waiting` and a spinning `Sync now` — the old worker's
state in the middle of its first sync, which the reload interrupted 5 ms
after the count appeared. A new worker cannot be signed in without a refresh,
and could not open the database while the old one held its OPFS handles.
macOS chromium did not reproduce it in 64 repeats, with 6× CPU throttling,
with every core busy, or with `/sync` delayed by 400 ms: the race is
scheduler-bound. The fix must not depend on timing at all.

The order the trace implies: the old document is destroyed and lets go of
its locks, the new one wins the leader lock at once and posts `engine:
starting`, and only then does the old worker's snapshot arrive, with `engine:
ready` and `session: signed-in`, overwriting it. The shell shows exactly on
that pair (`AppGate.vue`).

A worker is the leader's only while its page holds the lock; a page that is
gone has released it. So each leader mints an id, holds a second lock named
after it, lets go of it on `pagehide`, and its worker stamps that id on every
message. A tab listens to one leader at a time and switches only after it has
seen the new leader's lock held.

### Scenarios

1. **Given** a signed-in tab, **When** it reloads and the old worker answers
   the new page, **Then** the new page ignores it and shows the signed-in
   shell only after its own worker refreshed the session once.
2. **Given** a follower tab, **When** the leader tab closes, **Then** it
   switches to the next leader on that leader's first message.

### Requirements

- **FR-001** The leader MUST mint an id when it wins the lock, hold a lock
  named after that id until its page is discarded (`pagehide` not
  persisted), and stamp the id on everything it and its worker post (← maintainer, via the coordinator)
- **FR-002** A tab MUST ignore every message whose leader's lock is not held,
  and MUST keep the order of the messages it holds back while it checks
  (← FR-001)
- **FR-003** A tab MUST switch to a new leader whose lock is held (← Q10:
  the lock passes to the next tab)

### Edge cases

- a message from another build → `stale`, before any leader check (unchanged)
- the lock query rejects → the leader counts as gone (FR-002)
- the leader's worker respawns after a failure → same leader id, no check
- the old page is still unloading and its worker answers before its
  `pagehide` ran → it still holds its lock and is still the leader; the tab
  follows it until the next leader speaks. Nothing in the page can tell this
  case apart, and the trace shows the other order

### Definition of Done

- **SC-001** `a reload restores the session through the cookie` passes 32
  repeats on chromium and firefox, and again under CPU throttling and load
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced —
      `docs/specs/2026-10-01-client-shells-design.md` (Q10)
- [x] dnote changelog line

### Steps

- [x] T001 [FR-002, FR-003] failing specs: a gone leader's publish is ignored,
      a live one is heard, order is kept — `apps/web/app/db/client.spec.ts`
- [x] T002 [FR-001] failing specs: the named lock, the stamped messages —
      `apps/web/app/db/leader.spec.ts`
- [x] T003 [FR-001] leader id, lock and stamps — `apps/web/app/db/leader.ts`,
      `worker.ts`, `protocol.ts`
- [x] T004 [FR-002, FR-003] the check in the tab — `apps/web/app/db/client.ts`
- [x] T005 [SC-001] e2e repeats, plain and loaded — no change to
      `apps/web/e2e/shell.spec.ts`
- **Checkpoint:** chromium and firefox 32/32, throttled run green

### Results

The race did not reproduce locally on macOS: 0 failures in 8-repeat runs with
6× CPU throttling, with every core busy, with `/sync` delayed by 400 ms, or
with the leader's `terminate` disabled. A scratch spec reproduced the CI
symptom exactly instead: an init script answers the reloaded page's `hello`
40 ms late with the CI snapshot from an unknown leader, and the worker script
loads 1.5 s late, as a worker waiting on OPFS handles does.

| Run                                         | Before | After |
| ------------------------------------------- | ------ | ----- |
| scratch reproduction, chromium              | 0/4    | 4/4   |
| scratch reproduction, firefox               | —      | 4/4   |
| `a reload restores…`, chromium, 4 × 8       | —      | 32/32 |
| `a reload restores…`, firefox, 4 × 8        | —      | 32/32 |
| the same, 2 × cores of `yes` running, 8 each | —      | 8/8, 8/8 |
| whole e2e suite                             | —      | 67/67 |

### Departures from the brief

- No field in `packages/client-core/src/engine-protocol.ts`: the leader id is
  stamped by the web's own `post` wrappers, and `FromLeader` in
  `apps/web/app/db/protocol.ts` types it.
- `docs/specs/2026-10-03-tui-client-design.md` named the web's protocol
  exports exhaustively; one line now lists the two new ones.
