## T-2026-10-23-tui-kitty-flags-on-exit — Leave the shell's keyboard as it was after the TUI quits

- Created: 2026-10-23
- Owner: claude
- Status: done
- Blockers: —
- Spec: maintainer report, 2026-10-23 — after quitting the TUI in Orca the
  shell prints `6;1:3u2;1:3u…` for every key
- Plan: none; the steps below are the whole change

### Goal

After the TUI quit, Orca's terminal kept the kitty keyboard flags (7) on the
main screen, so the shell received each key release as `CSI …;1:3u`. The
TUI's own output is right — push and pop both on the alternate screen, then
`?1049l` — so the flags survive in the terminal, not in the TUI.

### Scenarios

1. **Given** the TUI ran with live output in Orca, **When** it quits,
   **Then** `CSI ? u` answers `?0u` and typed keys reach the shell as text.

### Requirements

- **FR-001** On stop, after leaving the alternate screen, the shell MUST set
  the main screen's kitty keyboard flags to 0 (`CSI = 0 ; 1 u`), leaving the
  flag stack as it is (← maintainer report).

### Edge cases

- Quit by SIGINT or SIGTERM → the same stop path (FR-001, T001).

### Definition of Done

- **SC-001** In Orca, after quitting the TUI, typing in the shell prints
  plain text. Reproduced once (flags `7` after quit), not reproduced again
  with either build: the maintainer confirms in the normal flow.
- [x] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [x] no document still asserts the behaviour this task replaced
- [x] dnote changelog line

### Steps

- [x] T001 [FR-001] Reset after `tui.stop` — `apps/tui/src/pi/app-shell.ts`,
  `apps/tui/src/pi/app-shell.spec.ts`

### Open questions

- Which Orca layer restores the flags (renderer reattach from a snapshot is
  the suspect) is not proven.
