## T-2026-10-21-web-redesign-details — Redesign the task drawer, its recurrence and its delete

- Created: 2026-10-21
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [web redesign context](../active/T-2026-10-03-web-redesign-context.md),
  FR-003, FR-006–007; mockups `docs/design/mockups/ux.html` (drawer),
  `task-dialogs.vue`, `references/DeleteTaskDialog.vue`, `UX.md`
  "Contextual editing"
- Plan: [web UX redesign](../../../docs/plans/2026-10-03-plan-web-ux-redesign.md), stage 4

### Goal

The drawer lists every field at the same weight, puts a field back silently
when a write is refused, and mints a new operation each time a refused change
is sent again. A person editing a task should see the title and notes first,
know that a field saved (and whether it is still waiting to sync), keep what
they typed when a change is refused, and retry that same change without it
becoming a second operation. Recurrence and delete must say what core does: a
subtask repeats with its parent, a parent delete takes its direct children and
cannot be undone.

### Scenarios

1. **Given** a task, **When** its drawer opens, **Then** title, notes and the
   two dates come first; project, tags, priority, status and repeat sit behind
   "More details", which stays open for the next task once opened.
2. **Given** a field was left, **When** its write is in flight and after it
   lands, **Then** a status line says "Saving…", then "Saved on this device"
   with the number of writes still waiting to sync.
3. **Given** a change the core refuses, **When** the refusal arrives, **Then**
   the field shows the saved value, a panel shows the saved value, the
   person's change and the reason, and "Retry change" sends the same write
   (same opId) again.
4. **Given** a subtask, **When** its drawer opens, **Then** repeat is disabled
   with "Subtasks cannot have their own repeat rule.", and a subtask of a
   recurring parent shows its occurrence instead of an editable Scheduled date.
5. **Given** a parent with subtasks, **When** it is deleted, **Then** the
   dialog names the subtasks, says it cannot be undone, keeps focus on Cancel,
   shows progress while the write runs, and a refusal (not synced yet) keeps
   the dialog open with its reason; confirming again resends the same write.
6. **Given** the drawer opened from a row or card on any layout, **When** the
   person moves to a child or the parent and closes, **Then** every other
   query parameter is kept and focus returns to the opener, or to the nearest
   task when the opener left the view.
7. **Given** a nested dialog (repeat or delete) over the drawer, **When**
   Tab, Shift+Tab or Escape is pressed, **Then** focus stays inside the
   dialog, Escape closes only it, and focus returns to its trigger.

### Requirements

- **FR-001** The drawer MUST order title, notes, Scheduled/Due first and
  reveal project, tags, priority, status and repeat on request, remembering
  the choice for the session (← plan stage 4; UX.md "Contextual editing").
- **FR-002** The drawer MUST show a polite status line: saving while a field
  write runs, saved on this device afterwards with the sync queue size, and
  the blur-save hint (← plan stage 4; mockup `save-status`).
- **FR-003** A refused field write MUST restore the saved value, keep the
  refused value visible with the reason, and retry it with the same minted
  write; a new value is a new write (← plan rules; context FR-007; UX.md).
- **FR-004** Repeat, delete and return-to-series MUST resend the same minted
  write after a refusal, and leave their dialog open with the input kept
  (← plan rules; core `setRecurrence`/`deleteTask` settled/version rules).
- **FR-005** A subtask MUST NOT offer its own rule: the repeat control is
  disabled with an explanation, and a subtask of a recurring parent is shown
  as scheduled by the parent's rule (← core `setRecurrence`, `editTask`;
  UX.md "Creation and editing").
- **FR-006** Deleting a parent MUST name its direct subtasks, state that it
  cannot be undone, offer no Undo, and show pending state while the batch is
  written (← core `deleteTask`; mockup `references/DeleteTaskDialog.vue`).
- **FR-007** Parent/child navigation and close MUST keep every non-`task`
  query parameter, and focus MUST return to the opener, then the nearest
  task, then the workspace heading; nested dialogs MUST trap Tab/Shift+Tab
  and close alone on Escape (← context FR-003; shell task FR-005).

### Edge cases

- Two fields refused in a row → the panel shows the latest; each field keeps
  its own held write (FR-003, T002).
- The person changes a refused field to another value → a new write; the
  held one is dropped (FR-003, T001).
- A refused write that the worker had in fact applied (timeout) → the retry
  replays its opId, so the core flushes instead of applying twice (FR-003–004,
  T001).
- A subtask of an ended series → still shows a Scheduled input; the core
  refuses the date and the refusal panel says why (FR-003, T002).
- Delete of a task with queued writes → "not synced yet"; the dialog stays
  open and the same confirm resends after a sync (FR-004, FR-006, T003).
- Opener row leaves the view (status set to the completing one) → focus goes
  to the nearest remaining task (FR-007, T004).

### Definition of Done

- **SC-001** In EN and RU a person edits a task from title to status, sees
  each save, recovers from a refusal without retyping, and deletes a parent
  knowing its subtasks go with it — by mouse or keyboard alone.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-003–004] Failing-first unit spec, then a held-intent helper
  that keeps a minted write until it is accepted — `apps/web/app/utils/intent.ts`
- [ ] T002 [FR-001–003, FR-005] Failing-first e2e, then reorder the drawer,
  add "More details", the status line, the refusal panel with Retry, and the
  subtask repeat rule — `apps/web/app/components/TaskDrawer.vue`,
  `apps/web/i18n/locales/*`, `apps/web/e2e/details.spec.ts`
- [ ] T003 [FR-004, FR-006] Failing-first e2e, then pending and inline
  refusal in the delete dialog and held intents for repeat and delete —
  `DeleteTaskDialog.vue`, `RecurrenceDialog.vue`, `TaskDrawer.vue`
- [ ] T004 [FR-007] e2e for query preservation across parent/child on a
  transient layout, focus return when the opener leaves, and nested-dialog
  Tab/Shift+Tab/Escape — `apps/web/e2e/details.spec.ts`
- [ ] T005 [FR-001–007] Update e2e contracts the reordering moves
  (`editing.spec.ts`, `list.spec.ts`, `offline.spec.ts`), run gates, update
  the plan's stage 4 — `docs/plans/2026-10-03-plan-web-ux-redesign.md`
- **Checkpoint:** the drawer, its repeat and its delete follow the mockup and
  the core's refusal/retry rules, tested in unit and e2e.

### Open questions

None. Out of scope by coordinator decision (2026-10-21): unfolding a
collapsed parent after adding a subtask belongs to W3.
