# todoer

Self-hosted personal task and information manager: offline-first, with web, CLI and Flutter clients.

## What works today

The sync contract works end to end: push, pull, last-write-wins conflict
resolution, tombstone pruning, and recovery from a stale cursor via `410 Gone`
and a fresh snapshot. The CLI is an offline-capable client for it, backed by a
local SQLite replica and outbox. A task created through the CLI reaches a
second, independent CLI invocation through the server, over one endpoint:

- **`POST /api/v1/sync`** — push operations, pull changes, resolved per field
  by last-write-wins with a shared cursor. This is the whole write surface;
  there is no REST CRUD and there will not be one ([ADR 0012](docs/adr/0012-no-rest-surface.md)).
- **`/api/v1/auth/*`** — sessions with a 15-minute access token and a rotating
  refresh token (reuse detection, 30-second grace window) carried in the body,
  or, for the web client, in an `HttpOnly` cookie (`transport: cookie`), owner-first
  registration (the first account is the owner, later ones need a single-use
  invitation), password change, reset without mail, account deletion, and
  rate-limited login ([ADR 0011](docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md),
  [ADR 0014](docs/adr/0014-owner-first-registration-and-two-path-reset.md)).
  The device-code flow and mail for `forgot` are not built yet.
- **`WEB_ROOT`** — the backend serves a built web client from this directory on
  the API's origin; see [Serving the web client](#serving-the-web-client).
- **The web client** (`apps/web`) is a shell: sign-in with the refresh cookie,
  a sync that runs in the background, and a count of the tasks in the local
  replica. The replica lives in the browser (SQLite WASM on OPFS) and is owned
  by one worker, which every tab of the origin shares, so a second tab shows
  the same state without a second sync. It opens offline as an installable app
  (a service worker caches the shell), shows an offline badge, speaks English
  and Russian, and asks before it reloads onto a new build. The feature screens
  (lists, views, kanban, quick-add, the task card) come in plan W3.
- **`todoer login` / `logout` / `add` / `list` / `done` / `skip` / `undo` / `outbox`** — a network
  client with `--json` output and exit codes a script can branch on
  ([ADR 0015](docs/adr/0015-the-cli-is-a-client-for-automation.md)). It keeps a
  local SQLite replica and outbox: every operation is queued before it is sent
  and keeps its id on every retry, so every write is safe to run once. Without a
  reachable server a command answers from the replica and exits 5. Recurring
  tasks are created with `--rrule` and listed at their current date; `done`,
  `skip` and `undo` take the short reference `list` prints. Quick-add stores
  `#project` and `@tag`, and `list @tag #project` filters by them. `list` ends
  each line with the task's status when the account has statuses; `done` moves a task to the completing
  status and `undo` clears it (the first `done` seeds `Inbox`, `Doing` and
  `Done` if the account has no statuses). `todoer views` lists the synced views
  and `list --view <name>` applies one's filter and sort (layout is ignored).

Not built yet, and each absence is deliberate rather than forgotten: the Flutter
client.
[The plan](docs/plans/2026-09-25-walking-skeleton.md#what-this-plan-does-not-do)
lists plan A's original exclusions, narrowed since by plans B and C (offline,
recurrence).

## Layout

| Path                                      | Holds                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/`                           | NestJS 11 server, Prisma 6, the sync protocol                                                                              |
| `apps/cli/`                               | the `todoer` command, a network client with no privileged access, running on `packages/client-core`                        |
| `apps/web/`                               | the web client, a Nuxt 4 SPA: the leader tab's worker runs `packages/client-core` on SQLite WASM; the backend serves the build |
| `packages/client-core/`                   | the logic every client shares: replica, outbox, sync, overlay, recurrence, labels, merge, views, on a synchronous SQLite adapter |
| `packages/specs/`                         | the OpenAPI document and the client generated from it                                                                      |
| `docker/compose.yml`                      | Postgres 18 for local development, on port **5433**                                                                        |
| `scripts/`                                | the end-to-end proofs (`walking-skeleton.sh`, `outbox-e2e.sh`) run in CI, and their owner-aware helper `lib/fresh-user.sh` |
| `docs/adr/`, `docs/specs/`, `docs/plans/` | decisions, design, plans                                                                                                   |
| `specs/tasks/`                            | the task stack — one file per task, `active/` then `done/`                                                                 |
| `.claude/CLAUDE.md`                       | the working agreement                                                                                                      |

`packages/client-core`'s `./sqlite-wasm` entry is the web's adapter. Its types
import `@sqlite.org/sqlite-wasm`, an optional peer dependency: a consumer that
imports the entry installs the peer, and the CLI, which does not, never does.

## Running it

Node 24.15 or newer, pnpm 9.12, Docker.

```sh
pnpm install
docker compose -f docker/compose.yml up -d        # Postgres on 5433

export DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer
export JWT_SECRET=local-only-secret-at-least-32-characters-long

pnpm --filter @todoer/backend exec prisma migrate deploy
pnpm build
PORT=3010 node apps/backend/dist/main.js
```

Then, in another shell, create the owner and sign in. The first account on an
empty instance becomes the owner:

```sh
export TODOER_URL=http://localhost:3010/api/v1
curl -sf -X POST "$TODOER_URL/auth/register" -H 'content-type: application/json' \
  -d '{"email":"you@example.test","password":"correct horse 9 battery!"}' >/dev/null

TODOER_PASSWORD='correct horse 9 battery!' node apps/cli/dist/index.js login you@example.test
node apps/cli/dist/index.js add "buy milk p2"
node apps/cli/dist/index.js list --json
node apps/cli/dist/index.js --help
```

A password needs at least 8 characters with a letter, a digit and another
character. Further users need an invitation from the owner
(`POST /auth/invites`, valid 7 days, single use) and register with it. If the
owner forgets the password, run `pnpm --filter @todoer/backend run owner:reset-password`
on the host: it prints a code, valid 15 minutes, for `POST /auth/reset`. The
owner resets other users through `POST /auth/users/{id}/password`.
Login and registration each have their own budget of 20 attempts per IP per
15 minutes, and login also allows 5 per address.

The web client. `pnpm --filter @todoer/web dev` serves it on 3001 and proxies
`/api` to the backend on 3000, so the refresh cookie's `Path` holds. Open
`http://localhost:3001`, not `127.0.0.1`: only the name is a secure context for
the `Secure` cookie. To have the backend serve it instead, build the SPA and
point `WEB_ROOT` at the output:

```sh
pnpm -w exec turbo run build --filter=@todoer/web...
WEB_ROOT=apps/web/.output/public PORT=3010 node apps/backend/dist/main.js
```

The proof that the loop closes:

```sh
TODOER_URL=http://localhost:3010/api/v1 sh scripts/walking-skeleton.sh
# walking skeleton passed
```

The scripts sign in as the owner (registering it on an empty instance) and
invite a fresh user for each run. On an instance whose owner uses other
credentials, set `OWNER_EMAIL` and `OWNER_PASSWORD`. Every login and
registration, successful or not, counts toward a per-IP budget of 20 per
15 minutes, so many rapid runs from one address can hit `429`; wait the
seconds in its `Retry-After` header (up to 15 minutes).

### Serving the web client

Set `WEB_ROOT` to a directory holding a built SPA (it must contain
`index.html`; the backend refuses to start otherwise). The backend serves its
files on the API's origin and answers every other `GET`/`HEAD` that accepts
`text/html` with `index.html`, except under `/api` and `/health`. Every static
response carries a content security policy that allows inline script only by
the hashes of the inline scripts in `index.html`. Unset, the backend serves
nothing.

- **A new build needs a restart.** `index.html` and its CSP hashes are read
  once at startup; replacing the files under a running backend serves the new
  assets with the old page and policy.
- **A new build reaches an open tab as a prompt.** The service worker never
  reloads a tab on its own. Accepting the prompt in one tab reloads every tab
  that showed it, which keeps one build per origin, as the shared worker needs.
- **`WEB_ROOT` is trusted content.** Symlinks inside it are followed, so
  point it at a directory you build, not one anyone else can write to.

The web client needs HTTPS. The refresh cookie is `Secure`, and service workers
and OPFS need a secure context. Over plain `http://nas.local` the web client
cannot sign in; `localhost` is the exception. TLS comes from your reverse proxy:

```text
todo.example.test {
    reverse_proxy localhost:3000
}
```

Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies in front
(usually `1`) or to their addresses. Unset, every client behind a proxy shares
one IP for the rate limits. To reach the instance from outside without opening
ports, `tailscale serve` gives it an HTTPS name inside your tailnet.

Browsers. Chromium and Firefox are tested in CI. Firefox skips one case, the
return from offline to online, because Playwright's emulation fires no `online`
event there; the app syncs on a manual "Sync now" after it. The blob-worker
check is the guard fixture, not a separate test: a blob worker is refused under
the CSP and reported there, but only in Chromium. Firefox neither enforces nor
reports it for a worker created inside a worker, so the guard is effective in
Chromium only. Safari is untested: OPFS needs 16.4 or newer, and its handling
of `Secure` cookies on `http://localhost` differs, so use HTTPS. Signing out
keeps the local replica in the browser; signing in as another account resets
it. A one-bit hint in `localStorage` (`todoer.session`) tells a signed-out tab
not to try a cookie refresh, since each failed refresh counts against the
per-IP limit. Clearing site data loses the hint, and the person signs in again.

The cookie (`todoer_refresh`, `Path=/api/v1/auth`, Max-Age 30 days) can outlive
a session near its 365-day absolute limit by up to 30 days; the server answers
401 and the client signs out. A request carrying two `todoer_refresh` cookies
is treated as carrying none, and a refused cookie refresh clears the cookie.
See [ADR 0011](docs/adr/0011-bearer-everywhere-cookie-only-for-refresh.md).

### Environment

| Variable                        | Read by     | Default                                          | Notes                                                                                      |
| ------------------------------- | ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | backend     | —                                                | required; Postgres connection string                                                       |
| `JWT_SECRET`                    | backend     | —                                                | required; signs the access token, at least 32 characters                                   |
| `PORT`                          | backend     | `3000`                                           | refuses a value that is not a whole port number                                            |
| `TRUST_PROXY`                   | backend     | unset                                            | proxy hop count (`1`) or addresses/subnets (`loopback, 10.0.0.0/8`); `true` is refused     |
| `WEB_ROOT`                      | backend     | unset                                            | a built SPA to serve on the API's origin; must hold `index.html`; unset serves nothing     |
| `APP_VERSION`                   | backend     | `0.0.0-dev`                                      | reported by `GET /api/v1/health`                                                           |
| `TODOER_URL`                    | CLI         | `http://localhost:3000/api/v1`                   | instance base URL                                                                          |
| `TODOER_TOKEN`                  | CLI         | —                                                | bearer token; when set it is used as is, never refreshed, and overrides the stored session |
| `TODOER_PASSWORD`               | CLI         | —                                                | the password `todoer login` uses instead of a prompt or stdin                              |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | e2e scripts | `owner@example.test`, `correct horse 9 battery!` | the owner the scripts sign in as                                                           |
| `TODOER_TIMEOUT_MS`             | CLI         | `3000`                                           | how long to wait for the server before exiting 5                                           |

The examples above use **3010** because 3000 is often already taken; the
backend's own default is 3000.

### Two things that will bite a script

**The access token lives 15 minutes, and the CLI refreshes it itself.**
`todoer login` stores the session; later commands renew the access token
shortly before it expires, and once more on a `401`. A session that has ended
(revoked, idle for 30 days, or a year old) exits **1** (a refusal), not 5 (the
server was not reached), precisely so a retry policy does not loop on it; the
stored tokens are cleared and the fix is `todoer login` again. `TODOER_TOKEN`
bypasses all of this: it is used as is and never renewed, so an agent that sets
it owns the expiry. `todoer --help` lists all the exit codes.

**A queued write is not on the server yet.** Every operation is stored in a
local outbox before it is sent and keeps the same id on every retry, so a
retry after a lost response settles as a `duplicate` rather than creating the
task twice ([ADR 0005](docs/adr/0005-client-generated-identifiers.md),
[ADR 0015 §4](docs/adr/0015-the-cli-is-a-client-for-automation.md)). Without a
reachable server the command answers from the local replica and exits **5**
instead of 0 — a caller that checks only for success has to treat 5 as "not
yet delivered", not as a failure to retry.

## Tests

```sh
export DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test
export JWT_SECRET=local-only-secret-at-least-32-characters-long
pnpm -w exec turbo run build typecheck test
```

The backend's specs empty every table in the database they connect to, so the
suite **refuses to run** unless `DATABASE_URL` names a database ending in
`_test`. It is not a formality: the review that introduced this guard
destroyed the development database first. Create the test database once:

```sh
docker exec todoer-dev-postgres-1 createdb -U todoer todoer_test
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm --filter @todoer/backend exec prisma migrate deploy
```

The web client's end-to-end suite runs Playwright against the built SPA served
by the backend under its real CSP. It needs an **empty** database (registration
is owner-first), so give it a scratch one, never the development database:

```sh
docker exec todoer-dev-postgres-1 createdb -U todoer todoer_e2e
export DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_e2e
export JWT_SECRET=local-only-secret-at-least-32-characters-long
pnpm --filter @todoer/backend exec prisma migrate deploy
pnpm -w exec turbo run build --filter=@todoer/backend... --filter=@todoer/cli... --filter=@todoer/web...
pnpm --filter @todoer/web exec playwright install chromium firefox   # once
pnpm --filter @todoer/web e2e
```

The suite spends a fixed share of the per-IP auth budgets, however many tests
it has: `e2e/global-setup.ts` registers one account per browser, each worker
logs it in once, and every test continues that one session with a refresh
(the server counts only failed refreshes) after wiping the account's data.
Only the sign-in tests use the form. A run takes about 7 of the 20 logins and
3 of the 20 registrations per 15 minutes, so two runs in a row fit. A failed
test restarts its worker, which costs one more login.

## Changing the API

The OpenAPI document is the contract, and `express-openapi-validator` enforces
it at runtime in both directions. Edit it first, then regenerate:

```sh
pnpm spec:validate
pnpm spec:codegen        # regenerates packages/specs/src/generated
```

A route that is not in `packages/specs/openapi/openapi.yaml` does not exist.

## Conventions

- Pull requests only; the PR title is a Conventional Commit and CI checks it.
- Every decision that would otherwise be re-argued gets an ADR in `docs/adr/`.
- One file per task under `specs/tasks/active/`, moved to `done/` when it ships.
- `pnpm lint` runs type-aware ESLint in every package, then Prettier; CI runs
  it as `Lint`. `pnpm format` fixes the formatting. Markdown is left to its
  author: Prettier rewrites emphasis and fenced code, which is churn in ADRs
  and plans that are records.
- `.git-blame-ignore-revs` lists formatting-only commits. GitHub skips them in
  blame on its own; locally, run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.
