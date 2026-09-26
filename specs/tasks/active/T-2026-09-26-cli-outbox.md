## T-2026-09-26-cli-outbox — Make the CLI work offline and retry safely

- Created: 2026-09-26
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [docs/specs/2026-09-26-plan-b-outbox-offline-design.md](../../../docs/specs/2026-09-26-plan-b-outbox-offline-design.md)
  (the B1 half: Q2–Q8, Q13); ADR 0003, ADR 0013, ADR 0015
- Plan: [docs/plans/2026-09-26-plan-b1-cli-outbox.md](../../../docs/plans/2026-09-26-plan-b1-cli-outbox.md)

### Goal

The CLI's callers are scripts and agents, and they retry. Today `add` mints a
new operation id on every invocation, so a retry after a lost response
creates the task twice, and every command fails outright without a server.
The CLI keeps its state in one JSON file that parallel invocations overwrite.
This task gives the CLI a local SQLite replica and an outbox: an operation is
stored once with its id, sent by whichever command next reaches the server,
and a command without a server answers from the local copy.

### Scenarios

1. **Given** no reachable server, **When** an agent runs `todoer add "x"`,
   **Then** it exits 5, prints the task, and the operation is in the outbox.
2. **Given** that queued `add`, **When** any later command reaches the
   server, **Then** the operation is sent with the id it was queued with, and
   the task appears for a second client.
3. **Given** ten `todoer add` invocations in parallel without a server,
   **When** they finish, **Then** the outbox holds ten operations.
4. **Given** a queued operation the server rejects during a later `list`,
   **When** that `list` finishes, **Then** it exits 0, reports one failed
   operation in `--json` and on stderr, and `todoer outbox` shows it.
5. **Given** a cursor below the server's prune watermark, **When** a command
   syncs, **Then** the replica is replaced from `since: 0`, queued operations
   survive, and the command succeeds.

### Requirements

- **FR-001** The CLI MUST keep its replica and outbox in one SQLite database
  (`node:sqlite`, WAL, busy timeout), and every multi-statement change MUST be
  one transaction (← design Q2).
- **FR-002** Node MUST be `>=24.15` across the workspace: `engines`, CI and
  `.nvmrc` (← design Q4).
- **FR-003** An operation MUST be stored in the outbox before it is sent, and
  every send of it MUST carry the same `opId` (← ADR 0015 §4; design Q3).
- **FR-004** Every command MUST first send the pending outbox and pull
  changes; without a server (unreachable, timeout, 5xx) it MUST answer from
  the replica and exit 5 (← design Q3, Q5).
- **FR-005** Reads MUST be the replica's server rows with pending operations
  applied on top (the overlay); the replica itself MUST hold only what the
  server sent (← design Q7).
- **FR-006** A `rejected` or `conflict` result for an operation queued by an
  earlier invocation MUST stay in the outbox as `failed`, reported on stderr
  and in `--json`, without changing the running command's exit code; the
  command's own operation MUST instead set its exit code (1 or 4) and leave
  the outbox (← design Q6; plan ruling "own operation").
- **FR-007** `410` MUST discard the replica, keep the outbox, and repeat the
  exchange with `since: 0` (← ADR 0013; design Q11).
- **FR-008** Every `--json` result MUST be
  `{"data": …, "synced": bool, "outbox": {"pending": n, "failed": n}}`
  (← design Q13).
- **FR-009** `todoer outbox [--json]` MUST list outbox entries;
  `todoer outbox drop <op-id>…` MUST remove failed entries and refuse (exit 2,
  nothing removed) any id that is not a failed entry (← design Q6, open
  thread; plan ruling).
- **FR-010** A flush MUST send at most 1000 operations per request, oldest
  first, stopping at the first request the server does not answer (← design
  open thread "batch size"; contract `maxItems: 1000`).
- **FR-011** `TODOER_TIMEOUT_MS` (default 3000) MUST bound each request; an
  invalid value MUST be a usage error (← design open thread "timeout").
- **FR-012** HELP, ADR 0015, the sync spec §3, the README and the design doc
  MUST describe the new behaviour, and nothing MAY still promise that
  `#project` and `@tag` are stored by this plan (← working agreement rule 3;
  plan ruling "quick-add markers").

### Edge cases

- Parallel invocations writing the outbox at once → no operation lost
  (FR-001, T007 e2e, scenario 3).
- A response lost after the server applied the batch → the resend gets
  `duplicate`, nothing is created twice (FR-003, T005).
- A 401 with a queued operation → exit 1, the operation stays pending and is
  sent after the token is fixed (FR-004, T005).
- An older response merged after a newer one → no row goes back to an older
  version, the cursor never moves backwards (FR-001, T003).
- More than 1000 pending operations → several requests, in order (FR-010,
  T005).
- A changed-seq row for an id the overlay already shows as created → the
  server row wins once the create is settled (FR-005, T004).

### Definition of Done

- **SC-001** `scripts/outbox-e2e.sh` passes in CI against a live backend:
  offline `add` ×10 in parallel exits 5 each, the outbox holds 10, the next
  online command delivers all 10 to a second client, and a forced `410`
  recovers without losing a task.
- **SC-002** `scripts/walking-skeleton.sh` still prints `walking skeleton
  passed`.
- **SC-003** `todoer --help` documents exit 5, the envelope, `outbox`, and
  `TODOER_TIMEOUT_MS`, and no longer says `add` is unsafe to retry.
- [ ] every FR has a test that failed before the code made it pass (FR-002 and
      FR-012 are configuration and documentation: checked by CI running on
      Node 24 and by the step that edits them)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-002] Node 24.15 across the workspace — plan Task 1,
      `package.json`, `.nvmrc`, `.github/workflows/test.yml`
- [x] T002 [FR-011] Configuration reader — plan Task 2,
      `apps/cli/src/config.ts`
- [x] T003 [FR-001] [FR-003] [FR-006] [FR-009] SQLite store — plan Task 3,
      `apps/cli/src/store.ts`
- [x] T004 [P] [FR-005] Overlay — plan Task 4, `apps/cli/src/overlay.ts`
- **Checkpoint:** the store and the overlay pass their own tests; nothing
  calls them yet.
- [ ] T005 [FR-004] [FR-006] [FR-007] [FR-010] Flush — plan Task 5,
      `apps/cli/src/sync.ts`, `apps/cli/src/protocol.ts`
- [ ] T006 [FR-004] [FR-006] [FR-008] [FR-009] Commands and the envelope —
      plan Task 6, `apps/cli/src/run.ts`, `apps/cli/src/index.ts`,
      `apps/cli/src/usage.ts`
- **Checkpoint:** the CLI runs end to end; SC-002 holds.
- [ ] T007 [FR-001] [FR-003] [FR-007] End-to-end script in CI — plan Task 7,
      `scripts/outbox-e2e.sh`, `.github/workflows/test.yml`
- [ ] T008 [FR-012] ADR 0015, spec §3, README, design doc, quick-add
      comment — plan Task 8
- **Checkpoint:** SC-001, SC-003 hold; PR open with all four gates green.

### Open questions

None.
