# Plan B: the client outbox, offline operation and tombstone pruning

Plan A (the walking skeleton) proved the contract online and deferred three
things: a client outbox with genuine offline operation, tombstone pruning with
its `410 Gone`, and a way back for a client whose cursor is stale. This
document settles how plan B builds them. It splits into two plans shipped in
order: **B2** first, a small server change (a per-user write lock that closes
the ADR 0016 gap, a prune watermark, a daily pruning job, and `since: 0` as the
snapshot), then **B1**, the CLI rebuilt around a SQLite replica and an outbox,
with a new exit code for "queued, not yet on the server" and an envelope around
every `--json` result. Where this document and an ADR disagree, the ADR changes;
the list of ADRs to amend or replace is under [Follow-up to the
records](#follow-up-to-the-records).

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **outbox** | The client's persistent list of operations; an `op_id` is minted once and reused on every retry of the same intent (ADR 0003, ADR 0015 §4). | queue, journal, event log |
| **replica** | The client's local copy of the user's rows plus the cursor. Today it is `~/.config/todoer/state.json`; in B1 it is a SQLite database. | cache, state file |
| **cursor** | The highest `seq` delivered to the client, sent back as `since`. | offset, version |
| **tombstone** | A row with `deleted_at` set, kept and given a new `seq` so the deletion reaches clients (ADR 0013). | soft delete |
| **retention window** | How long tombstones live; the longest a client may be offline and still catch up incrementally. | TTL |
| **B1** | The client half of plan B: outbox, SQLite replica, offline CLI. | plan B part 1 |
| **B2** | The server half of plan B: pruning, `410 Gone`, snapshot, and the ADR 0016 fix. | plan B part 2 |
| **flush** | Sending every unsent outbox operation in one `POST /sync`, then applying `changes` and advancing the cursor. | push, drain |
| **overlay** | A read that applies pending outbox operations on top of the replica's server rows; the replica itself holds only what the server sent. | optimistic cache, local patch |
| **prune watermark** | Per user, the highest `seq` among physically deleted tombstones; a cursor below it is answered `410 Gone`. | retention cursor, horizon |

## Why

The CLI's primary callers are scripts and agents (ADR 0015), and agents retry.
Today `add` mints a fresh operation id per invocation, so a retry after a lost
response creates the task twice; plan A documents this and tells agents to
treat a failed `add` as indeterminate. The CLI also fails outright without a
network, which contradicts the offline-first goal of the whole product.

Before B2, nothing pruned tombstones, so `410 Gone` was declared and never
sent, and `GET /sync/snapshot` did not exist. ADR 0016 recorded that a
concurrent write could make a client skip a row permanently, with no recovery
path of any kind. An outbox makes that race routine rather than rare: agents
calling the CLI in parallel are exactly two concurrent writers for one user.

## Locked decisions

### Split plan B into B2 then B1 (Q1, Q14)

**Decision.** Two plans. B2 (server) ships first, B1 (client) second.

- The outbox lives entirely in `apps/cli`; pruning, `410` and the snapshot live
  in `apps/backend` and `packages/specs`. They share no code. One plan would be
  roughly the size of plan A's 2000 lines; two give reviewable PRs.
- After Q11 and Q12, B2 is small and independent. Shipping it first means B1's
  `410` handler is written and tested against a live server in
  `scripts/walking-skeleton.sh`, not against the contract alone. ADR 0013
  requires the `410` path to be exercised by a test.
- B2 also closes the ADR 0016 race before B1 makes parallel agent writes
  routine.

**Rejected.**

- *Plan B as written in plan A, ADR 0016 untouched.* Leaves a permanent-loss
  race in place exactly when the outbox makes it common.
- *One plan including the xmin cap.* Same content, one oversized PR.
- *B1 before B2.* B1's `410` path would be verified against the contract only,
  and the ADR 0016 race would be open while outbox-driven parallel writes ship.

**Cost.** B2 brings little visible benefit until B1 ships, because the current
CLI does not handle `410`.

### The CLI's replica and outbox live in SQLite via `node:sqlite` (Q2)

**Decision.** One SQLite database per CLI installation, opened with WAL
journaling and a busy timeout; one transaction per command covers enqueue,
optimistic bookkeeping and cursor advance. No new dependency: `node:sqlite` is
built in.

**Why.** Agents run the CLI in parallel. Today two processes read `state.json`,
each change it, and the second `writeFile` silently discards the first. With an
outbox in the same file, the lost update is a lost operation, i.e. a lost
intent. SQLite gives cross-process transactions for both outbox and replica.

**Rejected.**

- *Keep JSON, add an `O_EXCL` lock file and atomic rename.* Hand-rolled
  locking, and a lock left behind by a `kill -9`'d agent blocks every later
  invocation until someone removes it.
- *JSON replica plus an append-only `outbox.jsonl`.* Safe for appending only;
  removing applied operations is again read-modify-write and again a race.

### Node floor is `>=24.15` across the workspace (Q4)

**Decision.** `engines.node` becomes `>=24.15`; CI (`.github/workflows/test.yml`,
both `setup-node` steps) and `.nvmrc` move to 24.

**Why.** Verified facts: `node:sqlite` was added in v22.5.0; the
`DatabaseSync` `timeout` option (busy timeout, without which a second process
gets `SQLITE_BUSY` immediately instead of waiting) arrived in v22.16.0 and
v24.0.0; the module reached Stability 1.2 (release candidate) in v24.15.0 and
v25.7.0. An experimental module prints `ExperimentalWarning` to stderr, and
stderr is the error channel an agent reads.

**Rejected.**

- *`>=22.16`, accept the warning.* Trains callers to ignore stderr.
- *`>=22.16`, suppress warnings.* Suppression also hides warnings that matter.

**Cost.** Machines on Node 22 cannot run the CLI; the bump touches the whole
workspace, not only `apps/cli`.

**Unverified.** Whether Node 24.15 still prints `ExperimentalWarning` for a
release-candidate module. B1's first step checks it.

### A write without a network exits 5: "queued, not on the server" (Q3)

**Decision.** A new exit code **5** means the command's operation is persisted
in the outbox and has not reached the server. It is not a failure and must not
be retried: the outbox will deliver it with the same `op_id`.

**Why.** Callers branch on exit codes, not text (ADR 0015 §2). Exit 3 today
means "retry me", and a retried `add` is how duplicates happen.

**Rejected.**

- *Exit 0, with `synced: false` in `--json`.* Hides that the task is not yet
  visible to other devices; an agent that immediately checks through another
  client sees "no such task".
- *Keep exit 3 and deduplicate a repeated `add` by content.* The protocol has
  no content-based deduplication, and two identical `add`s can be deliberate.

**Cost.** A new value in the documented contract (`usage.ts`, ADR 0015);
scripts that test only `== 0` treat 5 as failure.

### Every command flushes and pulls first; offline reads come from the replica with exit 5 (Q5)

**Decision.** Each command, `list` included, first flushes the outbox and pulls
changes. If the server is unreachable, reads are answered from the replica
through the overlay, and the command exits 5 exactly like an offline write:
"this answer is local, the server was not reached".

**Why.** Offline-first means reads must work without a network, and one code
for "local answer" is handled the same way by a caller for `add` and `list`.

**Rejected.**

- *Only an explicit `todoer sync`.* Every caller has to remember it, and the
  outbox grows silently.
- *Flush on every command, but `list` fails with 3 offline as today.* Defeats
  the purpose of plan B.

**Cost.** Every command pays a round trip, and a slow server slows even `list`.
The connection timeout must be short and configurable (see Open threads).

### Operations rejected during a later flush stay in the outbox as `failed` (Q6)

**Decision.** When a flush receives `rejected` or `conflict` for an operation,
the operation stays in the outbox marked `failed`, with the server's reason or
`current_version`. `todoer outbox [--json]` lists outbox entries. Every command
reports the `failed` count on stderr and in its `--json` envelope (Q13). The
exit code of the running command is **not** affected by someone else's failed
operation.

**Why.** An operation queued by one invocation (an offline `add`, exit 5) is
usually delivered by another (the next `list`). The spec requires `conflict`
and `rejected` to reach the person, because each means an intent did not
happen.

**Rejected.**

- *The flushing command exits 1 or 4 for the other operation.* `list` would
  fail because of an unrelated `add`, and an agent would retry `list` instead
  of dealing with the `add`.
- *Drop the operation and log it to a file.* Violates the spec: the lost
  intent becomes invisible.

**Cost.** A new command, a new field in the stable `--json` contract, and a
removal policy for `failed` entries (see Open threads).

### Optimistic apply is an overlay, not a write into the replica (Q7)

**Decision.** The replica holds only rows as the server sent them. A read
computes the view as a pure function of (server rows, pending outbox
operations). Merging `changes` is a plain upsert.

**Why.** If pending operations were written into the replica, a pull carrying
the server's older version of a row would either erase the local edit until
the next flush (it flickers back) or require re-applying pending operations on
every merge (a rebase that stores derived state which can drift from its
source). With an overlay, `410` handling (discard the replica, fetch again) can
never lose an unsent operation, because the outbox is kept apart.

**Rejected.**

- *Write into the replica; server changes overwrite the whole row.* Local
  edits disappear from view until flushed.
- *Write into the replica; re-apply pending operations on each merge.* Same
  result as the overlay, but stores derived state.

**Cost.** Every read walks the pending operations. With an outbox of units to
hundreds of entries this is negligible; mark the ceiling with a `ponytail:`
comment.

### Per-user prune watermark, 90-day retention window (Q9)

**Decision.** The server keeps a prune watermark per user, updated in the same
transaction that physically deletes that user's tombstones. A request with
`0 < since < watermark` is answered `410 Gone`. Tombstones older than 90 days
are pruned.

**Why.** A cursor is a `seq`, not a time, so the server must know which `seq`
values it has deleted. `seq` is instance-wide; a global watermark would give a
quiet user `410` because of someone else's deletions. Ninety days covers a
holiday and a forgotten tablet; tombstones are small.

**Rejected.**

- *One global watermark.* Other users' activity would expire a quiet user's
  cursor.
- *30-day window.* Shorter contract with offline clients for no real storage
  saving.

**Cost.** One column on `User` (`prunedThroughSeq`) and an extra write in the pruning transaction.
Completions are never pruned (ADR 0013).

### `POST /sync` with `since: 0` is the snapshot (Q11)

**Decision.** No `GET /sync/snapshot`. A request with `since: 0` returns live
rows only (no tombstones) plus a cursor, and is never answered `410`. A client
receiving `410` discards its replica, keeps its outbox, and repeats with
`since: 0`.

**Why.** ADR 0012 forbids a REST surface; `POST /sync` is the entire data
plane. One endpoint and one response shape make the `410` handler a single
branch. A client that has just discarded its replica has nothing to delete, so
tombstones are dead weight. A personal list fits in one response, so there is
no pagination.

**Rejected.**

- *`GET /sync/snapshot` as ADR 0013 names it.* A second endpoint and a second
  shape for the same content.
- *`GET /sync/snapshot` with pagination.* Complexity for a dataset that does
  not need it.

**Cost.** `since: 0` gains special semantics (no tombstones) that the OpenAPI
document and ADR 0013 must state explicitly. ADR 0013 currently names a
different endpoint and must be corrected, not merely extended.

### Serialise each user's writes with a transaction-scoped advisory lock (Q12)

**Decision.** Every write transaction in `POST /sync` takes
`pg_advisory_xact_lock(<key derived from user_id>)` before calling
`nextval('change_seq')`. A user's writes are serialised, so their `seq` values
commit in allocation order.

**Why.** ADR 0016's loss needs two concurrent transactions for the same user:
one holding a lower, uncommitted `seq` while a higher one commits and a pull
reports it. A pull filters by user, so only per-user commit order matters. With
the lock, the second transaction cannot allocate a `seq` until the first
commits; a pull that sees `seq` 11 also sees `seq` 10. One statement, no
reasoning about transaction snapshots.

**Rejected.**

- *The xmin cap described in ADR 0016* (store a transaction id per row, cap the
  cursor at `pg_snapshot_xmin`). Also closes the cross-user interleaving, which
  is harmless because pulls are per user; much more machinery.
- *Leave ADR 0016 accepted, recovery only by a manual `since: 0`.* Permanent
  silent loss becomes routine once agents write in parallel.

**Cost.** One user's writes run strictly one after another; imperceptible for
a personal list. If shared projects are ever added (ADR 0003), the lock key must
be reconsidered. A new ADR supersedes ADR 0016.

### Every `--json` result is wrapped in an envelope (Q13)

**Decision.** All commands print, under `--json`:

```json
{ "data": "…", "synced": true, "outbox": { "pending": 0, "failed": 0 } }
```

`data` is what the command prints today (a task row or `null` for `add`, an
array of tasks for `list`). `synced` is `false` exactly when the command exits
5.

**Why.** Q3, Q5 and Q6 add information an agent needs: whether the answer
reached the server and how many operations failed. Nobody consumes the `--json`
contract yet, so breaking it now is nearly free, and later it would be
expensive. The envelope leaves room for fields plans C and D will need without
another break.

**Rejected.**

- *Stdout unchanged; `synced` via exit 5, `failed` count only on stderr.*
  Agents often ignore stderr, so Q6's machine-readable report would not exist.
- *Stdout unchanged; everything else as a JSON line on stderr.* Callers parse
  two streams.

**Cost.** `scripts/walking-skeleton.sh` and the CLI tests that read `--json`
change in the same PR; ADR 0015 gains a section on the envelope.

## Routine choices

- **Replica schema (Q8):** one generic table `rows(tbl, id, row JSON, seq)`,
  mirroring `Change.row` on the wire; queries use `json_extract`. No client
  migrations when the contract grows; plan C may add a generated column with an
  index if recurrence queries need one. Typed tables were rejected because they
  duplicate the Prisma schema in a second place.
- **Existing `state.json` (Q8):** ignored. B1 starts from `since: 0`; the
  replica is a cache, and before B2's pruning nothing has been deleted, so a
  full pull restores everything. No import code.
- **Pruning trigger (Q10):** a `setInterval` in a Nest provider, once a day.
  No `@nestjs/schedule` dependency. No instance-wide lock either: a
  session-level advisory lock through Prisma's pool can be taken and released
  on different connections, and it is not needed, because each user is pruned
  under the per-user write lock and the watermark only moves up. It also runs
  once at startup, so a server that
  restarts more often than daily still prunes; a test covers that. External
  cron was rejected because a self-hosted instance where nobody set it up
  would never prune, and `410` would never fire. Pruning at the end of
  `POST /sync` was rejected because it puts housekeeping latency on the write
  path.
- **What is pruned:** tombstones of `task`, `project`, `tag` and `task_tag`
  whose `deleted_at` is older than 90 days, per user, in one transaction with
  that user's watermark update. `completion` rows are never pruned.

## Verified facts

- The CLI today (`apps/cli/src/index.ts`) reads `~/.config/todoer/state.json`
  whole and rewrites it with `writeFile`, with no lock; `add` mints `opId` and
  `id` with `uuidv7()` per invocation.
- `readSyncResponse` in `apps/cli/src/protocol.ts` already maps every 4xx,
  including `410`, to `RefusalError` (exit 1); B1 must intercept `410` before
  that mapping.
- `packages/specs/openapi/openapi.yaml` declares `410` on `POST /sync`
  ("cursor older than tombstone retention") and defines no snapshot endpoint.
- `apps/backend` has no scheduler dependency.
- Engines are `node >=22`; CI uses Node 22 in both `setup-node` steps of
  `.github/workflows/test.yml`; `.nvmrc` says 22.
- `node:sqlite`: added v22.5.0; `DatabaseSync` `timeout` option in v22.16.0 /
  v24.0.0; Stability 1.2 in v24.15.0 / v25.7.0 (Node API docs). Works without
  warnings on the local Node 26.8.1.
- A duplicate flush is already safe: two processes sending the same operation
  get `applied` and `duplicate` from `applied_op`, and both drop it from the
  outbox.

## Risks

- **The `since: 0` special case can drift.** If the backend ever answers
  `since: 0` with tombstones, or with `410`, a freshly reset client either
  loops or wastes a response. Pin both with a test in B2.
- **Overlay cost is unbounded in principle.** A client offline for months with
  thousands of pending operations walks all of them on every read. Accepted
  for now, marked with a `ponytail:` comment.
- **Per-user lock ties the fix to user isolation.** Shared projects would make
  the lock key wrong; ADR 0003 already names isolation as the assumption to
  revisit first.
- **Node 24 floor.** A user on Node 22 loses the CLI entirely. Acceptable for a
  pet project; worth a line in the README.
- **A pending operation on a pruned row.** A `set` queued offline for more
  than 90 days against a row deleted meanwhile is rejected and lands in
  `failed`; the design surfaces it but does not resolve it automatically.

## Deferred

None. Every question asked was answered.

## Open threads

- **Connection timeout.** Q5's cost names a short, configurable timeout
  (on the order of 2–3 seconds). The variable name (for example
  `TODOER_TIMEOUT_MS`) and the default are not decided.
- **Removing `failed` outbox entries.** Q6 assumes a manual
  `todoer outbox drop <op_id>`; the command's name, whether it accepts several
  ids, and whether `conflict` entries can be re-queued against the current
  version are not decided.
- **Batch size of a flush.** `POST /sync` declares `413`. Whether the CLI
  splits a large outbox into several requests, or relies on outboxes staying
  small, is not decided.

## Follow-up to the records

- **ADR 0013:** replace `GET /sync/snapshot` with `POST /sync` and `since: 0`;
  state the per-user watermark and the 90-day window.
- **ADR 0016:** superseded by a new ADR recording the per-user advisory lock.
- **ADR 0015:** add exit code 5 and the `--json` envelope.
- **Spec §3 ("What the client does"):** the `410` path and the overlay.
- **`packages/specs/openapi/openapi.yaml`:** document the `since: 0` semantics
  (live rows only, never `410`); codegen in its own commit.
