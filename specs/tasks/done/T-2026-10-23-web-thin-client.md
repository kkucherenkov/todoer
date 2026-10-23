## T-2026-10-23-web-thin-client — Make the web a thin client of a server-side engine

- Created: 2026-10-23
- Owner: claude
- Status: done
- Blockers: —
- Spec: [Web thin client design](../../../docs/specs/2026-10-23-web-thin-client-design.md),
  [ADR 0020](../../../docs/adr/0020-the-web-reads-through-a-server-engine.md)
- Plan: [docs/plans/2026-10-23-plan-web-thin-client.md](../../../docs/plans/2026-10-23-plan-web-thin-client.md),
  Tasks 1–6

### Goal

The web keeps a full replica in the browser (SQLite WASM on OPFS, a leader tab,
a worker) and buys offline use it never gets, because the page is served from
the NAS. On 2026-10-23 Firefox failed the OPFS install and the page stopped at
"The local database did not start". The web stops keeping a replica: the
backend runs one client-core engine per user, and the page talks to it over
HTTP.

### Scenarios

1. **Given** a signed-in user, **When** the web opens, **Then** it shows what
   the server holds, with no database in the browser.
2. **Given** the screens the web has today, **When** the user opens lists,
   Today, Upcoming, projects, tags, saved views, the board, the calendar or the
   task drawer, **Then** each behaves as before.
3. **Given** an open page, **When** the same user changes a task in the TUI,
   the CLI or another tab, **Then** the page shows it within a couple of
   seconds without a reload.
4. **Given** two views of the same code, **When** the TUI and the web show the
   same view, **Then** both are computed by client-core.
5. **Given** a browser that ran the old version, **When** the new version
   loads for the first time, **Then** the old OPFS directory is deleted.

### Requirements

- **FR-001** The backend MUST run one client-core engine per signed-in user,
  on an in-memory `node:sqlite` replica, with an in-process transport into
  `SyncService.sync` (← design, "The engine moves to the server")
- **FR-002** The backend MUST expose `POST /engine` (a tab's `Command` →
  `Result`) and a server-sent event stream per tab, described in
  `openapi.yaml` before the code, both taking the bearer token (← design,
  "Contract", "Sign-in and the session"). A request's user MUST be the
  guard's user, with no access to another user's engine or tabs. `Command` MUST
  be validated against the OpenAPI schema. A stream MUST end when the access
  token it was opened with expires.
- **FR-003** A sync that wrote anything for a user MUST make that user's
  loaded engine sync with the reason `remote`, which queues one sync even
  mid-sync, and publish its topics to every open stream of the user (← design,
  "Live updates")
- **FR-004** A server engine write whose op is still pending after its send
  MUST return `unexpected`, drop the op from the outbox and republish; the
  option is off by default, so the TUI is unchanged (← design, "A write the
  server did not take")
- **FR-005** The web MUST read and write only through `/engine` and its
  stream, with no worker, leader election, OPFS or SQLite WASM; while the
  stream is down it MUST say the server cannot be reached and disable every
  write control (← design, "Losing the connection", "What gets removed")
- **FR-006** On its first load the web MUST delete the OPFS directory the old
  version created (← design, "Clearing what the browser kept")
- **FR-007** The backend container MUST set `TZ` to the maintainer's zone in
  compose, so "Today" is computed in it (← design, "Today")

### Edge cases

- Two tabs on one view: a write in one shows in the other without a reload
  (FR-002, FR-003, T006)
- A CLI change reaches an open page within 5 s (FR-003, T003, T006)
- The backend restarts while a page is open: the page shows it cannot reach the
  server, blocks writes, and recovers with fresh data (FR-005, T005, T006)
- `SyncService` throws during a web write: the tab gets a failure and the
  optimistic row disappears (FR-004, T001, T004)
- A closed stream withdraws its tab's watch; with no stream left the engine
  unloads after 5 min, and a later request reloads it (FR-001, FR-003, T004)

### Definition of Done

- **SC-001** The web opens and edits tasks in Firefox with the browser's site
  data empty, and a change made in the TUI appears on the open page within 5 s.
  The e2e suite proves it in Firefox from a fresh context, with the CLI in
  the TUI's place (both write through `POST /sync`); the TUI itself is the
  maintainer's check.
- [x] every FR has a test that failed before the code made it pass, with two
      exceptions: FR-006's cleanup was written with its spec and then
      mutation-checked, and FR-007 (`TZ` in compose) is configuration,
      checked by hand in Task 4
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-003, FR-004] Client-core: online-only writes and the `remote`
  sync reason — `packages/client-core/` (Task 1)
- [x] T002 [FR-002] OpenAPI `/engine` and `/engine/events` —
  `packages/specs/openapi/openapi.yaml` (Task 2)
- [x] T003 [FR-001, FR-003] Backend ChangeFeed and the in-process transport —
  `apps/backend/` (Task 3)
- [x] T004 [FR-001, FR-002, FR-003, FR-004, FR-007] Backend EngineHub, engine
  routes, `TZ` in compose — `apps/backend/`, `docker/compose.yml` (Task 4)
- [x] T005 [FR-005, FR-006] Web app and db over HTTP; worker, OPFS and SQLite
  WASM removed; OPFS cleanup; writes disabled while disconnected —
  `apps/web/` (Task 5)
- [x] T006 [FR-005] End-to-end scenarios and documentation —
  `apps/web/e2e/`, `.claude/CLAUDE.md`, `docs/` (Task 6)
- **Checkpoint:** the web runs with no browser replica and follows the TUI live.

### Open questions

- None.
