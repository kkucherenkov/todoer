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
| **client core** | The logic every client shares: replica, outbox, overlay, expander, current occurrence, duplicate-name merge, quick-add parsing, labels, statuses and views. Lives in `apps/cli` today. | SDK, engine |
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
   Playwright harness. No feature screens.
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
  occurrence) and the filter-tree editor come in the next plan.
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
  `filterProblem` may sit behind the same form.
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
    comes back refused later.
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
- The CLI's client logic is about 3 000 lines in `apps/cli/src` (excluding
  specs), on `node:sqlite` through `Store`, with `BEGIN IMMEDIATE` write
  transactions.
- The auth limiters key on `req.ip`, and `main.ts` sets no `trust proxy`.
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

- **Calendar layout and the filter-tree editor.** The plan after W3.
- **CLI device-code flow approved from the web.** After v1.
- **Server push (SSE).** Reopens if 30 s polling proves too slow.
- **Flutter.** Its own interview and design after the web client ships.

## Open threads

None.
