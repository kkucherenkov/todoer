## T-2026-10-02-web-screens — Build the web client's v1 screens and the NAS image

- Created: 2026-10-02
- Owner: claude
- Status: ready
- Blockers: —
- Spec: [docs/specs/2026-10-01-client-shells-design.md](../../../docs/specs/2026-10-01-client-shells-design.md)
  (Q8, Q9, Q13, Q16 — plan W3, Q17, Q18, Q19, Q20, visual design note, W1
  notes, W2 departures 6–7 and "For W3", "Behaviour worth knowing");
  [docs/specs/2026-10-01-views-design.md](../../../docs/specs/2026-10-01-views-design.md)
  (Q1, Q2, Q5, Q7–Q10, V1/V2 departures); ADR 0005, 0006, 0008
- Plan: [docs/plans/2026-10-02-plan-w3-web-screens.md](../../../docs/plans/2026-10-02-plan-w3-web-screens.md)

### Goal

W2 gave the browser a signed-in shell with a replica count and no way to see
or change a task. The views design gave the GUI clients lists, boards and
synced views to render, and the CLI proved what a mark or a quick-add means.
W3 delivers v1 (Q8): navigation by the person's views, a list and a kanban
layout, quick-add, marks, a task drawer, a view form built from templates
(Q17), full column management (Q18), and a visible offline or refused-sync
state. Every write keeps the CLI's meaning and is safe to resend after a
worker crash. It also ships the one image a NAS runs (Q9), which W2 deferred
to before W3 ships.

### Scenarios

1. **Given** a signed-in person with two views, **When** they open the app,
   **Then** the sidebar shows "All open" and both views in rank order, and
   opening one shows its tasks as its filter and sort say, the same tasks
   `todoer list --view` prints.
2. **Given** a list view, **When** the person types `Buy milk #home @errand
   p2` into quick-add, **Then** the task appears with project, tag and
   priority, and the CLI lists the same task with labels created once.
3. **Given** a task in a list, **When** the person marks it done (by click or
   from the keyboard), **Then** it leaves the list, a toast offers Undo, and
   Undo brings it back. For a recurring task the toast names the next
   occurrence, and the row stays at that date.
4. **Given** a kanban view, **When** the person drags a card to another
   column or uses the card's "Move to" menu, **Then** the task's status
   changes. A move into the completing column marks it done, and a move out
   of it undoes it, as `todoer list` then shows.
5. **Given** a recurring task on a board, **When** it is dropped on the
   completing column, **Then** today's occurrence is done, and the card
   reappears in the first column at its next date, with a toast saying so.
6. **Given** a manually sorted view, **When** the person drags a task between
   two others, or moves it up or down from the keyboard, **Then** the order
   holds after a reload and on another device.
7. **Given** the columns dialog, **When** the person adds, renames,
   reorders, marks completing, or deletes a column, **Then** the board
   follows, and the deleted column's tasks are in the first column.
8. **Given** an open task drawer, **When** the person edits title, notes,
   project, tags, priority, dates or status, **Then** each change is saved
   and the CLI shows it.
9. **Given** the view form, **When** the person picks a template (Today,
   Overdue, Next 7 days, Project…, Tag…, Status…), a layout and a sort, or
   types a raw-JSON filter, **Then** a valid view appears in the sidebar and
   in `todoer views`, and an invalid filter shows the reason and cannot be
   saved.
10. **Given** no network, **When** the person adds, marks and moves tasks and
    reloads, **Then** every change is visible, the sidebar says Offline with
    the waiting count, and everything syncs once online.
11. **Given** a server that refuses a sync, **When** the app syncs, **Then**
    a "Sync refused" alert shows the reason, distinct from Offline.
12. **Given** a NAS with Docker, **When** the operator runs the compose file's
    `app` profile with a `JWT_SECRET`, **Then** Postgres and one image start.
    The image migrates the database and serves the API and the SPA on one
    port.

### Requirements

- **FR-001** `@todoer/specs` MUST derive UUIDv5 ids without `node:*`, with
  the same output as before (← W3 departure 1; plan C design Q7).
- **FR-002** Client-core MUST provide `rankBetween`, `ranksBetween` and
  `rankWrites`, and a move into equal ranks MUST produce exactly the
  requested order (← ADR 0008; W3 departure 4).
- **FR-003** Client-core MUST compute a view's open tasks by view id with the
  CLI's facts, filter and sort (`viewTasks`), and `listTasks` MUST keep its
  output (← views Q6, Q10; V1 departures 4, 5).
- **FR-004** Client-core MUST compute a board, with closed one-off tasks in
  the completing column for 7 days and every task placed by
  `displayStatus`, and MUST compute the task drawer's data and the catalog
  (← views Q7–Q9; W3 departure 6).
- **FR-005** A write that carries a tab-minted `opId` MUST queue its ops at
  most once, across a worker crash and against a changed replica (← W2
  "Behaviour worth knowing"; W3 departure 2).
- **FR-006** `editTask` MUST write one `set` per changed field, resolve a
  project or tags by name as quick-add does, and refuse invalid input (← ADR
  0006; quick-add design; W3 departure 10).
- **FR-007** `moveTask` MUST go through `mark` into the completing status,
  write `undo` plus one `statusId` set out of it, and otherwise write
  `statusId` and the given ranks (← views Q5, Q7).
- **FR-008** Client-core MUST create, update and delete views, refusing an
  invalid filter, a duplicate name and an unsynced delete (← views Q1, Q6;
  client-shells Q17).
- **FR-009** Client-core MUST create, rename, reorder, mark completing and
  delete statuses, where delete moves the status's tasks to `null` in the
  same batch, and MUST seed Inbox, Doing, Done (← views Q8, Q9;
  client-shells Q18; W3 departures 3, 5).
- **FR-010** The worker MUST accept the W3 write commands and `watch`, and
  publish `catalog`, `view` (keyed) and `task` (keyed) after every write,
  pull and merge, before the network answers a write (← client-shells Q13).
- **FR-011** The worker MUST run the duplicate-name merge after every pull
  and seed statuses only after a sync that reached the server (← views Q9;
  V1 departure 6; W3 departure 5).
- **FR-012** The tab MUST mint each write's ids once and resend them
  unchanged, and MUST keep only the keyed publishes it watches (← W2
  "Behaviour worth knowing").
- **FR-013** The web MUST show a sidebar with "All open" and the person's
  views in rank order, and route `/`, `/views/:id` and `?task=` (← Q8; W3
  departure 8).
- **FR-014** The web MUST show offline, waiting, refused-entry and
  sync-problem states distinctly (← W2 "For W3"; W2 departure 7).
- **FR-015** The list layout MUST offer quick-add with the CLI's grammar, mark
  done, skip and undo, and a manual reorder by drag and by keyboard (← Q8;
  views Q10; W3 departure 7).
- **FR-016** The task drawer MUST edit title, notes, project, tags,
  priority, scheduled and due dates and status, each as `edit` or `move` (←
  Q8; W3 departure 10).
- **FR-017** The kanban layout MUST show statuses as columns in rank order,
  place cards by `displayStatus`, and move cards by drag and by a keyboard
  "Move to" menu (← Q8; views Q2, Q5, Q7).
- **FR-018** The board MUST let the person add, rename, reorder, mark
  completing and delete columns (← client-shells Q18; views Q8).
- **FR-019** The view form MUST create and edit views from the six templates,
  a layout and a sort, with a raw-JSON mode checked by `filterProblem` (←
  client-shells Q17; W3 departure 9).
- **FR-020** Playwright MUST cover each screen, offline use and two tabs in
  Chromium and Firefox under the backend's CSP, within the per-IP auth
  budget (← client-shells Q20).
- **FR-021** One Docker image MUST build the backend and the SPA, migrate on
  start and serve both with `WEB_ROOT`. `docker/compose.yml` MUST run it next
  to Postgres behind a profile (← client-shells Q9; W2 departure 6; W3
  departure 11).
- **FR-022** README, the design doc, ADR 0008 and `.claude/CLAUDE.md` MUST
  describe the screens, the image and W3's departures (← working agreement
  rule 3).

### Edge cases

- A resend after a worker crash, after the first run's ops were applied and
  settled → nothing new is queued, and the reply is `ok` (FR-005, T004, T006).
- `undo` replayed after it applied → `ok`, not "nothing to undo" (FR-005,
  T004).
- A drop between two tasks of equal rank (`a0`) → the tie run is re-ranked,
  and the order is exactly as dropped (FR-002, T002, T008).
- A drop in a view sorted by priority → status changes, and no rank is
  written (FR-007, FR-015, T006, T010).
- A recurring task dropped on the completing column → done at the current
  occurrence, and the card is in the first column (FR-007, T004, T010).
- A closed one-off task dragged out of the completing column → `undo` and one
  `statusId` set, never a clear plus a set (FR-007, T004).
- A task whose status was deleted on another device → shown in the first
  column (FR-004, T003).
- Two completing statuses after a merge → the lowest id is the column, and
  "Make completing" clears the other (FR-004, FR-009, T003, T005).
- A view whose filter another client wrote and this one cannot evaluate →
  `problem` shown, no items (FR-010, T006, T007).
- A merge rewrites a view's filter → the next publish already uses the
  winner's id (FR-011, T006).
- Deleting a status or view not yet synced → refused, "not synced yet"
  (FR-008, FR-009, T005).
- Deleting the completing status or the last non-completing one → refused
  (FR-009, T005).
- Quick-add with markers only (`#home`) → `invalid`, and the text is kept
  (FR-015, T008).
- A task deleted elsewhere while its drawer is open → the drawer closes with
  a toast (FR-016, T009).
- No statuses before the first sync → the board's empty state, and no
  offline seeding (FR-011, FR-017, T006, T010).
- A touch device → the "Move to" menu, since native DnD needs a pointer
  (FR-017, T010).
- The day changes while a tab stays open → the next sync's publish
  recomputes "Today" (FR-010, T006).

### Definition of Done

- **SC-001** A person signs in on the built SPA, creates a view from a
  template, adds, marks, edits and moves tasks on a list and a board, and sees
  every change in `todoer list`.
- **SC-002** Offline, the same actions show at once, survive a reload, and
  sync when the network returns.
- **SC-003** `docker compose -f docker/compose.yml --profile app up -d
  --build` on a clean machine serves the app on port 3000, and
  `scripts/walking-skeleton.sh` passes against it.
- **SC-004** `git diff main -- apps/cli scripts/ apps/backend/src` is empty,
  and both shell e2e scripts pass.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] Browser-safe `uuidv5` — plan Task 1 — `packages/specs/src/ids.ts`
- [x] T002 [FR-002] Fractional ranks with tie repair — plan Task 2 — `packages/client-core/src/rank.ts`
- [x] T003 [FR-003, FR-004] View, board, task and catalog reads — plan Task 3 — `packages/client-core/src/operations.ts`
- [x] T004 [FR-005, FR-006, FR-007] Replay guard, `editTask`, `moveTask` — plan Task 4 — `packages/client-core/src/{store,operations}.ts`
- [x] T005 [FR-008, FR-009] Views, statuses, seeds — plan Task 5 — `packages/client-core/src/operations.ts`
- **Checkpoint:** client-core holds every W3 operation with Node tests, and the CLI is unchanged.
- [x] T006 [FR-010, FR-011, FR-012] Worker commands, watches, keyed topics — plan Task 6 — `apps/web/app/db/`
- **Checkpoint:** every screen's data and write exists behind the protocol.
- [x] T007 [FR-013, FR-014] Shell, navigation, sync state — plan Task 7 — `apps/web/app/components/`
- [x] T008 [FR-015] List layout — plan Task 8 — `apps/web/app/components/TaskList.vue`
- [x] T009 [FR-016] Task drawer — plan Task 9 — `apps/web/app/components/TaskDrawer.vue`
- [x] T010 [FR-017, FR-018] Kanban and columns — plan Task 10 — `apps/web/app/components/KanbanBoard.vue`
- [x] T011 [FR-019] View template form — plan Task 11 — `apps/web/app/components/ViewForm.vue`
- [x] T012 [FR-020] Playwright screens, offline, two tabs — plan Task 12 — `apps/web/e2e/`
- **Checkpoint:** every v1 screen is proven in Chromium and Firefox under the CSP.
- [ ] T013 [FR-021] Image and NAS compose — plan Task 13 — `Dockerfile`, `docker/compose.yml`
- [ ] T014 [FR-022] Docs, departures, ADR 0008 amendment — plan Task 14 — `README.md`, `docs/`

### Open questions

None. Decided by the controller on 2026-10-02 with the plan's defaults,
reversible by the maintainer:

- `uuidv7` is added to `apps/web` (already in the workspace; the lockfile
  does not change).
- A closed one-off task stays in the completing column for 7 days.
- The image is not published to GHCR; the NAS builds it from a checkout.
