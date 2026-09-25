# todoer — quick reference

## Working agreement

Five rules that govern _how_ work happens here, independent of what is being
built. They apply to every task, including one-line fixes.

### 1. Answer in Russian

All prose addressed to the maintainer is in **Russian**. Code, identifiers, file
paths, commit messages, code comments, and everything committed to this
repository stay in **English** — the codebase has one language and it is not
the conversation's.

### 2. Plan before you touch anything

Every task starts with a plan, not an edit. Read the code the change touches,
trace the real flow end to end, then say what you intend to do before doing it.
For anything larger than a one-line fix, that plan becomes a file under
`specs/tasks/active/` **before** the first edit — not after.

If the task is ambiguous, if there is an architectural fork, or if a library
has to be chosen, ask **first**. A plan built on a guess costs more than the
question.

### 3. Update the documentation in the same pass

A change is not done when the code works. If the change alters behaviour,
structure, contracts, or setup, the docs that describe it change in the same
commit or PR.

**Never leave a document asserting something that is no longer true.** A stale
claim is worse than no claim.

### 4. Long-term memory lives outside the chat

Two tools, two roles, no overlap:

| Tool     | Holds                                            | Test                 |
| -------- | ------------------------------------------------ | -------------------- |
| `tuxedo` | **what still has to be done** — tasks, deadlines | a verb in the future |
| `dnote`  | **what was learned** — gotchas, rationale        | a fact in the past   |

Project key for both: `+todoer` / book `todoer`.

Write a note only when it will outlive the session **and** cannot be derived
from the repository. Never a retelling of the diff, the file layout, or git
history.

### 5. Record every change in the dnote changelog

One dedicated note holds the change history, newest first, one entry per landed
change:

```
YYYY-MM-DD · What changed — briefly, by substance.
```

What changed and why it matters, not which files were touched. Append before
reporting the work as finished.

## Task stack

One file per task: `specs/tasks/active/<id>.md` while it runs,
`specs/tasks/done/<id>.md` once it ships. Format and rationale in
[`specs/tasks/README.md`](../specs/tasks/README.md).

**Session start: read `specs/tasks/active/` first:**

```sh
find specs/tasks/active -name '*.md' -exec cat {} +
```

Not `cat specs/tasks/active/*.md` — with an empty stack that glob matches
nothing, which is an error in `sh` and refuses to run at all in `zsh`. The
first command of every session should not fail on the ordinary case of having
nothing in flight.

## Quality gates

The checks branch protection requires, spelled **exactly** as the branch
protection rule spells them. This list is read, not decorative: a required
check that has not started yet is absent from `gh pr checks` output, so a gate
that counts checks reads an unstarted one as passing. Compare against these
names.

- `PR title (conventional commit)`
- `Shell tests`
- `Workspace tests`
- `Lint`

`main` is **not** currently protected — `gh api repos/kkucherenkov/todoer/
branches/main/protection` returns 404 — so nothing enforces these or the
pull-request rule below. They are the convention this repository works to, and
the list is what a protection rule should name when one is added.

## Never do

- Commit to the default branch without a pull request.
- Skip updating `specs/tasks/active/` and `specs/tasks/done/`.
- Leave a document asserting something that is no longer true.

<!-- STACK:BEGIN -->

## The stack

A pnpm workspace under turbo. Three packages, and `@todoer/specs` is upstream of
both others — it holds the OpenAPI document and the client generated from it.

| Path | What |
| --- | --- |
| `packages/specs` | OpenAPI document, generated TS types and SDK. The contract. |
| `apps/backend` | NestJS 11, Prisma 6, PostgreSQL 18. `POST /sync` is the entire write surface. |
| `apps/cli` | The reference client. Its primary caller is a script or an agent — see ADR 0015. |
| `scripts/walking-skeleton.sh` | The end-to-end proof. CI runs it against a live backend. |

Design and rationale live in `docs/specs/`, `docs/adr/` and `docs/plans/`. The
ADRs are the binding authority when the code and a document disagree.

### Spec first, always

A route changes in `packages/specs/openapi/openapi.yaml` **before** it changes
in the backend — `express-openapi-validator` rejects drift at runtime, so a
mismatch surfaces as a 400 nobody expected.

```sh
pnpm spec:validate && pnpm spec:bundle && pnpm spec:codegen
```

Generated artefacts land in their own commit.

### Running it

```sh
pnpm install                     # also runs `prisma generate` (see below)
docker compose -f docker/compose.yml up -d
pnpm -w exec turbo run build typecheck test
pnpm lint                        # ESLint in every package, then Prettier
```

Postgres is published on **5433**, remapped from the container's 5432 so it does
not collide with a developer's own. The backend defaults to 3000.

```sh
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer
JWT_SECRET=<at least 32 characters>
```

### Tests need a database whose name ends in `_test`

`apps/backend/vitest.setup.ts` aborts the run otherwise, and it prints the two
commands that create one. The guard exists because the DB-backed specs truncate
six tables in `beforeEach` with no regard for what is in them — they destroyed
the dev database once before the guard was added.

```sh
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm -w exec turbo run test
```

### Five traps, each of which cost real time

1. **`prisma migrate deploy` does not generate the client** — only `migrate dev`
   does. The client comes from `@todoer/backend`'s `postinstall`. Without it the
   `Prisma` namespace silently degrades to a stub: `tsc` loses
   `PrismaClientKnownRequestError`, transaction callbacks take an implicit
   `any`, and DB-backed specs throw on import and are reported as `(0 test)` —
   which is neither a pass nor a failure and scrolls past as neither.
2. **turbo filters each task's environment.** A variable set in the shell or on
   a CI job reaches a task only if that task declares it in `turbo.json`. Put it
   on the task, never in `globalEnv`, which drags it into unrelated cache keys.
3. **The body parser must be registered before `OpenApiValidator.middleware`.**
   Nest registers its own inside `listen()`, which runs after every `app.use()`,
   so the validator reads an undefined body and rejects **every** POST with 400.
   `main.ts` does this deliberately; do not reorder it.
4. **`scripts/walking-skeleton.sh` has an `sh` shebang.** Nothing non-POSIX
   belongs in it — `set -o pipefail` is not POSIX and dash rejected it until
   0.5.12.
5. **`POST /sync` is the only write path**, so every invariant a client could
   violate is enforced there or nowhere: the protocol-field allow-list, foreign
   keys scoped to the owner, and the two-level depth rule.

<!-- STACK:END -->
