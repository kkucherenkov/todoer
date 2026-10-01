## T-2026-10-01-views-cli — List views and show statuses in the CLI

- Created: 2026-10-01
- Owner: claude
- Status: done
- Blockers: —
- Spec: [docs/specs/2026-10-01-views-design.md](../../../docs/specs/2026-10-01-views-design.md)
  (Q9, Q10, Q12, Q15); tuxedo #406
- Plan: [docs/plans/2026-10-01-plan-v1-views-cli.md](../../../docs/plans/2026-10-01-plan-v1-views-cli.md)
- Completed: 2026-10-01

### Goal

Plan V2 put views and statuses in the sync contract, but the CLI — the
reference client and the one scripts and agents use — still ignores them. A
caller cannot ask for "the tasks of my Work view", cannot see a task's status,
and a `done` from the CLI leaves the task in its old kanban column. The
duplicate-name merge also does not know statuses, and merging a tag silently
drops it from every view that names it.

### Scenarios

1. **Given** a view `Work` with a project filter and sort by due date,
   **When** a caller runs `todoer list --view work`, **Then** only that
   project's open tasks print, earliest due first.
2. **Given** statuses `Inbox`/`Doing`/`Done`, **When** a caller runs
   `todoer list`, **Then** each line ends with the task's status and `--json`
   carries `status`.
3. **Given** a user with no statuses, **When** they mark a task done,
   **Then** `Inbox`/`Doing`/`Done` are created once and the task points at
   `Done`.
4. **Given** two devices that each seeded `Done` offline and a view naming the
   loser, **When** either pulls, **Then** the merge folds the statuses, moves
   the tasks and rewrites the view's filter.
5. **Given** an unknown view name, **When** `list --view` runs, **Then** it
   exits 2 naming the view.

### Requirements

- **FR-001** `@todoer/specs` MUST export `completingStatus`, `firstStatus`
  and `replaceIds` (← Q7, Q9; departure 6).
- **FR-002** The merge MUST fold duplicate statuses like tags and projects and
  rewrite every live view filter that names a merged-away tag, project or
  status, one write per view (← Q9; departure 6).
- **FR-003** `list` MUST show each task's displayed status (text and
  `--json`) when the user has statuses (← Q15).
- **FR-004** `done` MUST set `statusId` to the completing status, seeding
  `Inbox`/`Doing`/`Done` when the user has none; `undo` MUST clear it;
  `skip` MUST leave it (← Q7, Q9; departures 1–3).
- **FR-005** `todoer views` MUST list live views (← Q12).
- **FR-006** `list --view <name>` MUST apply the view's filter and sort
  (layout ignored), refusing an unknown name or an invalid stored filter
  (← Q10, Q12; departures 4, 5).
- **FR-007** HELP, README, the walking skeleton and the views design MUST
  describe and exercise what shipped.

### Edge cases

- two `done`s before a sync on an instance with no statuses → one seeded set
  (FR-004, T003)
- a view naming a tag and a project that both lose → one `set filter`
  (FR-002, T002)
- `list --view` with no name, or an unknown one → exit 2 (FR-006, T004)
- a task whose status was deleted → shown in the first non-completing status
  (FR-003, T003)
- a recurring task under a `scheduled` filter → matched at its current
  occurrence (FR-006, T004)

### Definition of Done

- **SC-001** `sh scripts/walking-skeleton.sh` lists a synced view with
  `todoer views` and filters by it with `list --view`.
- [x] every FR has a test that failed before the code made it pass
- [x] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] shared status helpers and replaceIds — plan Task 1
- [x] T002 [FR-002] merge statuses, rewrite view filters — plan Task 2
- [x] T003 [FR-003, FR-004] statuses in list, done/undo — plan Task 3
- [x] T004 [FR-005, FR-006] views and list --view — plan Task 4
- [x] T005 [FR-007] end to end and documents — plan Task 5
- **Checkpoint:** scenarios 1–5 pass; the four gates green on the PR.

### Open questions

None.
