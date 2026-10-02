## T-2026-10-02-web-calendar — Build the web calendar layout and the filter-tree editor

- Created: 2026-10-02
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-views-design.md](../../../docs/specs/2026-10-01-views-design.md)
  (Q3, Q11, Q13 — the calendar; Q6, Q16–Q18 — the filter; Q7; V1, V2 and W3
  departures); [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Q8 deferral, Q13, Q19, visual design note, W1 CSP notes, W2 "Behaviour
  worth knowing", W3 departures 2, 6, 9, 10); ADR 0002, 0009, 0010; tuxedo
  #413
- Plan: [docs/plans/2026-10-02-plan-w4-web-calendar.md](../../../docs/plans/2026-10-02-plan-w4-web-calendar.md)

### Goal

W3 shipped lists, boards and a view form built from templates. It left two
things the views design hands to GUI clients: the calendar layout (Q11, Q13)
and a filter-tree editor (Q6). Without the calendar a person cannot see a
week's tasks by day or move one occurrence of a recurring task. Without the
editor any filter beyond the six templates has to be typed as JSON. W4 adds
both, with the CLI's meaning for every write and with W3's guarantees: every
write is replay-safe across a worker crash, shows before the network
answers, and can be done from the keyboard and on a touch screen.

### Scenarios

1. **Given** a calendar view, **When** the person opens it, **Then** a week
   grid shows each selected task on its scheduled day and again on its due
   day, a recurring task on each occurrence from the current one on, and
   today's cell marked.
2. **Given** the calendar, **When** the person switches to month, moves to
   the next or previous period, returns to today or reloads, **Then** the
   grid shows the period the URL names.
3. **Given** a one-off task on the calendar, **When** its scheduled or due
   placement is dragged to another day, **Then** that date changes, `todoer
   list --json` shows it, and the toast's Undo puts it back.
4. **Given** a daily recurring task, **When** one occurrence is dragged to
   another day, **Then** the original day is empty, the new day has a copy
   linked to the series, and the CLI shows that copy with `originTaskId` and
   `originOccurrence`.
5. **Given** a moved occurrence, **When** the person presses Undo in the
   toast, or later "Return to series" in the copy's drawer, **Then** the copy
   is gone and the original occurrence is back.
6. **Given** a keyboard or a touch screen, **When** the person opens a
   placement's menu and uses "Move to date…", **Then** the result is the same
   as a drag.
7. **Given** a task done today, **When** the person looks at the calendar,
   **Then** its placement is shown struck through and cannot be moved.
8. **Given** no network, **When** the person moves an occurrence and reloads,
   **Then** the copy shows, and it syncs once online. Undo of that copy before
   the sync explains that it is not synced yet.
9. **Given** the view form, **When** the person starts from a template and
   adds groups, `not` and leaves (tag, project, status, priority, scheduled or
   due range with day offsets or dates, recurring), **Then** the tree shows the
   filter, the limits and any problem live, and Save is possible only for a
   valid filter.
10. **Given** an existing view, **When** the person opens and saves it without
    changes, **Then** nothing is written, whatever wrote its filter (a
    template, raw JSON, another client).

### Requirements

- **FR-001** `@todoer/specs` MUST count a filter's nodes and depth the way
  `filterProblem` does (`filterSize`) (← views Q6, V2 departure 4; W4
  departure 9).
- **FR-002** Client-core MUST compute a calendar for a view and a span of at
  most 42 days: tasks selected by the filter at their current occurrence,
  placed on `scheduledOn` and `dueOn`, a recurring task on each occurrence
  from the current one on, `done` occurrences and closed one-offs for 7 days,
  skipped occurrences of a recurring task never (← views Q11, Q7; V1
  departure 5; W3 departure 6; W4 departures 1–3).
- **FR-003** Client-core MUST move one occurrence of a recurring task as one
  batch: a one-off copy (title, notes, project, tags, priority, status, the
  original's rank, origin fields, no rule, no `dueOn`, no parent) first, then
  `skip` of the occurrence, replay-safe with a tab-minted copy id (← views
  Q13; V2 departures 5, 6; ADR 0009; W3 departure 2; W4 departure 4).
- **FR-004** Client-core MUST undo a move by deleting the copy and reopening
  the occurrence if still skipped, in one batch, and MUST refuse a non-copy,
  an unsynced copy or one with queued writes, a copy with live subtasks, and
  a copy whose original is gone (← views Q13; #391; W3 "not synced yet"; W4
  departure 5).
- **FR-005** The worker MUST accept `moveOccurrence` and `undoMove`, accept a
  span in `watch`, and publish `today`, `span` and `placements` per watched
  (view, span), refusing a span wider than 42 days (← client-shells Q13; W4
  departure 7).
- **FR-006** The tab MUST keep only the `view` publishes for the span it
  watches, resend its span on `ready`, and mint a move's copy id once (← W2
  "Behaviour worth knowing").
- **FR-007** The web MUST show a calendar view as a week or month grid
  starting on Monday, with navigation and the mode in the URL, the worker's
  today marked, closed placements struck through, and a layout usable on a
  phone (← views Q11; client-shells Q19, visual design note; W4 departures 2,
  7).
- **FR-008** Dragging a scheduled placement MUST set `scheduledOn`, a due
  placement `dueOn`, and a recurring task's scheduled placement MUST move its
  occurrence, each with an Undo (← views Q13; W4 departures 3, 6).
- **FR-009** Every move MUST also be reachable through "Move to date…", and
  a copy's drawer MUST offer "Return to series" (← W3 FR-017's touch path; W4
  departure 6).
- **FR-010** The filter editor's helpers MUST edit the filter JSON by path,
  keep untouched subtrees unchanged, write lower-case ids, and refuse to add
  past the depth and node limits (← views Q6; V2 departure 4).
- **FR-011** The view form MUST edit any filter as a tree of `and`, `or`,
  `not` and every leaf kind, show `filterProblem` and the limits live, keep
  templates as quick starts and raw JSON as a toggle, keep unknown ids, and
  offer the calendar layout (← views Q6; client-shells Q17; W4 departure 8).
- **FR-012** Playwright MUST cover placements, navigation, both drags, an
  occurrence move with Undo from the toast and from the drawer, "Move to
  date…", an offline move, and the tree editor, in Chromium and Firefox under
  the CSP, spending no more logins than W3's run (← client-shells Q20).
- **FR-013** README and both design docs MUST describe the calendar, the tree
  editor and W4's departures, with no claim left that they are not built (←
  working agreement rule 3).

### Edge cases

- A tab in UTC+14 or UTC−10 → the grid's dates and a drop's date are the
  same strings as in UTC (FR-007, T005).
- A tab open past midnight → the next publish moves the today marker
  (FR-005, FR-007, T004, T006).
- A daily task anchored years back in a month view → expanded only within
  the span (FR-002, T002).
- A span of 43 days or reversed → `problem: 'span'`, no placements (FR-002,
  FR-005, T002, T004).
- A task with both dates on one day → two placements (FR-002, T002).
- A "Next 7 days" view in month mode → a selected daily task shows past the
  seventh day (FR-002, T002).
- A worker crash after `moveOccurrence` committed → the resend queues
  nothing and creates no second copy (FR-003, FR-006, T003, T004).
- The original task deleted elsewhere before a queued move syncs → the skip
  is refused and the copy lives on (FR-003, T003).
- A subtask's occurrence moved → a top-level copy, the skip on the parent's
  date (FR-003, T003).
- Undo of a copy made offline → "not synced yet" (FR-004, T003, T007).
- Undo of a copy with a queued edit → refused (FR-004, T003).
- Undo after the occurrence was reopened by hand → the copy is deleted, no
  second reopen (FR-004, T003).
- Undo after the original's rule changed → the copy is deleted and the old
  date written `open`, with no refusal (FR-004, T003).
- Undo of a copy edited on another device and not yet pulled → the delete
  comes back `conflict`, the badge shows it, and both tasks remain
  (documented, FR-013, T010).
- A closed placement → not draggable, no "Move to date…" (FR-007, T006,
  T007).
- A leaf naming an id the catalog lacks → shown as unknown, kept on save
  (FR-011, T009).
- A new leaf with no catalog rows to pick → `''`, a problem, Save disabled
  (FR-010, FR-011, T008, T009).
- Depth 8 or 256 nodes → "add" disabled (FR-010, T008).
- Raw JSON that is not a tree shape → stays in raw mode with its problem
  (FR-011, T009).

### Definition of Done

- **SC-001** A person opens a calendar view, sees next week's tasks by day,
  drags a one-off and a recurring occurrence, undoes the move, and `todoer
  list --json` agrees at each step.
- **SC-002** The same moves work through "Move to date…" with the keyboard
  alone.
- **SC-003** A filter with nested `and`/`or`/`not` is built in the form,
  saved, reopened and saved again with no write.
- **SC-004** `git diff main -- apps/cli apps/backend scripts/` is empty, and
  both shell e2e scripts pass.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001] `filterSize` — plan Task 1 — `packages/specs/src/filter.ts`
- [ ] T002 [FR-002] Calendar placements — plan Task 2 — `packages/client-core/src/operations.ts`
- [ ] T003 [FR-003, FR-004] `moveOccurrence`, `undoMove` — plan Task 3 — `packages/client-core/src/operations.ts`
- **Checkpoint:** client-core holds every W4 operation with Node tests, and the CLI is unchanged.
- [ ] T004 [FR-005, FR-006] Span watches, placements, move commands — plan Task 4 — `apps/web/app/db/`
- **Checkpoint:** every calendar read and write exists behind the protocol.
- [ ] T005 [P] [FR-007, FR-008] Grid date math, placement writes — plan Task 5 — `apps/web/app/utils/calendar.ts`
- [ ] T006 [FR-007, FR-012] Calendar layout and navigation — plan Task 6 — `apps/web/app/components/CalendarView.vue`
- [ ] T007 [FR-008, FR-009, FR-012] Drag, "Move to date…", Undo, drawer — plan Task 7 — `apps/web/app/components/`, `apps/web/e2e/`
- **Checkpoint:** the calendar is proven in Chromium and Firefox under the CSP.
- [ ] T008 [P] [FR-010] Filter tree edit helpers — plan Task 8 — `apps/web/app/utils/filterTree.ts`
- [ ] T009 [FR-011, FR-012] Filter-tree editor in the view form — plan Task 9 — `apps/web/app/components/FilterTree.vue`
- [ ] T010 [FR-013] Docs, departures, full proof — plan Task 10 — `README.md`, `docs/specs/`

### Open questions

None. Decided by the controller on 2026-10-02 with the plan's defaults,
reversible by the maintainer:

- Closed placements: done occurrences and closed one-offs for 7 days, like
  the board; skipped occurrences of a recurring task never.
- Moving an occurrence of a subtask is allowed; the copy is a top-level task.
- Undoing an unsynced copy offline is refused with "not synced yet", as W3
  refuses deleting unsynced statuses and views.
- The week starts on Monday in both locales.
