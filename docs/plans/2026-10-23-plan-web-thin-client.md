# Web thin client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web stops holding a replica; the backend runs one client-core
engine per signed-in user and the page talks to it over `POST /engine` and a
server-sent event stream.

**Architecture:** The backend creates `createEngine` over an in-memory
`openReplica(':memory:')`, with a transport that calls `SyncService.sync` in
process and a token source that mints its user's access token. `SyncService`
announces each committed write per user; the user's engine syncs with the new
reason `remote` and its topics go to every open stream. The web keeps its `Db`
interface and screens; only `app/db/` changes underneath.

**Tech Stack:** NestJS 11 (Express), Nuxt 4 SPA, `@todoer/client-core`,
`node:sqlite`, Vitest, Playwright.

**Spec:** `docs/specs/2026-10-23-web-thin-client-design.md`

## Global Constraints

- Spec first: `/engine` and `/engine/events` land in
  `packages/specs/openapi/openapi.yaml` before the backend serves them;
  generated artefacts in their own commit (`pnpm spec:validate && pnpm
  spec:codegen`).
- `/sync` stays the only path into the database: the server engine writes
  only through `SyncService.sync`.
- The TUI and the CLI behave exactly as before: every core change is opt-in
  with a default that keeps today's behaviour.
- Tokens never appear in a URL; the stream is read with `fetch`, not
  `EventSource`.
- Engine unload delay: 5 minutes with no open stream.
- One backend process (design non-goal); mark the in-memory engine map with a
  `ponytail:` comment naming that ceiling.
- Commits: English, conventional, no `Co-Authored-By`, no mention of AI.
- Every `.md` passes `node_modules/.bin/prettier --check` (not the system
  prettier).
- Tests that need Postgres use a database whose name ends in `_test`.

## Review Focus

1. Two tabs on one view, a write in one: the other shows it without reload
   (Task 6 e2e `a write in one tab reaches the other`).
2. A change from the CLI while the page is open reaches it within 5 s
   (Task 6 e2e `a CLI write reaches an open page`).
3. The backend restarts while a page is open: the page shows it cannot reach
   the server, blocks writes, and recovers by itself with fresh data
   (Task 5 spec `reconnects and asks for a snapshot`, Task 6 e2e
   `writes are blocked while the stream is down`).
4. `SyncService.sync` throws during a web write: the tab gets a failure, not
   `ok`, and the optimistic row disappears (Task 1 spec
   `online-only: an unsent write fails and is dropped`, Task 3 spec
   `a throwing sync answers 500`).
5. A stream closes: its tab's watch is withdrawn, and with no stream left
   the engine unloads after the delay; a request after that reloads it
   (Task 4 specs `closing the last stream unloads after the delay`,
   `a request after unload loads the engine again`).

---

### Task 0: Task spec, ADR and the branch

**Files:**
- Create: `specs/tasks/active/T-2026-10-23-web-thin-client.md`
- Create: `docs/adr/0020-the-web-reads-through-a-server-engine.md`
- Modify: `docs/adr/0012-no-rest-surface.md` (status line only)

- [ ] **Step 1:** Write the task spec from `specs/tasks/templates/feature.md`:
  scenarios = the design's Goals; `FR-001` server engine per user, `FR-002`
  `/engine` + stream, `FR-003` live updates via `remote`, `FR-004` online-only
  writes, `FR-005` web without replica, `FR-006` OPFS cleanup, `FR-007` `TZ`;
  edge cases = Review Focus 1–5; steps `T001`–`T006` = Tasks 1–6 of this plan.
- [ ] **Step 2:** ADR 0020 (format of ADR 0018): context = the design's
  "Why"; decision = the design's "Decision" in three sentences; consequences:
  no second read path (views still come from client-core), the web has no
  offline mode, one backend process holds engines in memory.
- [ ] **Step 3:** ADR 0012 status → `accepted; amended by [0020](0020-the-web-reads-through-a-server-engine.md)`.
- [ ] **Step 4:** `node_modules/.bin/prettier --check` on the three files, commit
  `docs: record the server-side engine for the web`.

### Task 1: Core — online-only writes and the `remote` reason

**Files:**
- Modify: `packages/client-core/src/engine-protocol.ts:16-17`
- Modify: `packages/client-core/src/engine.ts` (`EngineDeps`, `write`)
- Test: `packages/client-core/src/engine.spec.ts`

**Interfaces:**
- Produces: `SyncReason` gains `'remote'`; `EngineDeps.onlineOnly?: boolean`
  (default `false`).

- [ ] **Step 1: Failing tests** in `engine.spec.ts`, using the file's existing
  fakes:
  - `remote during a running sync queues another`: start a sync that blocks
    on the transport, `handle({kind:'sync',reason:'remote'})`, release;
    expect the transport called twice.
  - `remote is not dropped by the tick gap`: finish a sync, advance the clock
    1 s, `remote` → transport called again.
  - `online-only: an unsent write fails and is dropped`: `onlineOnly: true`,
    transport answers 503; `handle(add)` → `{ok:false, failure:{kind:'unexpected'}}`,
    `store.counts().pending === 0`, and the last `view` topic does not list
    the task.
  - `online-only: a pending refusal fails and is dropped`: transport answers
    429 → same expectations.
  - `without online-only an unsent write still returns ok` (pins today's
    behaviour for the TUI).
- [ ] **Step 2:** `pnpm --filter @todoer/client-core test -- engine` → the new
  tests fail.
- [ ] **Step 3:** Add `'remote'` to `SyncReason`. In `write`, when
  `onlineOnly` and the result is not `synced` (or a pending `RefusalError` was
  caught): `store.drop([w.opId])`, return
  `fail('unexpected', 'the server did not take the change')`. `handle`'s
  `finally` already republishes.
- [ ] **Step 4:** tests pass; `pnpm -w exec turbo run build typecheck test
  --filter=@todoer/client-core...` green (the TUI and CLI build against it).
- [ ] **Step 5:** commit `feat(client-core): add online-only writes and the remote sync reason`.

### Task 2: Contract — `/engine` and `/engine/events`

**Files:**
- Modify: `packages/specs/openapi/openapi.yaml`
- Generated: `packages/specs` codegen output

**Interfaces:**
- Produces: `POST /engine`, body `EngineRequest { tab: string (uuid), id: integer ≥ 1, command: Command }`,
  200 `EngineResult` (object, `additionalProperties: true`), 401/400 Problem;
  `GET /engine/events?tab=<uuid>`, 200 `text/event-stream`, 401 Problem. Both
  bearer-authenticated like `/sync`.

- [ ] **Step 1:** Add `Command` as a `oneOf` over the `kind`s in
  `engine-protocol.ts` `Command`, **without** `signIn`, `register`,
  `signOut` (the page handles those). Each variant lists its fields from the
  TS type; nested `changes`, `fields`, `rule`, `span` are `type: object`.
- [ ] **Step 2:** `pnpm spec:validate` passes; commit
  `feat(specs): describe the web engine routes`.
- [ ] **Step 3:** `pnpm spec:codegen`; commit the generated diff alone,
  `chore(specs): regenerate for the engine routes`.

### Task 3: Backend — the change feed and the in-process transport

**Files:**
- Create: `apps/backend/src/sync/change-feed.ts`
- Modify: `apps/backend/src/sync/sync.service.ts` (`sync` announces)
- Create: `apps/backend/src/engine/in-process-transport.ts`
- Test: `apps/backend/src/sync/change-feed.spec.ts`,
  `apps/backend/src/engine/in-process-transport.spec.ts`,
  `apps/backend/src/sync/sync.service.spec.ts`
- Modify: `apps/backend/package.json` (add `"@todoer/client-core": "workspace:^"`)

**Interfaces:**
- Produces: `@Injectable() class ChangeFeed { announce(userId: string): void; listen(userId: string, fn: () => void): () => void }`;
  `inProcessTransport(sync: SyncService, userId: string): Transport`.

- [ ] **Step 1: Failing tests:**
  - `change-feed.spec.ts`: `listen` then `announce` calls fn once;
    `announce` for another user does not; the returned function stops it.
  - `sync.service.spec.ts` `announces a sync that applied an op`: a sync with
    one applied op calls `feed.announce(userId)` once; `does not announce a
    pull` (no ops) → zero calls.
  - `in-process-transport.spec.ts`: `answers 200 with the service's body`
    (`response.json()` equals the stubbed result); `a 400 from the service
    keeps its status` (`BadRequestException` → `status === 400`, body a
    Problem with its message); `a throwing sync answers 500`.
- [ ] **Step 2:** run them, they fail.
- [ ] **Step 3:** `ChangeFeed` is a `Map<string, Set<fn>>`. `SyncService`
  takes it in the constructor and calls `announce` after the per-user lock is
  released, when any result's status is applied (read `OpResult` for the
  name). The transport parses the request body, calls `sync.sync(userId,
  body)`, wraps in `new Response(JSON.stringify(x), { status, headers:
  {'content-type': 'application/json'} })`; an `HttpException` maps to its
  status with `{ title, status, detail }`; anything else to 500.
- [ ] **Step 4:** register `ChangeFeed` in `app.module.ts`; backend tests green
  (`DATABASE_URL=…/todoer_test pnpm --filter @todoer/backend test`).
- [ ] **Step 5:** commit `feat(backend): announce synced writes and sync in process`.

### Task 4: Backend — `EngineHub` and the engine routes

**Files:**
- Create: `apps/backend/src/engine/engine-hub.ts`,
  `apps/backend/src/engine/engine.controller.ts`
- Modify: `apps/backend/src/app.module.ts`, `docker/compose.yml` (`TZ`)
- Test: `apps/backend/src/engine/engine-hub.spec.ts`,
  `apps/backend/src/engine/engine.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 `onlineOnly`, `'remote'`; Task 3 `ChangeFeed`,
  `inProcessTransport`; `AuthService.signWithExpiry`; `openReplica(':memory:')`
  from `@todoer/client-core/node-sqlite`; `createEngine`, `dispatcher`.
- Produces: `class EngineHub { request(userId, tab, id, command): Promise<Result>; open(userId, tab, send: (event: FromWorker) => void): () => void }`.

- [ ] **Step 1: Failing tests** (`engine-hub.spec.ts`, real `SyncService` on
  the `_test` DB, fake timers for unload):
  - `the first request loads the engine signed in`: `request(u, t, 1, watch
    today)` → ok; a stream opened for `u` received `session` `signed-in`.
  - `a write lands in Postgres`: `request(add)` → ok, Prisma has the task.
  - `a sync by another client reaches the stream`: open a stream, call
    `SyncService.sync(u, {ops:[create]})` directly, expect a `view` publish
    listing it within the test's await of the feed.
  - `closing a stream withdraws its tab's watch`: after close, a publish
    does not recompute that tab's view (spy on publishes for its key).
  - `closing the last stream unloads after the delay`: advance 5 min → the
    hub holds no engine for `u`; `a request after unload loads the engine
    again`.
  - `two users never share an engine`.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3:** `EngineHub` holds `Map<userId, {engine, dispatch, streams:
  Map<tab, send>, unload?: Timeout, stop: () => void}>`. Load = `openReplica(':memory:')`,
  token source `{ current: () => mint().token, renew: () => mint().token,
  adopt() {}, signedIn: () => true }`, `auth` whose methods throw,
  `send: inProcessTransport`, `publish` fans out to every stream of the user,
  `onlineOnly: true`, `newId: uuidv7`; then `engine.start(true)`, and
  `feed.listen(u, () => engine.handle({kind:'sync', reason:'remote'}))`.
  `request` runs through `dispatcher` (build: a constant) so `tab:id`
  resends attach to one run. `open` calls `engine.snapshot()`; its closer
  sends `watch {view:null, task:null}` for the tab, removes the stream, and
  with none left arms the unload, which closes the store and stops the feed.
- [ ] **Step 4: Controller tests** (`engine.controller.spec.ts`, over HTTP as
  `create-app.spec.ts` does): `POST /api/v1/engine` without a bearer → 401;
  with a `signIn` command → 400 (validator); with `watch` → 200 `{ok:true}`;
  `GET /api/v1/engine/events?tab=…` → `content-type: text/event-stream`, the
  first event is a `publish` of `engine` `ready`.
- [ ] **Step 5:** `EngineController` (`@UseGuards(AuthGuard)`, version 1):
  `POST engine` → `hub.request`; `GET engine/events` → raw Express response:
  headers `text/event-stream`, `cache-control: no-cache`, each event
  `data: <json>\n\n`, a `: ping` comment every 25 s, close → closer.
- [ ] **Step 6:** `docker/compose.yml` app service: `TZ: ${TZ:-UTC}`. Check
  `docker run --rm -e TZ=Asia/Dubai node:24-bookworm-slim node -e
  "console.log(new Date().getTimezoneOffset())"` prints `-240`; if not, add
  `tzdata` to the runtime stage of the `Dockerfile`.
- [ ] **Step 7:** backend build, typecheck, test, lint green; commit
  `feat(backend): run a client-core engine per user for the web`.
- [ ] **Step 8:** open PR 1 (Tasks 0–4). The web still uses its replica; the
  new routes are unused.

### Task 5: Web — `app/db` over HTTP

**Files:**
- Rewrite: `apps/web/app/db/client.ts`, `apps/web/app/plugins/db.client.ts`
- Create: `apps/web/app/db/stream.ts`, `apps/web/app/db/forget-opfs.ts`
- Delete: `apps/web/app/db/worker.ts`, `leader.ts`, `pool.ts`, `cadence.ts`,
  `protocol.ts`, their specs; `packages/client-core/src/sqlite-wasm.ts` and
  its spec and `./sqlite-wasm` export; `@sqlite.org/sqlite-wasm` from both
  `package.json`s
- Modify: `apps/web/app/components/UpdatePrompt.vue`, `SyncStatus.vue`, and
  every write control listed in Step 5
- Test: `apps/web/app/db/client.spec.ts` (rewritten), `stream.spec.ts`

**Interfaces:**
- Consumes: Task 2 routes; `httpCookieAuthApi`, `cookieTokenSource` from
  client-core.
- Produces: `Db` keeps its type (`client.ts:17-38`) minus `stale`, plus
  `connected: Readonly<ShallowRef<boolean>>`. `readEvents(response:
  Response, on: (event: FromWorker) => void): Promise<void>` in `stream.ts`.

- [ ] **Step 1: Failing tests** (`client.spec.ts`, `fetch` stubbed):
  - `signIn is answered by the page`: `request({kind:'signIn'})` calls
    `/api/v1/auth/login`, not `/engine`; `session` topic becomes `signed-in`.
  - `a command goes to /engine with the bearer`.
  - `a 401 renews once and resends`.
  - `publishes from the stream land in topics`, filtered as today
    (`view` for another key dropped).
  - `reconnects and asks for a snapshot`: the stream ends → `connected`
    false, `engine` topic stays `ready`; after backoff a new stream opens,
    `connected` true.
  - `a write while disconnected fails as unreachable` without a fetch.
  - `stream.spec.ts`: `readEvents` splits events across chunk boundaries and
    ignores `:` comments.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3:** implement. `session`: `restoring` until `tokens.current()`
  settles on load (only with the `todoer.session` hint, as today), then
  `signed-in`/`signed-out`. `engine`: `ready` once the first stream event
  arrives, `starting` before. Sign-out closes the stream and clears `view`
  and `task`. Reconnect backoff 1 s doubling to 30 s.
- [ ] **Step 4:** `forgetOpfs()`: `navigator.storage.getDirectory()`, remove
  every entry recursively; every error swallowed (Firefox throws
  `UnknownError` here, which is how this started). Called once from the
  plugin, behind a `localStorage` flag `todoer.opfs-forgotten`.
- [ ] **Step 5:** `connected` false disables: `QuickAdd`, the row checkbox in
  `TaskRow`, `KanbanCard` drag, the `TaskDrawer` fields and its delete, the
  `ViewForm` save, `ColumnsDialog`; `SyncStatus` shows "cannot reach the
  server" (en and ru locale keys). `UpdatePrompt` listens to Nuxt's
  `app:manifest:update` hook instead of `db.stale`.
- [ ] **Step 6:** `pnpm -w exec turbo run build typecheck test lint
  --filter=@todoer/web... --filter=@todoer/client-core...` green.
- [ ] **Step 7:** commit `feat(web): read and write through the server engine`.

### Task 6: e2e and documents

**Files:**
- Delete: `apps/web/e2e/offline.spec.ts`
- Modify: `apps/web/e2e/tabs.spec.ts`, `shell.spec.ts`, any spec Step 1 finds
- Modify: `.claude/CLAUDE.md`, `docs/design/DESIGN.md`,
  `docs/specs/2026-10-01-client-shells-design.md`, `apps/web/README.md` if it
  names OPFS or the worker
- Move: the task spec to `specs/tasks/done/`

- [ ] **Step 1:** `rg -n 'offline|leader|OPFS|worker' apps/web/e2e` and drop or
  rewrite every scenario that tests the browser replica.
- [ ] **Step 2:** new e2e in `tabs.spec.ts`: `a write in one tab reaches the
  other` (two pages, add in one, visible in the other within 5 s);
  `a CLI write reaches an open page` (the suite's CLI helper adds a task,
  visible within 5 s); `writes are blocked while the stream is down`
  (`page.route('**/engine/events*', r => r.abort())` after load → QuickAdd
  disabled, then unroute → enabled).
- [ ] **Step 3:** full e2e locally per CLAUDE.md (an `_e2e` database).
- [ ] **Step 4:** docs: CLAUDE.md `apps/web` row ("thin client: the backend
  runs its engine, `POST /engine` + event stream") and the client-core row
  (drop `./sqlite-wasm`); DESIGN.md engine-failed/offline rows; superseded
  marks on the client-shells sections about storage, leader and worker.
- [ ] **Step 5:** commit `test(web): cover the server engine end to end` and
  `docs: describe the web as a thin client`; open PR 2.
