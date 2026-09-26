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
- **`POST /api/v1/auth/register`, `POST /api/v1/auth/login`** — open
  registration and a 15-minute bearer token. Invitations, password reset,
  refresh rotation and the device-code flow are not built yet.
- **`todoer add` / `todoer list` / `todoer outbox`** — a network client with
  `--json` output and exit codes a script can branch on
  ([ADR 0015](docs/adr/0015-the-cli-is-a-client-for-automation.md)). It keeps a
  local SQLite replica and outbox: every operation is queued before it is sent
  and keeps its id on every retry, so `add` is safe to run once. Without a
  reachable server a command answers from the replica and exits 5.

Not built yet, and each absence is deliberate rather than forgotten: storing
`#project` and `@tag` from quick-add, recurrence, and the web and Flutter
clients. The full list, with reasons, is in
[the plan](docs/plans/2026-09-25-walking-skeleton.md#what-this-plan-does-not-do).

## Layout

| Path | Holds |
| --- | --- |
| `apps/backend/` | NestJS 11 server, Prisma 6, the sync protocol |
| `apps/cli/` | the `todoer` command, a network client with no privileged access |
| `packages/specs/` | the OpenAPI document and the client generated from it |
| `docker/compose.yml` | Postgres 18 for local development, on port **5433** |
| `scripts/walking-skeleton.sh` | the end-to-end proof, run in CI |
| `docs/adr/`, `docs/specs/`, `docs/plans/` | decisions, design, plans |
| `specs/tasks/` | the task stack — one file per task, `active/` then `done/` |
| `.claude/CLAUDE.md` | the working agreement |

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

Then, in another shell, mint a token and use the CLI:

```sh
export TODOER_URL=http://localhost:3010/api/v1
export TODOER_TOKEN=$(curl -sf -X POST "$TODOER_URL/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.test","password":"correct horse battery staple"}' \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

node apps/cli/dist/index.js add "buy milk p2"
node apps/cli/dist/index.js list --json
node apps/cli/dist/index.js --help
```

The proof that the loop closes:

```sh
TODOER_URL=http://localhost:3010/api/v1 sh scripts/walking-skeleton.sh
# walking skeleton passed
```

### Environment

| Variable | Read by | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | backend | — | required; Postgres connection string |
| `JWT_SECRET` | backend | — | required; signs the access token, at least 32 characters |
| `PORT` | backend | `3000` | refuses a value that is not a whole port number |
| `APP_VERSION` | backend | `0.0.0-dev` | reported by `GET /api/v1/health` |
| `TODOER_URL` | CLI | `http://localhost:3000/api/v1` | instance base URL |
| `TODOER_TOKEN` | CLI | — | bearer token; see below |

The examples above use **3010** because 3000 is often already taken; the
backend's own default is 3000.

### Two things that will bite a script

**The access token lives 15 minutes**, and the CLI has no `login` command yet.
A long-running agent has to mint a new one from `POST /auth/login` when it
expires. An expired token exits **1** (a refusal), not 3 (a network failure),
precisely so a retry policy does not loop on it. `todoer --help` lists all the
exit codes.

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
