# The web becomes a thin client — design

- **Status:** accepted, 2026-10-23
- **Supersedes in part:** the web's storage and leader election in
  [`2026-10-01-client-shells-design.md`](2026-10-01-client-shells-design.md);
  amends [ADR 0012](../adr/0012-no-rest-surface.md).

## Why

The web keeps a full replica in the browser: SQLite WASM on OPFS, a leader tab
elected through Web Locks, a dedicated worker, retries around exclusive OPFS
handles. That buys offline use, and the web never gets any: it is served from
the maintainer's NAS, so without the network or the NAS the page does not load
at all.

What it costs showed on 2026-10-23: Firefox answered the OPFS install with
`UnknownError: Unknown failure`, the engine failed three times, and the page
stopped at "The local database did not start". The only recovery is clearing
the site's data by hand in the browser settings.

The maintainer opens the web on a desktop or a laptop to look at tasks, add
one, and mark one done; the TUI is the main client. Local-first stays where it
pays: the CLI, the TUI and the future mobile app.

## Goals

- The web shows what the server holds. No database in the browser.
- Every screen the web has today stays, with the same behaviour: lists, Today,
  Upcoming, projects, tags, saved views, the board, the calendar, the task
  drawer with subtasks, recurrence, priorities and dates.
- Live: a change made in the TUI, the CLI or another tab reaches an open page
  within a couple of seconds, without a reload.
- The view logic exists once. The server computes what the web shows with the
  same client-core code the TUI uses.

## Non-goals

- Offline use of the web. Losing the connection blocks editing until it is
  back; nothing is queued in the browser.
- Any change to the CLI, the TUI or `POST /sync`.
- More than one backend process. The design assumes one, as the NAS runs it.

## Anti-goals

- A second read path with its own filters (ADR 0012's warning). A REST
  endpoint per view, computed by backend code written for it, is exactly that.
- A page that claims a change was saved when the server never took it.

## Decision: the engine moves to the server

The browser's worker runs `createEngine` from client-core. The server runs it
instead: one engine per signed-in **user**, not per tab, holding the user's
replica in an in-memory `node:sqlite` database through the existing
`./node-sqlite` adapter (the backend runs Node 24). The engine already serves
several tabs: `engine.handle(command, tab)` keeps each tab's watched view,
task, span and layout apart, so the user's tabs on every device share the one
engine.

The page keeps the protocol it speaks today, `Command` → `Result` and
`Topics`, over HTTP instead of a `BroadcastChannel`:

| Today (browser)                      | After (server)                                   |
| ------------------------------------ | ------------------------------------------------ |
| tab → worker: `request` message      | `POST /engine` with `{ tab, id, command }`        |
| worker → tabs: topic `publish`       | a server-sent event stream per tab                |
| `hello` → snapshot                   | opening the stream sends the snapshot             |
| leader election, Web Locks           | gone                                             |
| SQLite WASM, OPFS pool, retries      | gone                                             |
| `dispatcher` dedupes `tab:id`        | unchanged, runs on the server                    |

### The engine's transport

The engine's `send` stops being `httpTransport`. On the server it calls
`SyncService.sync(userId, request)` in the same process and wraps the outcome
in a `Response`, so `sync.ts` reads it as it reads the network today. Every
invariant `POST /sync` enforces (the field allow-list, owner-scoped foreign
keys, depth, deletion rules, the per-user write lock) applies to the web's
writes unchanged, because they go through the same method.

Shape checks are a different matter: the op schema, `maxItems` and
`additionalProperties: false` are enforced by `express-openapi-validator` on
`POST /sync`, which an in-process call bypasses. The ops here are built by
client-core on the server, not taken from the browser; the untrusted input is
the `Command` on `/engine`, and that is what the validator checks there.

### Session on the server

`createEngine` runs only for a signed-in session (`EngineDeps.auth` and
`tokens`; the owner comes from the access token's claims). The server engine
gets a token source that mints a short-lived access token for its user with
the backend's own signer and renews by minting again, and an `auth` whose
calls are never reached. The engine stays unchanged for the TUI. _Builder's
call recorded here: no refactor of `createEngine` to take a user id._

### A write the server did not take

On the network a 5xx leaves an op pending and the write returns `ok`: right
for a local-first client, wrong here, where nothing will retry it and the
anti-goal forbids the claim. The server engine therefore runs with an option
(default off, so the TUI keeps today's behaviour) under which a write whose op
is still pending after its send returns `unexpected`, the op is dropped from
the outbox, and the engine republishes, which removes the optimistic overlay
from every tab.

### "Today"

`localDate` reads the process's local clock fields, which on the server are
the container's. The backend container gets `TZ` set to the maintainer's zone
in compose. _Ceiling, recorded: one zone for every tab; per-tab zones would
mean passing a zone in `watch`, wanted only if the web is opened from another
zone._

### Live updates

After a sync that wrote anything for a user commits, `SyncService` notifies
that user's engine, if one is loaded, and the engine syncs with a new
`SyncReason`, `remote`. Not `tick`: a tick within 25 s of the last sync is
dropped, and one arriving during a sync does not queue another. `remote` must
queue one, so a change landing mid-sync is not missed. Its topics go to every
open stream of the user; each tab keeps filtering view and task topics by what
it watches, as `client.ts` does today. A closed stream withdraws its tab's
watch, or the long-lived engine recomputes views for tabs that are gone.
The browser's sync cadence (`cadence.ts`) goes away: nothing in the browser
syncs.

### Lifecycle

- An engine loads on the first stream or request of a user after the backend
  started, and its first sync is `since: 0`.
- It unloads after five minutes with no open stream (the builder may tune the
  number). A restart loses nothing: Postgres holds the truth.
- Its outbox lives in memory and holds an op only while its send runs (see "A
  write the server did not take").

### Sign-in and the session

Sign-in, registration and sign-out leave the engine. The page calls the
existing `/auth` routes itself with `CookieAuthApi` and keeps its access token
in a `CookieTokenSource`, as it does now. `/engine` and the stream take the
bearer token; the stream is read with `fetch` and a body reader, not
`EventSource`, which cannot send an `Authorization` header. Tokens never go in
a URL.

The page builds the `session` and `engine` topics from its own state: `session`
from the token source, `engine` from the stream (`starting` while it connects,
`ready` once the snapshot arrived). `AppGate` keeps its shape.

Every tab holds its own token source, and all of them share the cookie. A
sign-out in one tab removes the `todoer.session` hint, and every other tab
hears it as a `storage` event and signs out too. A renewal that answers as
another account (someone signed in from another tab) signs the page out
instead of showing that account's data under the first one's view.

A request whose user is not the engine's user is refused; the `tab` value is
the client's own and scoped to the user.

### Losing the connection

When the stream drops, the page shows that the server cannot be reached and
disables every write control until the stream is back; it reconnects with
backoff and receives a fresh snapshot. A command sent while the server is
unreachable fails as `unreachable`, as it would now.

### Clearing what the browser kept

On its first load the new version deletes the OPFS directory the old version
created. Writes the old outbox never sent are lost; the maintainer's only web
browser could not open that database anyway.

## Contract

- `/engine` and the stream go into `packages/specs/openapi/openapi.yaml` first
  (spec first, as always). `Command` gets a schema there, because the backend
  validates what the browser sends. `Result` and the stream's events are
  described as objects without a closed schema: their types come from
  client-core (`Topics` is built from `operations.ts` return types), and a
  hand-written copy would be a second source of truth. Nothing generates web
  types from them; the web keeps importing client-core's.
- A new ADR records the decision and amends ADR 0012: `/sync` stays the only
  write path for local-first clients and the only path into the database for
  everyone; `/engine` is the web's way in, and it reads through client-core,
  not through a second set of queries.

## What gets removed

- `apps/web/app/db/worker.ts`, `leader.ts`, `pool.ts`, `cadence.ts` and the
  web's dependency on `@sqlite.org/sqlite-wasm`.
- Client-core's `./sqlite-wasm` entry, if nothing else imports it.
- Web e2e scenarios that exist only for the browser replica: offline writes,
  reload with an unsent outbox, the leader handing over between tabs. Tabs that
  see each other's changes stay, now through the server.

## Documents to update in the same change

`.claude/CLAUDE.md` (the `apps/web` row and the client-core row), ADR 0012's
status line, `docs/design/DESIGN.md` (the engine-failed and offline states),
and the client-shells design's web storage sections, marked superseded.

## Left to the builder

- Nest's `@Sse()` or a raw response for the stream; the event format inside it.
- How the in-process transport maps `HttpException`s to statuses.
- Whether the engine map sits in a new Nest module or beside `SyncService`.
- How the page's write controls show "disabled while offline".
- The order of the work and how it splits into pull requests.
