## T-2026-10-22-tui-detail-pane — Edit task fields in place in the TUI detail pane

- Created: 2026-10-22
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md)
- Plan: [docs/plans/2026-10-22-plan-tui-ux-redesign.md](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md),
  PR 2, Tasks 2.0–2.2

### Goal

The TUI's details are read-only and every change goes through a separate form.
Step 2 turns the detail pane into a flat list of fields that are edited where
they stand, and a refused change stays on its field with the person's value
and a retry, as in the web's task drawer. The web's held intent (one draft, one
operation id until accepted) moves into client-core first, so both clients
resend a refused write the same way.

### Scenarios

1. **Given** the cursor on a task's project row in the detail pane, **When**
   the user presses Enter, **Then** an input with the project's value opens on
   that row and the rows above it do not move.
2. **Given** an open input, **When** the user changes the value and presses
   Enter, **Then** one `edit` write carrying only that field is sent.
3. **Given** an open input, **When** the user presses Esc, **Then** nothing is
   sent and the saved value shows again.
4. **Given** the server refuses a change, **When** the reply arrives, **Then**
   the field is marked `✗` with the person's value, and under it
   `saved → yours · reason`; `r` resends the same write with the same `opId`
   and Esc discards it.
5. **Given** a subtask row under the cursor, **When** the user presses x or
   space, **Then** it is ticked at the parent's occurrence.
6. **Given** a refusal for task A, **When** the user has selected task B by the
   time it arrives, **Then** B shows no `✗` and A shows it when selected again.

### Requirements

- **FR-001** client-core MUST export the held intent (`Draft`, `mint`,
  `createIntent`) with the web's behaviour unchanged, and the web MUST use it
  from there (← design, Q8)
- **FR-002** The detail pane MUST list title, project, tags, priority, status,
  scheduled, due, repeat and notes as one flat list, then the subtasks with
  their progress; j/k moves over them, and x or space on a subtask row ticks
  it at the parent's occurrence (← Q7)
- **FR-003** Enter MUST turn the field's own row into an input in place; Enter
  saves, Esc cancels; notes use the `Editor` where Shift+Enter or Alt+Enter
  inserts a newline (← Q3)
- **FR-004** Each save MUST be one `edit` write with the changed field only,
  built as a draft through `createIntent` (← Q3, Q8)
- **FR-005** A refused field MUST keep the person's value, be marked `✗`, show
  `saved → yours · <detail>`, resend with `r` under the same `opId` and be
  discarded with Esc; refusals are held per task and field (← Q8)
- **FR-006** An unreachable server MUST NOT show as a refusal: the edit is
  queued and the status line shows it (← Q8)

### Edge cases

- A subtask of a repeating task ticked from the pane marks the parent's
  current occurrence, not the whole task (FR-002, T002)
- A refusal arriving after the cursor moved to another task shows only on the
  task it belongs to (FR-005, T003)
- A resize mid-edit keeps the typed text and the field (FR-003, T002)
- A publish while an input is open keeps the text and the cursor (FR-003, T002)
- Offline edit → queued, no `✗` (FR-006, T003)

### Definition of Done

- **SC-001** A person edits any field of a task without leaving the pane, and
  a refused change is never lost.
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001] Held intent in the client core —
  `packages/client-core/src/intent.ts` (Task 2.0)
- [ ] T002 [FR-002, FR-003, FR-004] Fields in place — `apps/tui/src/detail-pane.ts`
  (Task 2.1)
- [ ] T003 [FR-005, FR-006] Refusals on the field — `apps/tui/src/detail-pane.ts`
  (Task 2.2)
- **Checkpoint:** a field is edited, refused, retried and discarded in the pane.
