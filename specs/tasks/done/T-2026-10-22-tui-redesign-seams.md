## T-2026-10-22-tui-redesign-seams — Close the seams the redesign review found

- Created: 2026-10-22
- Owner: claude
- Status: done
- Completed: 2026-10-22
- Result: PR pending
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md)
  (Q3, Q8, Q9, Q10, Q14)
- Plan: [docs/plans/2026-10-22-plan-tui-ux-redesign.md](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md),
  the fix pass after the final review

### Goal

The final review of the TUI redesign found places where its parts meet
badly: the detail pane jumps to a neighbour when a save moves its task out
of the view, the outline and the pane disagree on what `r` may resend, a
few lines ignore `NO_COLOR` or the width, the hints and the help describe
keys the screen does not take, and older documents still describe the Ink
client's keys. This pass fixes each, with a spec that failed first.

### Scenarios

1. **Given** the view `project:home` and the details of a task in it,
   **When** the user saves Project `work`, **Then** the task leaves the
   outline but the pane stays on it, the field cursor where it was; the
   next `j Enter` edits the same task.
2. **Given** an open notes editor, **When** another client deletes the task,
   **Then** the editor stays with the typed text and the pane says the task
   was deleted; Enter sends nothing, Esc closes the editor.
3. **Given** an add or a field edit that fails with no server verdict,
   **When** the answer arrives, **Then** both offer `r`, which resends the
   same opId; a permanent refusal offers no `r` in either.
4. **Given** a narrow terminal, **When** the user reads the hints or the
   help, **Then** they name the keys that act at that width.

### Requirements

- **FR-001** While the detail pane has the focus it MUST stay on the task it
  shows, by task id, even when the task leaves the view (Project in
  `project:`, Due or Scheduled in Today, Tags in `tag:`, Status on the
  board), until the focus returns to the outline or the board; the board's
  cursor then follows the card. A refusal `✗` stays on its task
- **FR-002** An open input or editor MUST NOT be closed by a publish; when
  its task is deleted the pane says so and keeps the text until Esc, and a
  save sends nothing
- **FR-003** One TUI helper MUST decide whether `r` is offered: a failure
  with no server verdict (`unavailable`, `unexpected`, `unreachable`,
  `signed-out`, `refused` with `retryable`) resends the same opId; a
  permanent one (`refused` without `retryable`, `invalid`,
  `invalid-credentials`) does not. In the detail pane `signed-out` and
  `unavailable` go to the status line, not a `✗` on the field (← Q8)
- **FR-004** The detail pane's `✗` MUST follow `NO_COLOR` (← Q14)
- **FR-005** The signed-out screen MUST be exactly the terminal's width,
  cut with `…`, from 60 columns (← Q14)
- **FR-006** A view deleted while the full-screen details hold an open
  editor MUST leave the editor open with the focus in the pane (← Q9)
- **FR-007** The help and the hints MUST name the keys that act at the
  current width: Enter edits the line from 90 columns and opens the
  details below; the outline hints name Enter and `i`; the board's add
  shows `saving…` while it waits (← Q9)
- **FR-008** `docs/specs/2026-10-03-tui-client-design.md` MUST mark the keys
  and the layout the redesign replaced as superseded, naming the current
  behaviour; the frame task's 60×12 notes the 60×14 of #65
- **FR-009** `alt()` MUST exist once in the TUI, and the TUI's specs MUST use
  client-core's `NOT_APPLIED`, not a copy

### Edge cases

- The task leaves the view while the pane shows it without an editor → the
  pane stays on it; Esc returns to the outline at the neighbour (FR-001, T001)
- The task returns to the view while pinned → nothing jumps (FR-001, T001)
- The task deleted with no editor open → `this task is gone`, as before
  (FR-002, T001)
- An `unexpected` failure on a field → `✗` with `r` (FR-003, T002)

### Definition of Done

- **SC-001** Editing a task in the detail pane never moves the pane to
  another task, and every key the hints name acts.
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint` (CI on the PR)
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-002, FR-006] Pin the detail pane to its task —
  `apps/tui/src/root.ts`, `apps/tui/src/detail-pane.ts`, `apps/tui/src/board.ts`
- [x] T002 [FR-003, FR-004] One retry rule, `NO_COLOR` on the `✗` —
  `apps/tui/src/failure.ts`, `apps/tui/src/outline.ts`,
  `apps/tui/src/detail-pane.ts`
- [x] T003 [FR-005, FR-007] Width-exact signed-out line, hints and help —
  `apps/tui/src/root.ts`, `apps/tui/src/help.ts`, `apps/tui/src/board.ts`
- [x] T004 [FR-008] Superseded notes in the older documents
- [x] T005 [FR-009] Shared `alt()` and `NOT_APPLIED` —
  `apps/tui/src/task-keys.ts`, `packages/client-core/src/protocol.ts`
