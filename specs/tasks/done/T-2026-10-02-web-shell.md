## T-2026-10-02-web-shell — Build the web client shell: worker, leader tab, sign-in, sync, PWA

- Created: 2026-10-02
- Owner: claude
- Status: done
- Blockers: —
- Completed: 2026-10-02
- Result: branch feat/web-shell, pull request not opened yet
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Q2, Q3, Q9–Q14, Q16 — plan W2, Q19, Q20, visual design note, W1 notes);
  [ADR 0011](../../../docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md)
  and its W1 amendment
- Plan: [docs/plans/2026-10-02-plan-w2-web-shell.md](../../../docs/plans/2026-10-02-plan-w2-web-shell.md)

### Goal

The server, the contract and the CLI are done, and W1 lets the backend host
a web client and hold its session in a cookie. Nothing a browser can open
exists yet. The W3 screens need a shell to stand on. That shell is a Nuxt
SPA that runs under the backend's CSP, and a leader tab whose worker runs the
shared client core on OPFS. It needs a protocol every tab speaks, a sign-in
that never exposes the refresh token, the sync cadence of Q14, an offline app
shell that tells a stale tab to reload, and Playwright runs in real engines.
Real engines are the only place leadership, OPFS and the CSP can be shown to
work. W2 builds that shell and proves it with one placeholder screen, a
replica count that changes when the CLI writes.

### Scenarios

1. **Given** a built SPA served by the backend from `WEB_ROOT`, **When** a
   person opens it over `http://localhost` or HTTPS and signs in, **Then**
   the placeholder shows their replica's task count, and the browser
   reports no CSP violation.
2. **Given** a signed-in tab, **When** the CLI adds a task for the same
   account and the tab regains focus (or 30 s pass while it is visible, or
   the browser comes back online), **Then** the count goes up without a
   reload.
3. **Given** a signed-in tab, **When** the person reloads, **Then** they are
   still signed in. The refresh came from the cookie, and no script ever saw
   a refresh token.
4. **Given** two tabs, **When** the second opens, **Then** it shows the same
   state without starting a second database. **When** the first closes,
   **Then** the second takes over the database and stays signed in.
5. **Given** a tab that synced, **When** the network goes away and the
   person reloads, **Then** the app shell loads and shows the replica's
   count marked offline. **When** the network returns, **Then** it syncs
   on its own.
6. **Given** a new build deployed, **When** an open tab learns of it,
   **Then** it offers a reload instead of reloading under the person, and
   it never answers `/api` from its cache.
7. **Given** a plain-HTTP origin other than `localhost`, **When** the page
   loads, **Then** it says in the current language that HTTPS is needed.
8. **Given** the CLI, **When** it runs any command, **Then** its behaviour
   and output are unchanged.

### Requirements

- **FR-001** `@todoer/client-core` MUST provide a cookie-mode session:
  `httpCookieAuthApi` (login with `transport: 'cookie'`, refresh with `{}`,
  logout with `{}` and the bearer, `credentials: 'same-origin'`) and
  `cookieTokenSource`. The token source holds the access token in memory
  only and refreshes single-flight. It MUST NOT read, return or store a
  `refreshToken`, even when a response carries one, and MUST stop trying
  after a refused refresh or a logout until the next sign-in (← ADR 0011, W1
  notes; plan departure 2).
- **FR-002** `subject` and `adoptAccount` MUST move to client-core
  unchanged in behaviour (portable base64url decoding). The CLI MUST import
  them, and MUST NOT change otherwise (← plan departure 1; ADR 0015).
- **FR-003** client-core MUST provide a `./sqlite-wasm` entry with a
  `SqlDatabase` over oo1. It passes `bind` only when the params are
  non-empty, derives `inTransaction` from `sqlite3_get_autocommit`, and
  makes `withWriteLock` `BEGIN IMMEDIATE` behind an in-worker queue. One
  contract spec MUST pass against both adapters. The portable entry MUST
  NOT import it (← Q3, Q12; W0 departures 1–3).
- **FR-004** `apps/web` MUST be a Nuxt 4 SPA (`ssr: false`,
  `nuxt generate`) with Nuxt UI's default theme and i18n in Russian and
  English, whose locale files hold the same keys. It MUST build, typecheck,
  test and lint through the workspace's turbo tasks (← Q2, Q19, visual
  design note).
- **FR-005** The built SPA MUST run under the backend's CSP unchanged: assets
  under `/_nuxt/`, icons and fonts bundled, no request to another origin,
  no inline handlers, no runtime inline script, no blob: workers, and the
  WASM and the worker from the same origin (← W1 notes; ADR 0011).
- **FR-006** Exactly one tab per origin MUST own the database: the holder of
  a Web Lock, which runs a dedicated worker. When it closes, the next tab
  MUST take over, retrying the OPFS pool until the old handles are
  released. A crashed worker MUST be restarted, at most three times a
  minute, and then reported as failed (← Q10).
- **FR-007** The leader's worker MUST run the unchanged client core over
  `opfs-sahpool` and serve every tab, its own included, over one
  `BroadcastChannel` protocol: commands (`signIn`, `signOut`, `sync`) with
  replies, and published topics (`engine`, `session`, `sync`, `summary`).
  Every message MUST carry the build id. A message from another build MUST
  NOT be processed and MUST surface as a reload prompt (← Q13; plan Review
  Focus 5).
- **FR-008** The tab side MUST resend unanswered requests when a worker
  announces itself, and MUST time a request out as `unavailable` instead of
  hanging (← Q10 "Cost").
- **FR-009** Sign-in MUST use the cookie transport. Sign-out MUST refresh an
  expired access token before calling logout. A refused refresh, or a 401
  that a refresh cannot fix, MUST show the signed-out state. A 429 or a
  network error MUST NOT. A tab with no session hint MUST NOT try a cookie
  refresh. Signing in as another account MUST reset the replica, or refuse
  while the outbox holds the previous account's operations (← ADR 0011, W1
  notes; plan departure 4).
- **FR-010** The leader MUST sync at start, every 30 s while a tab is
  visible, on regained focus and on `online`. Overlapping triggers MUST
  coalesce into one run. A `write` trigger MUST exist for W3. The
  placeholder MUST show the replica's live task count, the last sync, the
  pending and failed counts, and an offline state (← Q14, Q16).
- **FR-011** The SPA MUST register a service worker that precaches the build
  (the WASM included), drops outdated caches, never serves `/api` or
  `/health` from its fallback, and asks before activating a new version
  (← Q9 "Cost").
- **FR-012** A Playwright suite MUST run against the built SPA served by the
  backend with `WEB_ROOT` on a fresh database. It covers sign-in and a CLI
  write appearing, the 30 s tick, a reload keeping the session, two tabs
  and the hand-over, offline then online, and the SW refusing `/api`. It
  MUST fail on any CSP violation, those inside the worker included, and on
  any request to another origin. Chromium MUST run. Firefox runs where the
  engine allows (← Q20, W1 notes; controller default; plan departure 8).
- **FR-013** CI MUST run the suite in a new job named `Web e2e`. The four
  required gate names MUST NOT change (← Q20; brief).
- **FR-014** The README, the design doc ("Departures in plan W2") and
  `.claude/CLAUDE.md` MUST describe what is now true: the web client, how
  to run and test it, browser support and Safari's risk, and the candidate
  gate (← working agreement 3).

### Edge cases

- A response to a cookie login that carries `refreshToken` anyway → the
  grant keeps two fields only (FR-001, T001).
- Two refresh triggers at once (a sync and a sign-out) → one
  `POST /auth/refresh` (FR-001, T001).
- The dead leader's refresh rotated the cookie, and its response was lost →
  the new leader presents the old cookie inside the 30 s grace window and
  gets the same successor (FR-001, FR-006, T001, T007; Review Focus 3).
- A refresh answered 429 → the session stays signed in, and `sync.problem`
  says why (FR-009, T001, T004).
- The new leader opens the pool before the old worker released it → the
  install retries ten times, 100 ms doubling to 1 s apart, about 6.5 s in
  all. A browser without OPFS fails at once (FR-006, T004, T007).
- A tab killed mid-transaction → the hot journal rolls back on the next
  open. There is no WAL (FR-003, FR-006, T002; Review Focus 1).
- A request sent before any worker exists, or while one restarts →
  delivered after `ready` (FR-008, T004).
- An old leader serving a newer follower → both show the reload prompt, and
  neither processes the other's messages (FR-007, T004).
- A signed-out tab loading repeatedly → no refresh requests, and no 401s
  spent against the per-IP limit (FR-009, T005, T007).
- Sign-in as another account with queued operations → refused, and the new
  session is logged out so its cookie does not linger (FR-009, T004).
- Sign-out while offline → local signed-out state. The server session
  idles out, and the next sign-in replaces the cookie (FR-009, T004;
  documented).
- An offline start with an owner on record → signed-in from the replica,
  marked offline (FR-009, FR-010, T004, T007).
- `/api/v1/health` navigated to while the SW controls the page → JSON, not
  `index.html` (FR-011, T006, T007).
- No OPFS (an insecure origin, an old engine) → the HTTPS message, or
  `engine: failed` with the reason, never a spinner forever (FR-006, T004,
  T005).
- A CSP violation inside the dedicated worker → the test fails (FR-012,
  T007).

### Definition of Done

- **SC-001** On a fresh database, `Web e2e` passes in Chromium (and in
  Firefox, or with each skip's reason recorded), with zero CSP violations
  and zero cross-origin requests. Each mutation named in plan Task 7 turns
  at least one test red.
- **SC-002** The `SqlDatabase` contract spec passes against `NodeSqlite`
  and `WasmSqlite`. The mutations in plan Tasks 1, 2 and 4 each turn a
  Vitest spec red.
- **SC-003** `git diff main -- apps/backend scripts/` is empty.
  `git diff main -- apps/cli` holds only `run.ts`'s import of
  `adoptAccount`. Both shell e2e scripts pass.
- **SC-004** The required gates are still exactly the four names, and
  `Web e2e` runs next to them.
- [x] every FR has a test that failed before the code made it pass (FR-011
      by Playwright, shown red with the PWA module removed; FR-014 by the
      sweep, not a test)
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002] client-core: the cookie-mode session and the
      account rule — plan Task 1
- [x] T002 [FR-003] client-core: the `./sqlite-wasm` adapter and the shared
      contract — plan Task 2
- **Checkpoint:** the core runs in a browser worker and holds the web's
  session without seeing its refresh token. The CLI is unchanged.
- [x] T003 [FR-004, FR-005] `apps/web` scaffold under the backend's CSP —
      plan Task 3
- [x] T004 [FR-006, FR-007, FR-008, FR-009] The worker, the protocol, the
      leader tab, the engine — plan Task 4
- [x] T005 [FR-009, FR-010] Sign-in, the sync cadence, the placeholder —
      plan Task 5
- **Checkpoint:** a person signs in from a browser, sees a CLI write arrive,
  reloads without signing in again, and opens a second tab on the same
  worker.
- [x] T006 [FR-011] The service worker and the update prompt — plan Task 6
- [x] T007 [FR-005, FR-012, FR-013] Playwright and the `Web e2e` job — plan
      Task 7
- [x] T008 [FR-014] Docs, departures, the full proof — plan Task 8

### Not in this task

- Feature screens (W3). The production Docker image: Q9's "the image builds
  the SPA" is deferred to its own task before W3 ships, because no
  Dockerfile exists yet and building one is not small (plan departure 6). A
  WebKit run (plan departure 8). An automated two-build update test (plan,
  "What this plan does not do").

### Open questions

None. Decided by the controller on 2026-10-02 under the design's approval of
Nuxt and Nuxt UI (Q2), reversible by the maintainer:

- `vue-tsc` is added as a dev dependency of `apps/web`: it is how a Nuxt app
  typechecks its `.vue` files, part of the approved stack.
- `@iconify-json/lucide` is added as a dev dependency: Nuxt UI's default icons
  must be bundled because the CSP's `connect-src` is `'self'` (W1).
- Fonts: the system font stack (`ui.fonts: false`), no network at build time.
- Sign-out keeps the local replica in OPFS, as the CLI keeps its file; a
  sign-in as another account resets it (`adoptAccount`).
