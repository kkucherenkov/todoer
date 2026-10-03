## T-2026-10-03-engine-to-core — Move the sync engine into the client core

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [docs/specs/2026-10-03-tui-client-design.md](../../../docs/specs/2026-10-03-tui-client-design.md) (Q4)
- Plan: [docs/plans/2026-10-03-plan-t0-engine-to-core.md](../../../docs/plans/2026-10-03-plan-t0-engine-to-core.md)

### Goal

The web's sync engine is the loop every long-lived client needs. The TUI is
the second such client, so the engine moves into `@todoer/client-core`
before the TUI is written, instead of being copied.

### Scenarios

1. **Given** the web client on this branch, **When** a person signs in, adds,
   marks and drags tasks, **Then** everything behaves as on `main`.
2. **Given** a package other than the web, **When** it imports
   `createEngine` from `@todoer/client-core`, **Then** it can run the engine
   with a session that has no cookie.

### Requirements

- **FR-001** The client core MUST export `createEngine`, `dispatcher` and the
  engine's types (← design Q4)
- **FR-002** The engine's `auth` and `tokens` MUST be typed by what it calls,
  not by the cookie implementations (← design Q4)
- **FR-003** The web MUST keep its behaviour: its tests pass with only import
  changes (← design Q4, Cost)

### Edge cases

- A web file still importing an engine type from `~/db/protocol` → the web
  typecheck fails (FR-003, T001)

### Definition of Done

- **SC-001** `engine.spec.ts` runs green in `packages/client-core`
- **SC-002** the web's unit tests and the Playwright suite pass
- [ ] every FR has a test that failed before the code made it pass (a move:
      the moved spec is that test; it fails while imports are broken)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] [FR-003] move engine, spec and types — plan Task 1
- [ ] T002 [FR-002] narrow `auth` and `tokens` — plan Task 1
- [ ] T003 documents: ADR 0018, design Q4, CLAUDE.md — plan Task 2
- [ ] T004 full gates and Playwright — plan Task 3
- **Checkpoint:** the web runs on the engine from the core

### Departures from the plan

1. `engine.ts`'s `move` case passed `ranks: undefined` when a drop had no
   ranks; the core builds with `exactOptionalPropertyTypes`, the web did not.
   The case now omits the key instead. `moveTask` reads `move.ranks ?? []`,
   so the two are the same call.
2. The core lints with type-checked rules, the web with syntax rules only;
   the moved spec reports 42 errors under the core's. Rewriting them would
   change the test beyond its imports, against FR-003, so
   `eslint.config.mjs` gives `engine.spec.ts` the web's rules
   (`disableTypeChecked`) for now. Bringing it under the core's rules is a
   follow-up (tuxedo).

### Open questions

None.
