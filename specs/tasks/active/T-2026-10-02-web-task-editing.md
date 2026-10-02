## T-2026-10-02-web-task-editing — Delete tasks, manage subtasks and edit recurrence in the web client

- Created: 2026-10-02
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  ("Decisions for #414 (task editing)"; #391 under "Backlog decisions"; W3
  departures 2 and 10; W4 "Behaviour worth knowing");
  [docs/specs/2026-09-26-plan-c-recurrence-design.md](../../../docs/specs/2026-09-26-plan-c-recurrence-design.md)
  (stranded occurrences, the rule subset); ADR 0002, 0004, 0009, 0013;
  tuxedo #414
- Plan: [docs/plans/2026-10-02-plan-w5-web-task-editing.md](../../../docs/plans/2026-10-02-plan-w5-web-task-editing.md)

### Goal

After W4 the web client edits every field of a task except three: it cannot
delete a task, cannot make or show subtasks, and cannot change a recurrence
rule. Each of the three touches a server invariant that a careless client
breaks: a delete needs the row's exact `baseVersion` and must remove live
subtasks first (#391), a subtask lives on its parent's occurrence axis and
carries no rule (ADR 0009), and a rule change needs `baseVersion` because it
strands occurrences (ADR 0004). W5 adds all three with W3's guarantees:
every write is replay-safe across a worker crash, shows before the network
answers, and is reachable from the keyboard.

### Scenarios

1. **Given** a task with two subtasks, **When** the person deletes it from
   the drawer, **Then** a dialog asks "Delete task and 2 subtasks?", and on
   confirm the task and both subtasks are gone from every view and from
   `todoer list --json`.
2. **Given** a task drawer, **When** the person adds a subtask, **Then** it
   shows in the drawer's checklist and as an ordinary row in the list, with
   a link to its parent; `todoer list --json` shows its `parentId`.
3. **Given** a subtask, **When** the person opens its drawer, **Then** there
   is no "Add subtask" and no recurrence editor, and a link opens the parent.
4. **Given** a weekly recurring parent with a subtask, **When** the person
   ticks the subtask in the parent's drawer, **Then** it is done for the
   parent's current occurrence, and shows open again at the next one.
5. **Given** a one-off task, **When** the person picks "Weekly" on Monday and
   Wednesday, every 2 weeks, starting on a date, **Then** the preview lists
   the next dates, and after Save the task is recurring and `todoer list
   --json` shows `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE` and that `dtstart`.
6. **Given** a recurring task with a rule the presets cannot express,
   **When** the person opens the editor, **Then** it opens in the raw RRULE
   field, and saving it unchanged writes nothing.
7. **Given** a recurring task, **When** the person picks "Does not repeat",
   **Then** the task becomes one-off, scheduled on what was its current
   occurrence, and its past marks stay.
8. **Given** a task created offline and not synced yet, **When** the person
   tries to delete it or change its rule, **Then** the write is refused with
   "not synced yet" and nothing is queued.
9. **Given** no network and a synced task, **When** the person deletes it,
   **Then** it disappears at once, stays gone after a reload, and the delete
   reaches the server once online.

### Requirements

- **FR-001** Client-core MUST delete a task and its live subtasks in one
  batch, subtasks first, each `delete` with the row's exact `version` as
  `baseVersion`, and MUST refuse a task or subtask with no `version` or with
  queued task ops (← client-shells "Decisions for #414" 3; #391; ADR 0004;
  W5 departure 3).
- **FR-002** Client-core MUST create a subtask under a live task that has no
  parent, with quick-add text, no rule, and the parent's project when the
  text names none, and MUST refuse a subtask of a subtask (← #414 decision 2;
  ADR 0009; W5 departure 6).
- **FR-003** Client-core MUST describe a task for the drawer with its live
  subtasks, each closed or open at the parent's current occurrence, its
  `dtstart`, and its parent's title; every view item MUST carry its parent's
  title (← #414 decision 2; ADR 0009; W5 departures 7, 8).
- **FR-004** Client-core MUST set, change or clear a task's rule in one batch
  whose ops carry `baseVersion` from the row's `version`, MUST refuse a
  subtask, an unsynced task, a task with queued task ops, and a rule that
  `ruleProblem` refuses, and MUST write nothing for an unchanged rule (← #414
  decision 1; ADR 0004; plan C design; W5 departures 1–4).
- **FR-005** Client-core MUST offer `ruleProblem` (the one check of a rule
  and its start date) and `upcoming` (the next dates from a day), both on the
  shared parser and expander (← #414 decision 1; plan C design Q14).
- **FR-006** The worker MUST accept `deleteTask` and `setRule`, a `parentId`
  on `add` and an `on` on `mark`, and publish the drawer's new fields (←
  client-shells Q13; W3 departure 2).
- **FR-007** The web MUST map the four presets (Daily, Weekly with weekdays,
  Monthly, Yearly, each with an interval) to and from canonical RRULE text,
  and open any other rule in the raw field (← #414 decision 1; W5 departure
  9).
- **FR-008** The drawer MUST delete a task after a confirmation that names
  its live subtask count, with no undo (← #414 decision 3).
- **FR-009** The drawer MUST list a task's subtasks with add, tick and open,
  show "N of M done", and every list row, kanban card and calendar chip of a
  subtask MUST link to its parent (← #414 decision 2; ADR 0009; W5 departure
  10).
- **FR-010** The drawer MUST edit a rule in a dialog with the presets, the
  start date, a raw RRULE field, "Does not repeat", a live preview of the
  next dates and the problem, and Save only for a valid change (← #414
  decision 1).
- **FR-011** Playwright MUST cover delete with subtasks, subtasks in the
  drawer and as rows, a subtask of a recurring parent, every preset path, the
  raw field, clearing a rule, and an offline delete, in Chromium and Firefox
  under the CSP, spending no logins beyond the account pool (← client-shells
  Q20).
- **FR-012** README and the client-shells design MUST describe delete,
  subtasks and rule editing and W5's departures, with no claim left that they
  are not built (← working agreement rule 3).

### Edge cases

- A delete of a task whose subtask was created offline → "subtask … is not
  synced yet", nothing queued (FR-001, T001).
- A delete of a task with a queued title edit → refused, nothing queued
  (FR-001, T001).
- A subtask added on another device and not yet pulled → the server refuses
  the parent's delete, the known subtasks are gone, the badge shows the
  refusal (documented, FR-012, T009).
- A delete resent after a worker crash → queues nothing (FR-001, FR-006,
  T001, T004).
- A deleted task that was the origin of moved copies → the copies live on;
  their "Return to series" is refused (FR-001, T001).
- A subtask of a subtask → refused in the core; the drawer of a subtask has
  no "Add subtask" (FR-002, T002, T007).
- A subtask of a recurring parent whose own current occurrence lags the
  parent's → the drawer shows and marks it at the parent's occurrence (FR-003,
  T002, T007).
- A parent switched between one-off and recurring → its subtasks read their
  marks on the new axis and show open (documented, FR-012, T003, T009).
- One-off → recurring on a task without `dtstart` → `dtstart` is written
  before `rrule`, and `rrule` carries `version + 1` (FR-004, T003).
- A rule change on a task another device changed and this one has not pulled
  → `conflict`, nothing applied, the badge shows it (FR-004, T003).
- A rule that produces no date from its start (`FREQ=YEARLY;BYMONTH=2;
  BYMONTHDAY=30`) → `ruleProblem` refuses it, Save is disabled (FR-005,
  FR-010, T003, T008).
- A rule outside the subset (`FREQ=HOURLY`, `BYHOUR=9`) → the parser's
  message, Save disabled (FR-005, FR-010, T003, T008).
- A non-canonical rule (`FREQ=WEEKLY;BYDAY=WE,MO`, `FREQ=DAILY;INTERVAL=1`,
  `FREQ=WEEKLY` with no BYDAY) → opens in the raw field, saved unchanged it
  writes nothing (FR-007, T005, T008).
- Weekly with no weekday ticked → Save disabled with a reason (FR-010, T008).
- A monthly rule from the 31st → the preview skips short months, as the
  expander does (FR-005, T003).
- A recurring task made one-off whose series ended → no scheduled date
  (FR-004, T003).
- An ended series → the recurrence editor stays enabled; the other fields
  stay read-only (FR-010, T008).
- A tab in UTC+14 or UTC−10 → the weekly preset's default weekday is the
  start date's, not the local one shifted (FR-007, T005).

### Definition of Done

- **SC-001** A person deletes a task with two subtasks from the drawer, and
  `todoer list --json` no longer lists any of the three.
- **SC-002** A person adds two subtasks, ticks one, sees "1 of 2 done", and
  opens the parent from the subtask's row.
- **SC-003** A person makes a one-off task weekly, changes it to a raw rule,
  then makes it one-off again, and `todoer list --json` agrees at each step.
- **SC-004** `git diff main -- apps/cli apps/backend scripts/
  packages/specs` is empty, and both shell e2e scripts pass.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] `deleteTask` and the shared `settledRow` — plan Task 1 — `packages/client-core/src/operations.ts`
- [x] T002 [FR-002, FR-003] Subtasks: `add` under a parent, drawer and item fields — plan Task 2 — `packages/client-core/src/operations.ts`
- [ ] T003 [FR-004, FR-005] `ruleProblem`, `upcoming`, `setRecurrence` — plan Task 3 — `packages/client-core/src/occurrence.ts`, `operations.ts`
- **Checkpoint:** client-core holds every W5 operation with Node tests, and the CLI is unchanged.
- [ ] T004 [FR-006] Engine commands and protocol — plan Task 4 — `apps/web/app/db/`
- **Checkpoint:** every W5 write exists behind the protocol, proven without a browser.
- [ ] T005 [P] [FR-007] Presets to and from RRULE — plan Task 5 — `apps/web/app/utils/recurrence.ts`
- [ ] T006 [FR-008, FR-011] Delete from the drawer — plan Task 6 — `apps/web/app/components/DeleteTaskDialog.vue`
- [ ] T007 [FR-009, FR-011] Subtasks in the drawer and parent links — plan Task 7 — `apps/web/app/components/SubtaskList.vue`
- [ ] T008 [FR-010, FR-011] The recurrence dialog — plan Task 8 — `apps/web/app/components/RecurrenceDialog.vue`
- **Checkpoint:** delete, subtasks and rule editing are proven in Chromium and Firefox under the CSP.
- [ ] T009 [FR-012] Docs and departures — plan Task 9 — `README.md`, `docs/specs/`
- [ ] T010 [FR-011, FR-012] Full proof and close-out — plan Task 10

### Open questions

None. The maintainer settled scope on 2026-10-02 (client-shells "Decisions
for #414"). What those decisions leave open is listed as plan departures with
the default taken; each is reversible by the maintainer before its task
starts.
