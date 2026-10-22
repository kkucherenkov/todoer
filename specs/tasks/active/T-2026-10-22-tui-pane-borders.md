## T-2026-10-22-tui-pane-borders — Draw each TUI pane in a box and highlight the active one

- Created: 2026-10-22
- Owner: claude
- Status: in progress
- Result: —
- Blockers: —
- Spec: [TUI UX redesign design](../../../docs/specs/2026-10-22-tui-ux-redesign-design.md)

### Goal

The maintainer ran the borderless TUI and asked for borders around the panes
and a highlight on the active one. Without borders the outline's right-aligned
`#project` reads as part of the details next to it.

### Scenarios

1. **Given** a 140×36 terminal, **When** the TUI draws, **Then** the top row
   shows three boxes titled `Views`, `Tasks` and `Details`.
2. **Given** the outline focused, **When** the user presses Tab, **Then** the
   highlighted (cyan) border moves to the next pane.
3. **Given** `NO_COLOR`, **When** the TUI draws, **Then** the active pane has a
   double border and no frame carries a colour code.
4. **Given** 100×30, **When** the sidebar is focused, **Then** the overlay
   sidebar is boxed; at 80×24 the focused details are boxed full screen.

### Requirements

- **FR-001** `box(lines, { width, height, title, active, color })` MUST return
  exactly `height` lines of exactly `width` cells, content cut or padded to
  `width - 2` × `height - 2`, with a rounded border and the title in the top
  border, truncated with `…` when narrow
- **FR-002** The active pane's border and title MUST be cyan with a bold
  title, an inactive one's dim; with `NO_COLOR` the active pane MUST use a
  double border and no SGR colour code may appear
- **FR-003** Root MUST draw the sidebar (`Views`), outline or board (`Tasks`)
  and detail pane (`Details`) each in a box, in the overlay and the
  full-screen details too; columns sit box to box, the status lines stay
  outside, and every frame is exactly the terminal's width and rows
- **FR-004** `widths` and `MIN` MUST account for the borders, and `tooSmall`
  names the new minimum

### Edge cases

- CJK and emoji content keeps the box's exact width (FR-001)
- A title wider than the box is cut with `…` (FR-001)
- The smallest terminal still shows a box with content (FR-004)

### Definition of Done

- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the borderless layout
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-001, FR-002] `box` — `apps/tui/src/frame.ts`
- [ ] T002 [FR-004] Widths and minimum — `apps/tui/src/layout.ts`
- [ ] T003 [FR-003] Root draws boxes — `apps/tui/src/root.ts`
- [ ] T004 Docs — design doc, `apps/tui/README.md`
- **Checkpoint:** tmux at 140×36, 100×30, 80×24 and the minimum shows boxes.
