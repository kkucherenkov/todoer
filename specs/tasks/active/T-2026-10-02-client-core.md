## T-2026-10-02-client-core — Extract the client core into packages/client-core

- Created: 2026-10-02
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Q3, Q12, Q13, Q16 — plan W0)
- Plan: [docs/plans/2026-10-02-plan-w0-client-core.md](../../../docs/plans/2026-10-02-plan-w0-client-core.md)

### Goal

The web client runs the same client core as the CLI: replica, outbox, sync,
overlay, recurrence, labels, merge, views and the domain operations (Q3,
Q13). Today all of it lives in `apps/cli`, much of it inside `run.ts`, on
`node:sqlite` directly. Until it moves into a package with a storage adapter
the web can implement over sqlite-wasm, W2 would have to start on a copy,
which Q16 rejects. The move must not change the CLI: it is the reference
client, and scripts and agents depend on its exact output and exit codes
(ADR 0015).

### Scenarios

1. **Given** a built workspace, **When** a caller runs any `todoer` command,
   **Then** stdout, stderr and the exit code are the same as before W0.
2. **Given** a backend on a fresh database, **When** CI runs
   `scripts/walking-skeleton.sh` and `scripts/outbox-e2e.sh`, unmodified,
   **Then** both pass.
3. **Given** the repository, **When** a developer runs the workspace tests,
   **Then** 331 tests pass, 171 in `@todoer/client-core` and 160 in
   `@todoer/cli`, and no assertion differs from `main`.
4. **Given** client-core's portable entry, **When** lint runs, **Then** any
   `node:*` import or `Buffer`/`process` use outside `node-sqlite.ts` fails
   it.
5. **Given** a reader of the stack table or the design doc, **When** they
   look for the client core, **Then** both name `packages/client-core`.

### Requirements

- **FR-001** `@todoer/client-core` MUST exist as a workspace package built to
  `dist/` (ESM + declarations) with entries `.` and `./node-sqlite`, picked up
  by turbo's `build`/`typecheck`/`test`/`lint` and depending on nothing new
  (← Q3, Q16; plan departure 4).
- **FR-002** `Store` MUST reach SQLite only through `SqlDatabase` (`exec`,
  `run`, `all`, `inTransaction`, `withWriteLock`, `close`), an interface both
  `node:sqlite` and sqlite-wasm oo1 implement directly. `BEGIN IMMEDIATE`
  transactions and the cross-process write lock MUST behave as before
  (← Q3, Q12, Q13; plan departures 1–3).
- **FR-003** The portable entry MUST NOT import `node:*` or use Node globals;
  Node code MUST be confined to `./node-sqlite` (← Q13).
- **FR-004** Replica/Store, outbox, overlay, sync/flush, transport, token
  source, expander, current occurrence, labels, merge, quick-add parsing,
  refs and the protocol errors MUST live in client-core. The CLI MUST keep
  only argv parsing, output and the `--json` envelope, HELP, config/env,
  password reading, exit-code mapping, `login`/`logout`, and the
  file-system side of opening the database (← Q3; plan departures 5, 6).
- **FR-005** `add`, `mark`, `listTasks`, `listViews`, `submit` and
  `reconcile` MUST be callable from client-core without argv. The CLI MUST
  run its commands through them (← Q13).
- **FR-006** CLI behaviour MUST NOT change. Every existing test passes and
  moves with the code it tests, with no assertion changed. Both e2e scripts
  pass with `scripts/` untouched (← Q16, Risks "Core extraction").
- **FR-007** README, `.claude/CLAUDE.md` and the design doc MUST describe the
  new package, and the design doc MUST record the plan's departures
  (← working agreement 3).

### Edge cases

- First run in a fresh `HOME`, many processes at once → `retryOnBusy` around
  `WAL` + schema still in the CLI's `openStore` (FR-002, T002; CLI
  `store.spec` parallel-opens test).
- Database, `-wal` and `-shm` in a shared, non-private directory → still
  0600 (FR-002, T002; CLI file-mode tests).
- Two processes refresh the same refused token → one refresh, through the
  real lock (FR-002, T004; `auth.spec`, `transport.spec`).
- A developer machine outside UTC → client-core's runner pins `TZ=UTC` like
  the CLI's (FR-006, T001, T003).
- A usage error, refusal or conflict thrown inside client-core → still exit
  2, 1 or 4 (one class each, across the package boundary) (FR-004, T001;
  exit-code probe).
- Server unreachable, 410 recovery, parallel offline adds → exit 5 and
  delivery as before (FR-006, T006; `outbox-e2e.sh`).
- CLI tests run without rebuilding client-core → they run against a stale
  `dist/`; run through turbo (FR-001, T001; plan Global Constraints).

### Definition of Done

- **SC-001** `pnpm -w exec turbo run build typecheck test` reports 331
  passing tests across client-core (171) and the CLI (160).
- **SC-002** `git diff main -- scripts/` is empty, and both e2e scripts pass
  against a live backend.
- **SC-003** The assertion audit in plan Task 6 prints only the named fixture
  edits.
- **SC-004** `rg -l "node:" packages/client-core/dist/*.d.ts` lists only
  `node-sqlite.d.ts`.
- [ ] every FR has a test that failed before the code made it pass. Here no
      behaviour is new: each task's mutation checks stand in, turning the
      moved tests red.
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-003, FR-004] Scaffold the package, move the protocol
      errors, add the lint guard — plan Task 1
- [ ] T002 [FR-002, FR-003, FR-006] `Store` on `SqlDatabase`, `NodeSqlite`,
      the CLI's `openStore`; split `store.spec` — plan Task 2
- **Checkpoint:** the CLI runs on client-core's `Store`; e2e green.
- [ ] T003 [FR-004, FR-006] Move the expander, occurrence, labels, merge,
      overlay, quick-add and refs — plan Task 3
- [ ] T004 [FR-004, FR-006] Move sync, transport and the token source — plan
      Task 4
- [ ] T005 [FR-005, FR-006] Extract the domain operations from `run.ts` —
      plan Task 5
- **Checkpoint:** `apps/cli/src` holds only `index`, `run`, `usage`,
  `config`, `password`, `store`; 171 + 160 tests; e2e green.
- [ ] T006 [FR-006, FR-007] Docs, assertion audit, gates and e2e — plan
      Task 6

### Open questions

None. The `DatabaseSync` adapter lives in client-core's `./node-sqlite` entry
(plan departure 1), decided by the controller on 2026-10-02: adapters are the
per-platform part of the core (design Q3), the web's will be a sibling entry,
and the moved specs keep running on the real cross-process lock.
