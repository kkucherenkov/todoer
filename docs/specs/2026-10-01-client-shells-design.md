# Sub-project 3: client shells — the web client first

The domain design promises three clients: web, the CLI and a Flutter
application. The CLI ships today; this document settles the next two. **Web
comes first**, on Nuxt 4 in SPA mode with Nuxt UI. It runs the same **client
core** as the CLI: the replica, outbox, overlay, expander, merge and views
logic, moved out of `apps/cli` into a shared package. In the browser the core
runs inside a dedicated worker over the official SQLite WASM build on OPFS. One
**leader tab** owns that worker, and the other tabs talk to it. The backend
serves the built SPA from the same origin as the API, so the refresh cookie of
ADR 0011 is a plain `SameSite=Strict` cookie. An operator's reverse proxy
provides HTTPS on a NAS. The work ships as four plans (W0–W3). Flutter gets
its own design once the web client lands. The same interview also settled four
backlog items (#390, #391, #361, #407); they are at the end.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **client shell** | The platform part of a client: UI, navigation, storage binding and app lifecycle, on top of the shared core. | frontend, app |
| **client core** | The logic every client shares: replica, outbox, overlay, expander, current occurrence, duplicate-name merge, quick-add parsing, labels, statuses and views. Lives in `packages/client-core`. | SDK, engine |
| **replica** | The local copy of a user's rows a client reads offline and updates by pulling. | cache, local db |
| **leader tab** | The browser tab that holds a Web Lock and owns the worker with SQLite and sync; other tabs work through it. | main tab, master |

## Why

The server, the contract and the CLI are done for tasks, recurrence, auth and
views, but nothing gives a person a screen. Three deferred items wait on a web
client: the refresh cookie (ADR 0011, plan D departure 2), CLI device-code
sign-in (plan D Deferred), and moving the expander into a shared package
(plan C Deferred: "reopens when the web client exists"). The views design hands
the list, kanban and calendar layouts to the GUI clients. The maintainer runs
the instance on a NAS.

## Locked decisions

### Web first, Flutter after (Q1)

**Decision.** The web client is built first; Flutter follows once it ships.

**Rejected.**

- *Flutter first.* Leaves the three deferred web items open longer, and the
  Dart port would have to be made from core code still shaped for one client.
- *Both in parallel.* Doubles the work while the core is still moving.

**Cost.** No offline client on the phone until Flutter.

### Nuxt 4 in SPA mode, Nuxt UI, a PWA module (Q2)

**Decision.** `apps/web` is Nuxt 4 with `ssr: false`, Nuxt UI (Tailwind v4)
for components, and `@vite-pwa/nuxt` for the service worker and offline asset
cache.

**Rejected.**

- *Vue 3 + Vite without Nuxt.* Lighter, but routing, PWA and the UI kit would
  be assembled by hand.
- *React + Vite*, *SvelteKit static.* No advantage that outweighs the
  maintainer's familiarity with Nuxt and Nuxt UI.

**Cost.** A framework layer over Vite whose server half is switched off.

### One client core on SQLite in both clients (Q3)

**Decision.** The client core moves to a shared package
(`packages/client-core`). Both clients keep SQL storage: the CLI on
`node:sqlite`, the web on SQLite WASM in OPFS. A thin database adapter
(`prepare`, `run`, `all`, `exec`, transactions) is the only per-platform part
of the core.

**Rejected.**

- *A core with an IndexedDB adapter for the web.* `Store` would be rewritten
  for a different API and a different transaction model.
- *A separate web implementation checked against the vectors.* A third copy
  of one algorithm, which the domain design warns against.

**Cost.** SQLite WASM (~1 MB) and a dependency on OPFS. Safari supports OPFS
access handles from 16.4.

### Same origin: the backend serves the SPA (Q9)

**Decision.** The production image builds the SPA (`nuxt generate`) and the
backend serves it with `express.static`, with an `index.html` fallback for
every path outside `/api` and `/health`. The API stays under `/api/v1`. The
refresh token travels in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie
scoped to `/api/v1/auth`; the access token stays a bearer token held in
memory. In development the Nuxt dev server proxies `/api` to the backend, so
the browser sees one origin there too.

Deploying on a NAS: one Docker image (backend + built SPA) plus Postgres in
compose, as `docker/compose.yml` does today. Updating means pulling one image,
and web and API are always the same version.

**Rejected.**

- *One origin through the operator's proxy, backend not serving the SPA.*
  Keeps the cookie equally simple but makes a proxy mandatory for every
  operator. Nothing in the cookie design prevents an operator from doing it
  anyway.
- *Different origins with CORS and credentials.* `SameSite=None`, CSRF
  protection and CORS configuration for a scenario a personal instance does
  not have.

**Cost.**

- Updating only the web still rebuilds the image.
- The static fallback must not shadow `/api` or `/health`, and
  `express-openapi-validator` must not validate static paths. Both depend on
  middleware order in `main.ts` (next to trap 3) and need a test.
- The service worker caches the SPA, so it needs a versioned cache and an
  "update available" prompt.

### HTTPS comes from the operator's reverse proxy (Q11)

**Decision.** Service workers, OPFS and `Secure` cookies exist only in a
secure context (HTTPS, or `localhost`). On a NAS, TLS is terminated by the
operator's reverse proxy: the NAS's built-in one (Synology, QNAP), Caddy or
Traefik. The backend stays HTTP behind it, and `TRUST_PROXY` (#407 below)
restores real client IPs. The README gains a Caddy example. Tailscale
(`tailscale serve`, an HTTPS name inside the tailnet) is documented as the way
to reach the instance from outside without opening ports; it combines with
this decision.

**Rejected.** *The backend terminating TLS from certificate paths* puts
certificate rotation in the application, which the proxy already does better.

**Cost.** Over plain `http://nas.local` the web client cannot work offline,
or at all where it needs those APIs. The README must say so.

### A leader tab owns the database (Q10)

**Decision.** OPFS gives synchronous access only from a dedicated worker, and
that access is exclusive. One tab wins a Web Lock and runs the worker with
SQLite and sync. Other tabs send commands and receive results over
`BroadcastChannel`. When the leader closes, the lock passes to the next tab,
which starts its own worker.

**Rejected.**

- *One tab only, others show "open elsewhere".* Honest, but several tabs are
  ordinary use.
- *A cooperative multi-connection VFS (wa-sqlite `OPFSCoopSyncVFS`), one
  connection per tab.* Simpler tab code, but slower under contention and
  younger.

**Cost.** A message layer between tabs and a leadership hand-over to get
right and test.

### The whole client core runs in the leader's worker (Q13)

**Decision.** SQLite, outbox, sync and merge all run in the worker. The UI
sends commands (add, mark, set a field, sync now) and subscribes to computed
results: a view's list, a board, a task. The worker pushes new results after
every write and every pull.

**Rejected.** *The core on the main thread with an async SQLite proxy in the
worker.* Every `Store` call would become asynchronous, which means rewriting
the core for the CLI as well.

**Cost.** A command and subscription protocol between UI and worker; the
leader design needs it anyway.

### Plans W0 to W3 (Q16)

**Decision.**

1. **W0: extract `packages/client-core`.** The CLI runs on it with no change
   in behaviour. Proven by every CLI test and both e2e scripts passing
   untouched.
2. **W1: backend.** Serve the SPA (static, fallback, middleware order),
   issue and accept the refresh cookie, `TRUST_PROXY`.
3. **W2: web shell.** Nuxt app, worker, leader tab, sign-in, sync, i18n, PWA,
   Playwright harness. No feature screens (they came in W3).
4. **W3: v1 screens** (Q8, Q17, Q18).

The CLI device-code flow follows v1.

**Rejected.**

- *One large web v1 plan.* A mistake in the core extraction would mix with
  new-UI mistakes.
- *Web shell on a copy of the core, extraction later.* Creates the second
  copy Q3 avoids.

**Cost.** Four PRs before the first screen a person uses daily.

## Routine choices

- **v1 scope (Q8).** v1 has sign-in, list with views, kanban, quick-add and a
  task card. The calendar layout (two placements, range expansion, moving an
  occurrence) and the filter-tree editor come in the next plan. *Shipped in plan W4.*
  Registering the first account (the owner) from the browser came after v1:
  the sign-in screen shows a registration form while `GET /auth/registration`
  says it is open (ADR 0014, amendment of 2026-10-02).
- **Sync cadence (Q14).** The leader syncs at start, right after every write,
  every 30 s while the tab is visible, on regained focus and on the `online`
  event. No server push now; an SSE "changes after seq N" signal can be added
  later without changing the client beyond its trigger.
- **Flutter (Q15).** Deferred to its own interview and design once the web
  client ships. The one fixed point: the client core is ported to Dart and
  checked against the shared vectors.
- **SQLite WASM library (Q12).** The official `@sqlite.org/sqlite-wasm` with
  the `opfs-sahpool` VFS. It needs no `SharedArrayBuffer`, so no COOP/COEP
  headers, and gives exclusive synchronous access, which fits the leader. Its
  `oo1` API is close to `node:sqlite`, so the adapter is thin.
- **Creating views in v1 (Q17).** A form built from templates: Today, Overdue,
  Next 7 days, Project…, Tag…, Status…, plus layout and sort. It writes an
  ordinary synced view with a filter tree. A raw-JSON mode checked with
  `filterProblem` may sit behind the same form. *In W4 the tree replaces the
  templates as the editor.*
- **Board columns (Q18).** Full management in v1: add, rename, reorder, mark
  the completing status, and delete with the status's tasks moved to the first
  status in the same batch (views design, Q8).
- **Visual design (maintainer, after the interview).** No custom design system:
  the web client uses Nuxt UI's components and default theme as they come,
  adjusted only through its theme tokens (colours, radius, font). The Flutter
  client later copies that look — the same tokens and layouts — rather than
  designing its own.
- **Language (Q19).** i18n from the start with `@nuxtjs/i18n`, Russian and
  English. Calendar dates need locales anyway.
- **Testing (Q20).** Vitest for the client core and components. Playwright
  end-to-end tests in CI against a live backend cover sign-in, quick-add, a
  list through a view, kanban, offline use and two tabs. Playwright is a new
  dev dependency and a new CI job, a candidate for a required gate.

## Backlog decisions (tuxedo #390, #391, #361, #407)

Settled in the same interview; each becomes its own small task.

- **#390: `done`/`skip` on an already closed one-off task (Q4).** The same
  mark again exits 0 and sends nothing, so a script repeating a command after
  a lost response succeeds. A different mark (`done` ↔ `skip`) exits 2 and
  says to `undo` first. *Rejected:* exit 2 for every repeat (breaks idempotent
  retries); leaving it and documenting it (silent overwrite of
  `completedAt`).
- **#391: deleting a task with live subtasks (Q5, locked).** The server
  rejects a `delete` of a task that has live subtasks; a client deletes the
  children first, in the same batch. A one-off migration tombstones the live
  subtasks of already tombstoned parents.
  - *Rejected: a server-side cascade.* A delete would write rows the client
    never sent and never sees in its outbox, breaking one op, one row.
  - *Rejected: a client-only rule.* The server is the only write path (trap
    5), so an invariant it does not check does not hold.
  - *Cost:* an offline parent delete raced by a new subtask on another device
    comes back refused later. The same holds for a subtask written under a
    parent another device already deleted: it is refused too, since a live
    subtask under a tombstone is the state the rule exists to prevent.
- **#361: `seq` default drift (Q6).** Accepted, and automated. A check in
  Shell tests fails CI when a migration contains `DROP SEQUENCE "change_seq"`
  or `DROP DEFAULT` on a `seq` column. *Rejected:* removing the defaults and
  assigning `seq` in code only. The diff would still plan `DROP SEQUENCE`, and
  that migration would succeed and destroy the sequence.
- **#407: client IP behind a reverse proxy (Q7).** A `TRUST_PROXY`
  environment variable, passed to `app.set('trust proxy', …)`: a hop count or
  a CIDR list, unset by default. *Rejected:* trusting `X-Forwarded-For`
  always (any client could spoof its IP past the limits); keeping only the
  README warning.

## Verified facts

- The domain design names the three clients: web, CLI, Flutter
  (`docs/specs/2026-09-25-domain-and-sync-design.md`, opening paragraph).
- ADR 0011: bearer access tokens everywhere, the refresh token in an
  `HttpOnly` cookie on the web only; plan D shipped the body transport and
  deferred the cookie to the web client.
- The CLI's client logic is about 3 000 lines in `apps/cli/src` (before W0, excluding
  specs), on `node:sqlite` through `Store`, with `BEGIN IMMEDIATE` write
  transactions.
- The auth limiters key on `req.ip`, and `main.ts` set no `trust proxy` before #407.
- Each generated migration carries the trap-6 statements; `dbgenerated()` on
  the `seq` fields does not remove them (dnote, plan B2 follow-up).
- The CLI has no `delete` command, so no client deletes tasks today.

## Risks

- **Secure context on a NAS.** Without HTTPS the web client loses its offline
  storage and service worker. The README and the first-run screen must say so
  plainly.
- **OPFS and leadership in real browsers.** Safari's OPFS arrived in 16.4, and
  a tab killed mid-transaction must leave a database the next leader can
  open. Only Playwright runs in real engines will show this.
- **Service worker staleness.** A cached SPA older than the API it talks to.
  Since both ship in one image, the risk is a stale tab, not a stale server.
  Versioned caches and an update prompt address it.
- **Core extraction (W0).** The largest refactor of the CLI so far. Its proof
  is that nothing changes: every existing test and both e2e scripts pass
  untouched.
- **Static fallback ordering.** A fallback that swallows `/api` answers every
  API call with `index.html`, the same class of failure as trap 3.

## Deferred

- **CLI device-code flow approved from the web.** After v1.
- **Server push (SSE).** Reopens if 30 s polling proves too slow.
- **Flutter.** Its own interview and design after the web client ships.

## Open threads

None.

## Departures in plan W0

Plan W0 extracted `packages/client-core` and departed from this document in six
places.

**The `DatabaseSync` adapter lives in client-core, behind `./node-sqlite`.**
The design kept the whole `node:sqlite` binding in the CLI. The CLI keeps the
path, the directory and file modes, the umask and `retryOnBusy`. The adapter
itself, with the cross-process write lock, moved to client-core's
`@todoer/client-core/node-sqlite` entry (decided by the controller,
2026-10-02). The specs that moved with `Store`, `tokenSource` and
`httpTransport` assert things only the real lock makes true, and a test-only
copy of it would be a second implementation of the most delicate code in the
client. Q3 calls the adapter the only per-platform part of the core, and the
web's will be a sibling entry. The portable entry never imports it, and lint
forbids `node:*` everywhere else in the package.

**The adapter has no `prepare` and no `get`.** Q3 listed `prepare`, but `Store`
never keeps a statement handle. `SqlDatabase` has six members: `exec`, `run`,
`all`, `inTransaction`, `withWriteLock`, `close`. `get` is `all(...)[0]`.
`settle` and `mergeChanges` now prepare once per row instead of once per call,
about 10 µs a statement, which does not matter at the size of a pull. W2 note:
the oo1 adapter must pass `bind` only when the params are non-empty.

**`Store.transaction` stays in the portable core; only `withWriteLock` is per
platform.** `BEGIN IMMEDIATE`, `COMMIT` and a `ROLLBACK` guarded by
`inTransaction` are plain SQL, the same on both engines. The asynchronous lock
is the platform part: a cross-process poll on Node, `BEGIN IMMEDIATE` behind an
in-worker queue in the web's leader worker.

**The package is built with `tsc`, not `tsup`.** `@todoer/specs` uses tsup only
because its generated code has extension-less imports. The moved code already
builds with the CLI's `tsc` config, one ESM file per module, so `./node-sqlite`
is simply `dist/node-sqlite.js`.

**`login`, `logout`, `adoptAccount`, `subject` and `revoke` stay in the CLI's
`run.ts`.** `subject` reads the token with `Buffer`, and the web signs in with
the refresh cookie (ADR 0011), a different flow. `tokenSource` and
`httpAuthApi` moved.

**The error classes moved unchanged, with their CLI wording.** `UsageError`,
`RefusalError` and `ConflictError` live in client-core because `Store`,
`resolveRef`, `planAdd`, `pickView`, `pickOccurrence`, `flush` and `submit`
throw them. Messages keep flag names (`--on must be a date`, `do not run done
again`); rewording them for a GUI was left to W2, which kept them (W2
departure 7), since changing them would change CLI output.

## Departures in plan W1

Plan W1 added the SPA hosting and the refresh cookie to the backend and departed
from this document and ADR 0011 in six places.

**The cookie reaches every `/api/v1/auth/*` route, and the server reads it on
refresh and logout.** ADR 0011 said "sent to `POST /auth/refresh` and to
nothing else". This document already scoped the cookie to `/api/v1/auth`.
Logout must revoke the session the cookie belongs to, and the web cannot read
an `HttpOnly` cookie to copy it into the body; with a narrower path a web
logout would leave its session alive for up to 30 days. Rejected: a second
cookie for logout (two copies of one secret) and logout through `/auth/refresh`
with a flag (one route, two meanings). ADR 0011 carries the amendment.

**`PasswordChange` takes `transport` too, not only login and register.**
`POST /auth/password` revokes every session, the cookie's included, and returns
a fresh pair. Without the opt-in, a web client that changed its password would
receive the new refresh token in a body JavaScript can read.

**The CSP's script hashes are computed by the backend at startup, from the
`index.html` it serves.** Nuxt's config script is inline, and no option moves it
into a file. A nonce means rewriting `index.html` on every request, and hashes
pinned in `nuxt.config` go stale on every change to public runtime config. So
the backend reads `index.html` once, hashes each executable inline `<script>`
and serves that same buffer: the policy always matches the bytes served. The
cost is that a new build in `WEB_ROOT` needs a backend restart. `WEB_ROOT` is
trusted content, and symlinks inside it are followed. The hashes cover only
scripts present in the build artefact, so a script injected at runtime through
rendered Markdown, the vector ADR 0011 names, matches none.

**`style-src` allows `'unsafe-inline'`, and `script-src` allows
`'wasm-unsafe-eval'`.** Inline script stays forbidden. Nuxt UI writes its theme
into a runtime `<style>` element and Nuxt's SPA loading template is inline CSS;
inline styles cannot run code. SQLite WASM (Q12) compiles WebAssembly, which a
policy without `'wasm-unsafe-eval'` blocks; that keyword does not allow `eval`
of JavaScript.

**The fallback answers only requests whose `Accept` contains `text/html`.**
"Every path outside `/api` and `/health`" would also answer a missing
`/_nuxt/x.js` with a 200 HTML page. A browser fetches scripts with
`Accept: */*`, so the result would be a MIME error instead of a 404, and a stale
service worker could cache it. Navigations send `text/html`.

**`main.ts`'s setup moved into `createApp()`.** `main.ts` calls `bootstrap()` on
import, so a spec cannot import it. The middleware chain now lives in
`create-app.ts`, and `create-app.spec.ts` pins the order that matters, the
body parser before the validator (trap 3), over HTTP. The SPA goes first for
tidiness only: the validator manages `/api/v1` alone and the SPA passes on
`/api`, so its position is not load-bearing. The "Cost" of Q9 named `main.ts`; read
`create-app.ts`.

Two properties of the cookie are not departures but are worth knowing. Its
Max-Age is fixed at the 30-day idle limit, so near the 365-day absolute limit it
can outlive the session by up to 30 days; the server stays authoritative and
answers 401. A duplicated `todoer_refresh` cookie reads as absent (a same-site
sibling can plant a second one, cookie tossing), and a refused cookie refresh
clears the cookie.

### W2 notes

**The CSP is fixed by the backend. For the web client to run under it:**

- Keep `app.buildAssetsDir` at `/_nuxt/`. Hashed assets elsewhere get
  `no-cache`, and assets outside the build get no immutable caching at all.
- No inline event handlers, no `javascript:` URLs, no `eval` or `new Function`.
  Do not inject inline scripts at runtime (`useHead({ script: [{ innerHTML }] })`).
  Only inline scripts already in the generated `index.html` are allowed, by
  hash.
- Bundle icons (`@nuxt/icon` with a client bundle or local collections) and
  fonts. `connect-src` and `default-src` are `'self'`, so the Iconify API and
  remote font hosts are blocked.
- Load SQLite WASM and the worker from the same origin. `'wasm-unsafe-eval'` is
  present; blob: workers are not (`worker-src` falls back to `script-src`).
- Make the Playwright suite fail on any `securitypolicyviolation` event, and run
  it against the built SPA served by the backend with `WEB_ROOT`, not against
  `nuxt dev`, which this CSP does not cover.
- Sign in with `transport: 'cookie'` and refresh with `{}`. Never read or store
  `refreshToken`. Before logout, refresh if the access token has expired, since
  logout needs a valid bearer to clear the cookie.

**Safari and `Secure` cookies on `http://localhost` are open.** W1's tests read
`Set-Cookie` directly. W2 chose Chromium and Firefox over `http://localhost`
and did not run WebKit; see departure 8 under "Departures in plan W2".

## Departures in plan W2

Plan W2 (`docs/plans/2026-10-02-plan-w2-web-shell.md`) built the web shell. It
departs from this document and from the brief in eight places.

**1. `subject` and `adoptAccount` moved from the CLI into client-core.** W0
kept them in `run.ts` because `subject` used `Buffer` and the web's sign-in is
a different flow. The flow differs, but the account rule does not, and a second
copy in the web would be a second implementation of a data-loss guard. In
client-core, `subject` decodes base64url with `atob`. The CLI imports both, and
`run.spec`'s "switching accounts in one store" tests are the proof that nothing
changed.

**2. The web's token source is a sibling, not a mode of `tokenSource`.**
`tokenSource` is built around a stored refresh token renewed under the store's
write lock, so that parallel processes spend it once. The cookie session has no
stored token and one worker per origin. A flag would leave two algorithms behind
one name. `cookieTokenSource` shares `RENEW_WITHIN_MS` and the retry-once rule,
and `StoredAuth` becomes `AccessGrant & { refreshToken }`.

**3. ESLint lints `apps/web`'s `.ts` without type information. `.vue` files are
formatted by Prettier and typechecked by `vue-tsc`, but not linted.** Type-aware
lint needs Nuxt's generated project references, and linting `.vue` needs
`eslint-plugin-vue`, a dependency nobody approved. The e2e files have their own
`apps/web/e2e/tsconfig.json`, which the web's `typecheck` runs after
`nuxt typecheck`, since Nuxt's references do not include them.

**4. A signed-out tab does not try a cookie refresh.** The tab keeps a one-bit
hint in `localStorage` (`todoer.session`), set when the session topic says
signed-in and cleared when it says signed-out. The leader passes the hint to the
worker at spawn, and the worker tries the cookie only when it is set. Every 401
refresh counts toward the server's per-IP limit, and the cookie is `HttpOnly`,
so nothing else can tell a tab whether one exists. With the hint lost, the
person signs in again, and the orphaned session idles out in 30 days.

**5. Fonts: the system stack, not Public Sans.** `ui: { fonts: false }` switches
off `@nuxt/fonts`, which would download a Google font at build time, make every
CI build depend on the network, and serve the files from `/_fonts/`, outside the
immutable cache. The visual design note allows font changes through tokens. The
maintainer can bring Public Sans back by bundling it locally. Related choices
the controller made under the approval of Nuxt and Nuxt UI: `vue-tsc` and
`@iconify-json/lucide` (Nuxt UI's icons must be bundled, because `connect-src`
is `'self'`) are dev dependencies of `apps/web`, and `vue` is an explicit
dependency, the same package Nuxt installs.

**6. No production image in W2.** Q9 has the image build the SPA. No Dockerfile
exists yet, and building one takes a multi-stage Dockerfile with `pnpm deploy`,
`prisma migrate deploy` on start, a health check, a compose service and an e2e
run against the image. It was a task of its own, left for W3, and shipped there (departure 11).

**7. Core error messages keep their CLI wording, and the UI does not show them
as copy.** W0 departure 6 left the rewording to W2. The worker maps errors to a
`Failure.kind`, and the UI shows an i18n string per kind. The core's message
appears only as a detail line. Rewording it would change CLI output for no
reader of the web.

**8. Firefox runs in CI, WebKit does not.** Firefox 155 (Playwright build 1543)
passes the suite without special handling: the `Secure` cookie on
`http://localhost`, Web Locks with `steal`, the OPFS pool in a module worker, the
pool retry, the service worker and the update prompt. Two gaps are in the
browser or its emulation, not the app. `offline, then online` is skipped in
Firefox: after `setOffline(false)` the page sees no `online` event, though
`navigator.onLine` flips and a manual sync succeeds. And Firefox neither
enforces nor reports CSP for a blob worker created inside the dedicated worker,
so the forwarder that turns worker violations into test failures is proved in
Chromium only. Safari's `Secure` cookies on `http://localhost` and its OPFS
quirks stay a documented risk in the README, untested. The "Safari and `Secure`
cookies" note above is therefore still open: W2 documented it and did not test
it.

**For W3:** `sync.problem` is published but nothing renders it, so a refused
sync is invisible except as offline. W3's screens show it; see "Departures in
plan W3".

### Behaviour worth knowing

- **Sync cadence.** A return to a tab (`focus` and `visibilitychange` together)
  collapses into one sync within 1 s. Ticks from several windows collapse in the
  engine: it drops a tick when the last sync ended less than 25 s ago, measured
  on the worker's clock. The e2e tick test therefore waits 26 s of real time,
  because Playwright's fake clock does not reach a dedicated worker.
- **An update reloads every prompted tab.** Accepting the prompt in one tab
  reloads each tab that showed it (vite-pwa's prompt mode listens for
  `controlling` in each). That keeps one build per origin, which the shared
  worker needs. Waiting for each tab's own click needs `onNeedReload`, a product
  decision.
- **The CI login budget is tight.** A run spends 16 or 17 of 20 logins and 15
  of 20 registrations per IP per 15 minutes. One CI retry fits, two hit the
  explicit 429 message.
- **For W3's write commands.** A command carries its operation id from the tab,
  so a resend after a worker crash is deduplicated by the server's `opId`.
  `withWriteLock` refuses a second concurrent caller on the same store (a
  re-entrant call would otherwise hang), so a command must not nest.
- **Sign-out keeps the replica** (open question 4): the data is the person's, and
  a sign-in as another account resets it.

## Departures in plan W3

Plan W3 (`docs/plans/2026-10-02-plan-w3-web-screens.md`) built the v1 screens
and the production image. It departs from this document and from the brief in
eleven places. The maintainer settled the plan's open questions: `uuidv7` is a
dependency of `apps/web` (nothing new in the lockfile), a closed one-off task
stays in the completing column for 7 days, and the image is not published to a
registry (the NAS builds from a checkout).

**1. `uuidv5` gets a synchronous SHA-1 in plain TypeScript.** The design never
said where the hash runs. One implementation serves Node and the browser, and
the existing vectors prove it unchanged. The alternatives were an async
`crypto.subtle`, which cannot run inside `Store.transaction`, or a SHA-1
library, a new dependency for about 60 lines.

**2. The replay guard is a marker, not byte-identical ops.** The tab mints the
command's `opId`, and creates also get their entity `id` from the tab. `submit`
records `op:<opId>` in `meta` inside the transaction that queues the ops, and a
write that finds the marker queues nothing and only flushes. Secondary op ids
(labels, seeds, moved tasks) are still minted in the worker. A resend after a
crash finds the marker if the first run committed, or runs fresh if it did not.
Markers older than 7 days are pruned on each write. Resending the ops
themselves would mint different ones against a changed replica.

**3. Deleting a status moves its tasks to `statusId: null`**, meaning the first
status, instead of to the first status's id (Q8). Same reasoning as V1
departure 2: null stays right when columns are reordered, and it releases the
status's foreign key so its tombstone can be pruned. It is still one batch.

**4. Ranks are a deterministic midpoint, and ties break by id.** ADR 0008 said
two offline insertions "produce two different strings"; they now produce the
same string, ordered by id. Since every existing task has `'a0'`, a move into a
run of equal ranks re-ranks that run as one batch of `set`s. ADR 0008 is
amended.

**5. The web seeds statuses after its first sync that reached the server**,
when the replica has no live status. A client that has not pulled cannot know it
found none (Q9). Two devices first started offline still seed twice, and the
merge, now run by the engine after every pull, folds them.

**6. The completing column shows one-off tasks closed in the last 7 days**, by
`fieldTs.state` of the occurrence row (a mark still in the outbox counts as
now). Q7 says where a closed task goes, not for how long. Known edge: the
window is measured in UTC while the card shows a local date, so a task closed
late in the evening can leave the column up to a day early or late for a
person far from UTC.

**7. Dragging in a view not sorted `manual` writes no rank.** Between columns
it sets the status and the card lands where the sort puts it. Within a column
it is not a drop target. Q10 leaves this open ("writes nothing, or switches the
view to manual"); switching silently would rewrite a view the person chose.

**8. "All open" is a built-in view, not a row.** Filter `{ "and": [] }`, list
layout, manual sort, key `all`; it cannot be edited or deleted. A synced default
would be seeded by every device, the same duplicate problem as Q9.

**9. The template form has fixed filter shapes.** *(Replaced in W4, departure
8: the tree is the editor.)* A view whose filter is not
exactly one of them opens in raw-JSON mode. The design names the templates, not
their trees.

**10. A recurring task's scheduled date is read-only in the drawer.** It is the
current occurrence (V1 departure 5). Changing it means editing `dtstart` or
`rrule`, which needs `baseVersion`. Moving one occurrence is the calendar's
(W4); editing `dtstart` or `rrule` is still not built.

**11. The production image ships in W3** (W2 departure 6). `prisma` moves from
the backend's dev dependencies to its dependencies so that the image can run
`migrate deploy`, and `files` lists what ships; no source file changes. The
image keeps the backend at `/app/apps/backend` and the OpenAPI document at
`/app/packages/specs/openapi`, because `create-app.ts` resolves it relative to
`dist/`. The build stage runs `pnpm deploy`, which skips `postinstall`, so
`prisma generate` runs explicitly, with OpenSSL installed so Prisma fetches
engines that load in the runtime image. The NAS service sits in
`docker/compose.yml` behind the profile `app`, so `up -d` still starts Postgres
alone. `JWT_SECRET` is interpolated as `${JWT_SECRET:-}`: Compose interpolates
every service, so `:?` would break plain `up -d`; the backend refuses an empty
secret itself. The host port is `${APP_PORT:-3000}`.

### Behaviour worth knowing in W3

- **Undo of a recurring task from the list acts on the default (current)
  occurrence**, because the write has no `on`.
- **A just-added column cannot be deleted before its first sync.** `deleteStatus`
  needs the row's `version`, which a column gets from the server; the core
  refuses with a reason instead of sending a guessed `baseVersion`. The same
  holds for views.
- **The sync badge counts queued operations, not user writes**: one drop can
  queue several.
- **Firefox flake.** The guard fixture's teardown `waitForLoadState` can hang in
  Firefox now and then; CI retries once. It is not an app failure.

## Departures in plan W4

Plan W4 (the web calendar and the filter-tree editor) has nine departures, listed
at the top of the
[plan](../plans/2026-10-02-plan-w4-web-calendar.md#where-this-plan-departs-from-the-design-docs-and-the-brief).
Eight touch the views design and are recorded there under
["Departures in the plan"](2026-10-01-views-design.md#departures-in-the-plan).
This one is about the shell.

**7. The calendar's week starts on Monday in both locales.** It is the order
of `WEEKDAYS` and of ISO weeks. A span is at most 42 days, the worker refuses a
wider one, and the mode and anchor date live in the URL
(`?mode=month&at=2026-10-01`).

### Behaviour worth knowing in W4

- **A stale-version conflict on Undo.** A copy edited on another device and not
  yet pulled sends a stale `baseVersion`: the delete comes back `conflict`
  while the reopen lands, so the original occurrence and the copy both show,
  and the badge counts one refused entry.
- **Dragging a copy back to its original day leaves it a copy.** Nothing merges
  it into the series; Undo does.
- **The filter tree.** A new group defaults to "All of". Nested Nots collapse
  to one switch, and each toggle unwraps one level. The Not toggle is disabled
  where it would exceed the node or depth limit. One problem alert serves both
  the tree and raw mode.

### Known follow-ups in W4

- **F1.** The engine has no span tests for `from > to` or non-ISO input.
- **F2.** The identity of a span is defined in more than one place.

### Fixed in W4

- **F3.** A layout switched in place with a stale span hung the tab; the span
  callback now returns null unless the layout is calendar, with an e2e test.
