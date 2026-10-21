## T-2026-10-21-core-priority-scale — Make P0 the highest priority everywhere

- Created: 2026-10-21
- Owner: claude
- Status: draft
- Blockers: —
- Spec: maintainer request, 2026-10-03 — P0 highest, P4 lowest; maintainer
  decision, 2026-10-21 — change the stored values, not only their display;
  [web redesign plan](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md),
  task C0
- Plan: none yet; a design doc and an ADR come first (T001)

### Goal

Today a stored priority of 0 means "no priority" and 4 is the highest, and
the core sorts by `-priority`. The redesign, Todoist and the maintainer read
the scale the other way: P0 is the most urgent, P4 the default. Showing one
scale while storing the other would leave the database, the API and every
agent calling the CLI reading priorities backwards, so the stored values
change once, for every client at the same time.

### Scenarios

1. **Given** tasks stored with priorities 0–4 before the migration, **When**
   the migration runs and a client syncs, **Then** each task reads
   `4 − old`, and the order by priority is the same tasks in the same order.
2. **Given** a saved view filtering on a priority, **When** the migration
   runs, **Then** the view selects the same tasks it selected before.
3. **Given** quick-add text without `pN`, **When** the task is added from the
   CLI, the TUI or the web, **Then** it is stored as P4.
4. **Given** quick-add text with `p0`, **When** the task is added, **Then** it
   is stored as P0 and sorts first by priority.
5. **Given** a client built before the change with entries still in its
   outbox, **When** it pushes them after the migration, **Then** no stored
   priority silently ends up on the old scale.

### Requirements

- **FR-001** The server MUST migrate every task's `priority` to `4 − priority`
  and give each changed row a new `seq`, so replicas pull the change; a new
  task's default MUST be 4 (← maintainer, 2026-10-21).
- **FR-002** The server MUST rewrite every saved view filter that names a
  priority so it selects the same tasks, with a new `seq` (← maintainer,
  2026-10-21).
- **FR-003** The core MUST sort by priority ascending, P0 first (← plan,
  approved rules).
- **FR-004** The quick-add parser MUST read `pN` as priority N and MUST
  default to 4 when no `pN` is given (← plan; maintainer, 2026-10-03).
- **FR-005** The CLI, the TUI and the web MUST show the stored value as
  `P0`–`P4`, and the CLI usage MUST describe P0 as the highest (← plan,
  "one scale Web/TUI/CLI").
- **FR-006** [NEEDS CLARIFICATION: what stops a client built before the
  change from writing old-scale values — a protocol version the server
  rejects, a cut-over with every outbox drained first, or something else.
  Decided in the design doc, T001.]

### Edge cases

- A task deleted before the migration (tombstone) → migrated too, or left
  alone; the replica must not resurrect it either way (FR-001, T002)
- A filter with a priority range or a negated priority condition → still
  selects the same tasks (FR-002, T003)
- Two tasks with equal priority → the existing tie-break (rank, then id)
  holds after the sort turns ascending (FR-003, T004)
- `p5`, `P0` in capitals, `p` with no digit → behave as today (FR-004, T004)
- The generated migration drops `change_seq` and the `seq` defaults (trap 6
  in `.claude/CLAUDE.md`) → those statements are deleted before applying
  (FR-001, T002)

### Definition of Done

- **SC-001** After the migration, the dev database's tasks and views list the
  same tasks in the same order in the CLI, the TUI and the web, with P0 on
  the most urgent ones.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001–006] Brainstorm and write the design doc and ADR 0019:
  migration, filter rewrite, old clients and their outbox, rollback —
  `docs/specs/`, `docs/adr/`
- [ ] T002 [FR-001] Migration of tasks and the default, failing-first DB spec
  — `apps/backend/prisma/`
- [ ] T003 [FR-002] Filter rewrite, failing-first spec per filter shape —
  `apps/backend/prisma/` or `apps/backend/src/scripts/`
- [ ] T004 [P] [FR-003, FR-004] Ascending sort and the parser default —
  `packages/client-core/src/operations.ts`,
  `packages/client-core/src/parse-quick-add.ts`
- [ ] T005 [FR-005] Output and usage in the CLI and the TUI; the web's
  current screens show `P0`–`P4` until W2 restyles them —
  `apps/cli/src/`, `apps/tui/src/`, `apps/web/app/components/`
- [ ] T006 [FR-006] Whatever T001 decides for old clients
- **Checkpoint:** every client reads and writes the new scale; the dev
  database migrated without a manual fix-up.

### Open questions

- [NEEDS CLARIFICATION: FR-006, old clients and their outbox.]
- [NEEDS CLARIFICATION: whether the web edits in T005 are this task's or
  Codex's; the plan gives `apps/web` to Codex.]
