## T-2026-10-22-web-redesign-calendar — Bring the calendar to the redesign on real data

- Created: 2026-10-22
- Owner: claude
- Status: done
- Completed: 2026-10-22
- Result: PR pending
- Blockers: —
- Spec: [web redesign context](../active/T-2026-10-03-web-redesign-context.md),
  FR-001–003, FR-006–007; mockups `docs/design/mockups/calendar.vue`,
  `references/CalendarDay.vue`, `PlacementChip.vue`, `MoveDateDialog.vue`,
  `UX.md` "Calendar"; `docs/design/DESIGN.md` (calendar rows, keyboard paths)
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 5

### Goal

The calendar already reads the engine's `calendarTasks` projection and moves
placements with real writes, but it still has the pre-redesign shape: a
seven-column grid squeezed onto a phone in month mode, days labelled by a bare
number, titles cut off, and a Move to date dialog that closes whatever the core
answers, so a refused move loses the chosen date. A refused Undo of a moved
occurrence (not synced yet) leaves no way to undo it from the calendar once the
sync lands. The redesign keeps the projection and the operations and changes
how a person reads days and recovers from refusals.

### Scenarios

1. **Given** a calendar view on a wide screen, **When** it opens in week or
   month mode, **Then** days sit in a seven-column grid; **given** a narrow
   container (a phone), **Then** the same days are a single column, each with
   its full date as visible text.
2. **Given** a task with a scheduled and a due date, a daily series with a done
   and a skipped occurrence, **When** the week shows, **Then** scheduled and due
   are separate chips, the done occurrence is struck through and has no
   Move to date…, the skipped one is absent, long titles wrap.
3. **Given** the Move to date… dialog open on an occurrence that another tab
   marks done meanwhile, **When** Move is pressed, **Then** the refusal shows
   with its reason, the dialog stays open with the chosen date, and once the
   mark is undone the same Move succeeds and the dialog closes.
4. **Given** an occurrence moved while offline, **When** Undo is pressed,
   **Then** the core's "not synced yet" shows with an Undo action; after the
   sync that Undo returns the occurrence to its series.
5. **Given** a moved copy that gained a subtask, or whose original was deleted,
   **When** its Undo is pressed, **Then** the refusal names the reason and the
   copy stays.
6. **Given** a calendar showing this week with no `at` in the URL, **When**
   local midnight passes into a new week, **Then** the tab re-watches the new
   week's span; with an explicit `at` it keeps its span.

### Requirements

- **FR-001** The calendar MUST lay its days out as a seven-column grid in a
  wide container and as a single-column list of days in a narrow one, in both
  week and month mode, each day showing its full localized date
  (← plan stage 5; mockup `calendar.vue`, `CalendarDay.vue`).
- **FR-002** A placement chip MUST keep scheduled and due apart, mark closed
  placements and offer no move for them, and wrap a long title instead of
  truncating it (← plan stage 5; mockup `PlacementChip.vue`; UX.md).
- **FR-003** Move to date… MUST stay open with the chosen date and show the
  refusal's reason when the core refuses, block a second submit while one
  runs, close on success, and resend the same minted write when the same move
  is retried (← plan rules; context FR-007; UX.md "refusal keeps the move
  dialog open").
- **FR-004** A refused Undo of a move MUST show the core's reason and offer
  the same undo write again, so an Undo refused before the sync succeeds after
  it (← plan stage 5 "Undo до/после sync"; context FR-006).
- **FR-005** The calendar MUST keep week/month `mode` and `at` in the URL,
  Today navigation, the core's span limit, the transient `?layout=calendar`
  and the `watchView` re-watch rules, and follow the local date across
  midnight (← plan stage 5; shell task FR-003).

### Edge cases

- A move retried after a refusal → same opId, one copy, not two
  (FR-003, T003).
- A closed placement reached through a stale dialog → no write
  (FR-002, T003).
- Undo of a copy with a live subtask, or whose original is gone → the
  core's reason, the copy stays (FR-004, T004).
- Month mode on a phone → 28–42 days in one column, muted days of the
  neighbouring months still labelled (FR-001, T002).
- Midnight between Sunday and Monday with no `at` → next week's span; with
  `at` → unchanged (FR-005, T001).
- Clicked future occurrence → the drawer shows the series' current
  occurrence, as today; changing that is the drawer's (open question).

### Definition of Done

- **SC-001** On a phone and a desktop, in EN and RU, a person reads every day
  by its date, moves a placement by drag or by keyboard, and recovers from a
  refused move or Undo without re-entering the date.
- [x] every FR has a test that failed before the code made it pass —
      except FR-005 and the subtask/original refusals of FR-004, which the
      code already met: their tests pin it (characterization), recorded in
      the steps
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint` — tick after the PR's CI; locally web
      test, typecheck, `pnpm lint`, build and the calendar, offline, shell
      and details e2e on chromium and firefox pass
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line — the coordinator writes it

### Steps

- [x] T001 [FR-005] Failing-first unit spec: midnight rollover re-watches the
  next week's span without `at`, keeps it with `at` —
  `apps/web/app/utils/calendar.spec.ts` on a real engine with a fake clock
  (`apps/web/app/db/clockEngine.ts`, shared with `nav.spec.ts`). It passed
  at once: `watchView` already re-watched on a new date; the test pins it
- [x] T002 [FR-001–002] Failing-first e2e for the grid/list layout, full date
  labels and wrapped titles, then the container-query grid and labels —
  `CalendarView.vue`, `CalendarDay.vue`, `PlacementChip.vue`,
  `apps/web/e2e/calendar.spec.ts`
- [x] T003 [FR-003] Failing-first e2e for a refused Move to date… (a second
  tab marks the occurrence done), then the dialog's pending/refusal/close and
  the held move write — `MoveDateDialog.vue`, `CalendarView.vue`. The held
  write is local to `CalendarView`: `utils/intent.ts` returns only the result,
  and Undo needs the minted copy id
- [x] T004 [FR-004] Failing-first e2e for Undo refusals (not synced yet,
  subtask, original gone) and the re-offered Undo — `CalendarView.vue`,
  `apps/web/e2e/calendar.spec.ts`, `apps/web/e2e/offline.spec.ts`. The
  re-offered Undo failed first; the subtask refusal already showed as a
  failure toast and its test passed at once
- [x] T005 [FR-001–005] Gates (web test, typecheck, lint, build; calendar,
  offline and shell e2e on chromium and firefox); update the plan's stage 5
  and `DESIGN.md` — `docs/plans/2026-10-03-plan-web-ux-redesign.md`
- **Checkpoint:** the calendar matches the mockup on real data, and every
  refusal on a move or Undo keeps the person's intent and shows the reason.

### Open questions

- None blocking. The drawer opened from a future occurrence's chip shows the
  series' current occurrence; showing the clicked one would be a drawer and
  core change, out of this stage.
