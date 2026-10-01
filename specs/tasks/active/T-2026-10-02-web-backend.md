## T-2026-10-02-web-backend — Serve the SPA and carry the refresh token in a cookie

- Created: 2026-10-02
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Q9, Q11, Q16 — plan W1);
  [ADR 0011](../../../docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md)
- Plan: [docs/plans/2026-10-02-plan-w1-web-backend.md](../../../docs/plans/2026-10-02-plan-w1-web-backend.md)

### Goal

W2's web client has to load from the same origin as the API, and it has to
keep its refresh token where no script can read it (Q9, ADR 0011). Today the
backend serves no static files, and it returns the refresh token only in a
JSON body. Without both changes the web client would need CORS with
credentials, or a refresh token in `localStorage`. The design rejects the
first, and ADR 0011 rejects the second. The CLI must keep working exactly as
it does: scripts and agents depend on it (ADR 0015).

### Scenarios

1. **Given** `WEB_ROOT` points at a built SPA, **When** a browser opens
   `/`, or any deep link such as `/tasks/42`, **Then** it gets `index.html`
   with a CSP that forbids inline script other than the build's own.
2. **Given** the same server, **When** a client calls any `/api/v1/*`
   route, or asks for a path under `/api` or `/health` that does not exist,
   **Then** it gets the API's answer or a JSON 404, never `index.html`.
3. **Given** `WEB_ROOT` is unset, **When** the backend starts, **Then** it
   behaves as before W1: no static files, and `/` is a 404.
4. **Given** a web client signs in with `transport: cookie`, **When** it
   later refreshes with an empty body and then logs out, **Then** the
   refresh token never appears in a response body, each refresh rotates the
   cookie, and logout revokes the session and clears the cookie.
5. **Given** the CLI, **When** it runs `login`, any data command, or
   `logout`, **Then** its requests, its stored session and its output are
   the same as before W1, and both e2e scripts pass untouched.

### Requirements

- **FR-001** With `WEB_ROOT` set to a directory holding `index.html`, the
  server MUST serve its files, and MUST answer a `GET`/`HEAD` that accepts
  `text/html` with `index.html` when no file matches. With `WEB_ROOT` unset
  it MUST serve no static files. A `WEB_ROOT` without `index.html` MUST
  stop startup (← Q9).
- **FR-002** The SPA MUST NOT answer any path under `/api` or `/health`
  (case-insensitive), any method other than `GET`/`HEAD`, or a request that
  does not accept `text/html` and has no matching file. The validator MUST
  NOT validate static paths. The body parser MUST still run before the
  validator (trap 3). An HTTP-level test over the real middleware chain MUST
  pin all of this (← Q9 "Cost"; plan departures 5, 6).
- **FR-003** Every static response MUST carry a CSP that allows inline
  script only by the hashes of the inline scripts in the served
  `index.html`, plus `'wasm-unsafe-eval'` (← ADR 0011; Q12; plan departures
  3, 4).
- **FR-004** `index.html` and non-hashed files MUST be served with
  `Cache-Control: no-cache`, and files under `/_nuxt/` with
  `public, max-age=31536000, immutable` (← Q9 "Cost": versioned caches).
- **FR-005** `POST /auth/login`, `/auth/register` and `/auth/password` MUST
  accept `transport: body | cookie`, absent meaning `body`. In cookie mode
  the response MUST set `todoer_refresh` (`HttpOnly; Secure;
  SameSite=Strict; Path=/api/v1/auth`, Max-Age 30 days) and MUST omit
  `refreshToken` from the body (← ADR 0011, Q9; plan departure 2).
- **FR-006** `POST /auth/refresh` MUST take the body's token when present
  and the cookie otherwise. A cookie-sourced refresh MUST rotate the cookie
  and omit `refreshToken`. A body-sourced one MUST answer in the body and
  set no cookie. Rate limiting and the grace window MUST behave the same
  for both (← ADR 0011, plan D Q4, Q12).
- **FR-007** `POST /auth/logout` MUST revoke the session of the body's token,
  or the cookie's when the body has none, under today's ownership check.
  Every 204 MUST clear the cookie with the same `Path` (← ADR 0011
  amendment; plan departure 1).
- **FR-008** The OpenAPI document MUST change before the backend:
  `TokenTransport`, an optional `refreshToken` in `SessionTokens` and in
  `RefreshRequest`, and the cookie described in the route prose. The
  regenerated client MUST land in its own commit (← working agreement,
  "Spec first").
- **FR-009** `@todoer/client-core`'s `httpAuthApi` MUST reject a session
  response without a refresh token with a `RefusalError`. `apps/cli` MUST
  NOT change, and the CLI MUST NOT send `transport` (← ADR 0015).
- **FR-010** W1 MUST add no dependency and MUST NOT change Docker or CI.
  `TRUST_PROXY` is only cross-referenced (← brief, 2026-10-02).
- **FR-011** ADR 0011 MUST gain an amendment covering the cookie's path, its
  readers and the opt-in. The README MUST document `WEB_ROOT`, the cookie
  transport and the HTTPS requirement. Domain design §5, the client-shells
  design ("Departures in plan W1") and `.claude/CLAUDE.md` trap 3 MUST say
  what is now true (← working agreement 3).

### Edge cases

- `GET /API/v1/health` → Nest answers it; the SPA never sees it (FR-002,
  T005; HTTP test 3).
- A file at `WEB_ROOT/api/x` → not served at `/api/x` (FR-002, T005; HTTP
  test 4).
- A missing `/_nuxt/old.js` requested by a stale tab with `Accept: */*` → a
  404, not HTML with status 200 (FR-002, T005; HTTP test 6).
- `POST /some/page` → a 404 from Nest, not `index.html` (FR-002, T005; HTTP
  test 5).
- The `__NUXT_DATA__` JSON script → not hashed; the config script → hashed
  (FR-003, T005; `spa.spec`).
- A refresh with a body token *and* a cookie → body answer, no `Set-Cookie`
  (FR-006, T004).
- A refresh with neither → 401, counted toward the IP limit (FR-006, T004).
- The old cookie presented again within 30 s (a lost response, or two tabs)
  → the same successor, set again (FR-006, T004).
- `logout` with `all: true`, or with another user's token in the cookie →
  the cookie is cleared anyway; another user's session is not revoked
  (FR-007, T004).
- `logout` with an expired bearer → 401 from the guard, and the cookie is
  not cleared. The web client refreshes first, as the CLI already does
  (FR-007, T004; documented).
- A cookie value of arbitrary length or shape → `parse` rejects it as 401;
  the 512 cap in the body schema does not apply to cookies, and nothing
  needs it to (FR-006, T004).
- `WEB_ROOT` set to a typo → startup fails naming the variable (FR-001,
  T005; `app-config.spec`).
- An older server that leaves `refreshToken` out → the CLI exits 1 with
  "the server sent no refresh token" and keeps its stored session (FR-009,
  T001).

### Definition of Done

- **SC-001** `create-app.spec.ts` boots the real chain on an ephemeral port
  and passes the plan's HTTP tests. Each mutation named in the plan turns
  at least one test red. The exception, the SPA mounted after the
  validator, is recorded in the PR.
- **SC-002** `git diff main -- apps/cli scripts/ pnpm-lock.yaml` is empty,
  and both e2e scripts pass with and without `WEB_ROOT`.
- **SC-003** `rg -n "nothing else|body only|cookie arrives|main\.ts does"`
  over README, `docs/` (minus plans and historical departures), `.claude`
  and the OpenAPI document finds no stale claim.
- [ ] every FR has a test that failed before the code made it pass (FR-010
      and FR-011 are checked by the diff and the sweep, not by a test)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-009] client-core refuses a session without a refresh token —
      plan Task 1
- [x] T002 [FR-008] Contract: `TokenTransport`, optional `refreshToken`;
      codegen in its own commit — plan Task 2
- [x] T003 [FR-002] `createApp()` and the HTTP spec over the real chain —
      plan Task 3
- **Checkpoint:** the contract allows the cookie transport, and trap 3 is
  pinned by a test; nothing behaves differently yet.
- [ ] T004 [FR-005, FR-006, FR-007] The refresh cookie — plan Task 4
- [ ] T005 [FR-001, FR-002, FR-003, FR-004] Serve the SPA: static, fallback,
      CSP, cache — plan Task 5
- **Checkpoint:** a browser can load a placeholder SPA from `WEB_ROOT` and
  hold a cookie session; the CLI and the e2e scripts are unchanged.
- [ ] T006 [FR-010, FR-011] ADR amendment, README, design departures,
      CLAUDE.md, gates and e2e — plan Task 6

### W2 must (handed over by this task)

The CSP is fixed by the backend (plan departures 3, 4). For the web client
to run under it:

- Keep `app.buildAssetsDir` at `/_nuxt/`. Hashed assets elsewhere get
  `no-cache`, and assets outside the build get no immutable caching at all.
- No inline event handlers, no `javascript:` URLs, no `eval` or
  `new Function`. Do not inject inline scripts at runtime
  (`useHead({ script: [{ innerHTML }] })`). Only inline scripts already in
  the generated `index.html` are allowed, by hash.
- Bundle icons (`@nuxt/icon` with a client bundle or local collections) and
  fonts. `connect-src`/`default-src` are `'self'`, so the Iconify API and
  remote font hosts are blocked.
- Load SQLite WASM and the worker from the same origin. `'wasm-unsafe-eval'`
  is present; blob: workers are not (`worker-src` falls back to
  `script-src`).
- Make the Playwright suite fail on any `securitypolicyviolation` event, and
  run it against the built SPA served by the backend with `WEB_ROOT`, not
  against `nuxt dev`, which this CSP does not cover.
- Sign in with `transport: 'cookie'` and refresh with `{}`. Never read or
  store `refreshToken`. Before logout, refresh if the access token has
  expired, since logout needs a valid bearer to clear the cookie.

### Open questions

None for W1. Safari and `Secure` cookies on `http://localhost` move to W2
(controller, 2026-10-02): W1's tests read `Set-Cookie` directly, and W2
decides its dev setup (Chromium/Firefox over `http://localhost`, or an HTTPS
dev server) when it runs Playwright's WebKit.
