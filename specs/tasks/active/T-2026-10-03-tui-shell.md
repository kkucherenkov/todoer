## T-2026-10-03-tui-shell — Start the terminal client

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q1, Q3, Q5)
- Plan: docs/plans/2026-10-03-plan-t2-tui-shell.md

### Goal

A person who uses the CLI opens `todoer-tui` and sees their views and tasks,
works offline, and stays in sync, on the replica and session the CLI already
has. The outline, board, details and statuses plans build on this shell.

### Scenarios

1. **Given** `todoer login` was run, **When** `todoer-tui` starts, **Then**
   the sidebar lists "All open" and the saved views and the pane lists the
   open tasks.
2. **Given** no session, **When** it starts, **Then** it says to run
   `todoer login` and `q` quits with 0.
3. **Given** the server is down, **When** a task is added, **Then** it shows
   at once and the status bar reads `offline · 1 pending`.
4. **Given** `todoer add x` ran in another shell, **When** the next tick
   passes, **Then** `x` is listed.

### Requirements

- **FR-001** The TUI MUST open the CLI's replica and session (← design Q3)
- **FR-002** The TUI MUST run the core engine and render its topics (← Q5)
- **FR-003** The TUI MUST sync at start, after every write and every 30 s,
  and on `r` (← Routine choices, sync cadence)
- **FR-004** A failure MUST show as one status-bar line; offline is not an
  error (← Routine choices, failures)
- **FR-005** Without a session the TUI MUST say to run `todoer login`
  (← Routine choices, failures)
- **FR-006** The CLI and the TUI MUST share one implementation of opening the
  replica and reading the environment (← maintainer: no duplication)

### Edge cases

- `TODOER_TOKEN` set and no stored session → signed in (FR-001, T002)
- A refresh refused → signed-out screen (FR-005, T002)
- Terminal narrower than 80 columns → sidebar hidden (FR-002, T004)

### Definition of Done

- **SC-001** `todoer-tui` against a live backend lists, adds, completes and
  deletes a task, and the CLI sees each change
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-006] move openStore/readConfig into the core — plan Task 1
- [ ] T002 [FR-001] [FR-005] package, session adapter, topics — plan Task 2
- [ ] T003 [FR-002] [FR-004] widgets, write hook, status bar — plan Task 3
- [ ] T004 [FR-002] [FR-003] app, sidebar, flat list, cadence, main — plan Task 4
- [ ] T005 documents and PR — plan Task 5
- **Checkpoint:** feature plans can start on this branch's merge

### Open questions

None.
