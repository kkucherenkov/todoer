## T-2026-10-22-tui-frame-pi — Move the TUI onto pi-tui in a three-column frame

- Created: 2026-10-22
- Owner: claude
- Status: done
- Completed: 2026-10-22
- Result: PR pending (branch `feat/tui-frame-pi`)
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md)
- Plan: [docs/plans/2026-10-22-plan-tui-ux-redesign.md](../../../docs/plans/2026-10-22-plan-tui-ux-redesign.md),
  PR 1, Tasks 1.1–1.6

### Goal

The TUI's tasks sit in the middle of the screen, its card jumps when details
open, and it has no list of projects or tags. Step 1 replaces Ink with
`@earendil-works/pi-tui` 1.4.0 and lays the app out as full-height columns:
sidebar, outline, details. Today's screens are ported as they are; editing in
place and quick add come in PR 2 and PR 3.

### Scenarios

1. **Given** a 140-column terminal, **When** the TUI starts, **Then** the
   sidebar, the outline and the details fill the height side by side.
2. **Given** a tag `@home`, **When** the user picks it in the sidebar,
   **Then** the outline shows the tag's open tasks and the sidebar its count.
3. **Given** a long title under the cursor, **When** the cursor moves,
   **Then** the title shows in full over the rows below it and no other row
   moves.
4. **Given** a 100- or 80-column terminal, **When** the user focuses the
   sidebar or opens details, **Then** it draws over the outline and Esc
   returns.
5. **Given** SIGTERM or `q`, **When** the TUI exits, **Then** the terminal is
   restored and no frame is left in the scrollback.

### Requirements

- **FR-001** The TUI MUST run on pi-tui 1.4.0 with no Ink or React dependency
  (← design, Toolkit)
- **FR-002** The frame MUST be three columns at ≥ 120, sidebar as an overlay
  at 90–119 and outline only below 90; below 60×12 it shows one "too small"
  line (← Q2, Q5)
- **FR-003** The sidebar MUST list views, projects, tags and saved views with
  the core's counts, saved views without one (← Q6)
- **FR-004** Outline rows MUST be one line each; the cursor row shows up to
  3 lines over the rows below, upward at the bottom (← Q11, Q13)
- **FR-005** The status bar MUST be two lines of exact width: mode and sync,
  then hints truncated with `…` (← Q16)
- **FR-006** Tab MUST cycle focus; Esc closes the innermost layer first;
  reparent is `>`/`<` (← Q9, design review)
- **FR-007** Colour MUST stay within the 16 ANSI colours and honour
  `NO_COLOR` (← Q14)
- **FR-008** Exit by `q`, SIGINT or SIGTERM MUST restore the terminal with the
  screen preserved (← spike findings)

### Edge cases

- Wide characters (CJK, emoji with modifiers) keep every line at its width
  (FR-002, FR-004)
- A publish while the cursor sits on a long row keeps the overlay on that
  task (FR-004)
- Resize to below the minimum and back restores the frame (FR-002)

### Definition of Done

- **SC-001** Every screen of today's TUI works in the new frame.
- [x] every FR has a test that failed before the code made it pass
      (FR-001 by build and typecheck with Ink and React gone)
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint` (CI on the PR)
- [x] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-008] Shell, adapter, topics outside React, test kit —
  `apps/tui/src/pi/`, `write.ts`, `tui.ts` (Task 1.1)
- [x] T002 [FR-002] Layout by width — `apps/tui/src/layout.ts` (Task 1.2)
- [x] T003 [FR-003] Sidebar — `apps/tui/src/sidebar.ts` (Task 1.3)
- [x] T004 [FR-004] Outline with the cursor row overlay —
  `apps/tui/src/outline.ts` (Task 1.4)
- [x] T005 [FR-002, FR-005, FR-006, FR-007] Root, focus, modes, status bar —
  `apps/tui/src/root.ts`, `status-bar.ts` (Task 1.5)
- [x] T006 [FR-001] Port the remaining screens, remove Ink and React, docs
  (Task 1.6)
- **Checkpoint:** the TUI runs in the new frame with every screen it had.
