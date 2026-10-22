# TUI UX redesign

The terminal client is redrawn around a full-height, three-column screen:
navigation on the left, the outline in the middle, a fixed detail pane on the
right. Fields are edited in place. `tuxedo` is the UX reference. The TUI
moves from Ink 8 to `@earendil-works/pi-tui` 1.4.0, after two throwaway
spikes showed it hosts the screen with two small, contained workarounds.

Decided in a design interview on 2026-10-22. This document amends [the TUI client design](2026-10-03-tui-client-design.md); where the
two disagree, this one wins for layout and interaction.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **detail pane** | The fixed right-hand column with the selected task's fields. Its position never depends on the selection. | card, drawer |
| **sidebar** | The left column: built-in destinations, projects, tags and saved views, with counts from the core. | menu, filters |
| **outline** | The list layout as the TUI shows it: subtasks nested under their parent when both are listed (from the TUI client design). | tree view |
| **NORMAL / INSERT** | The two input modes. NORMAL: single keys are commands. INSERT: keys type into the field or line being edited. | command mode, edit mode |

## Why

The maintainer's pains with `todoer-tui` today:

- the tasks sit in the middle of the screen: panes are boxed to the height of
  their content, so two task rows float above an empty terminal;
- the task card jumps when its details expand;
- fields are not edited in place;
- the sidebar has no projects or tags, only views.

`tuxedo` already works the way the maintainer wants a terminal todo list to
work: full height, a sidebar with counts, a left-aligned one-line-per-task
list, a fixed DETAIL pane, a status line with the mode and key hints. The
redesign takes those cues instead of inventing a layout. For the
implementation, the maintainer would rather reuse a toolkit (`pi-tui`) than
reinvent widgets. Tuxedo items 434 (status bar does not fit 80 columns) and
436 (fill the terminal, design pass after tuxedo) are closed by this work.

## Locked decisions

### Toolkit: pi-tui 1.4.0, after two spikes (Q1, Q4)

**Decision (as first asked, then revised below).** Before any production change, a throwaway spike builds the
three-column screen on `@mariozechner/pi-tui` 0.73.1: alternate screen,
columns at full height, a scrolling outline, the detail pane with `Input` and
`Editor` placed on a field's own row, resizing from 140×36 down to 60×20, and
a `render(width)` checked in `node:test` without a terminal. `pi-tui` is
chosen **only if all of that works with zero workarounds of `pi-tui` itself**:
no monkey-patching, no reaching into its render state, no own key parser in
place of its own, no escape codes written behind its back. Layout code written
on its public `Component` API does not count as a workaround. If the spike
fails the bar, the TUI stays on Ink 8 and is re-laid out there. The result
below relaxed this bar and chose `pi-tui`.

**Rejected.** Moving to `pi-tui` outright (A): `pi-tui` is a line renderer
for scrollback output. Its `Container` stacks only vertically, `render(width)`
has no height, and there is no alternate screen. The columns would be our own
code either way. If that layer fights the library, the whole TUI and its
`ink-testing-library` tests would have been rewritten for something Ink does
natively. Staying on Ink without looking (B): it gives up `pi-tui`'s editor
(kill ring, undo), select list, fuzzy matching, key parsing with the kitty
protocol, overlays and flicker-free differential rendering on a guess.

**Bar.** The strict bar (Q4 B) was chosen over "the checks pass and our layout
is ≤ ~300 lines" (A). A workaround inside the library is what breaks on its
next release, and this TUI has one maintainer.

**Result (2026-10-22): `@earendil-works/pi-tui` 1.4.0, exact pin.** The
first spike ran on `@mariozechner/pi-tui` 0.73.1, an abandoned line: the
maintained package is `@earendil-works/pi-tui` (1.0.0 on 2026-10-01). On
0.73.1, the screen took about 200 lines and every frame matched in 179 tmux
steps. It still needed raw `?1049h`/`?1049l`, a cursor home after entering,
and a synthesized Ctrl+E. Its diff rewrote every row on each cursor move.

The second spike ran the same code on 1.1.0 and 1.4.0:

- 178 tmux steps with 0 mismatches, and 8 `node:test` tests passed;
- `TuiAltScreen` removes the raw escape codes and the cursor home;
- `Input({ prompt: "" })` removes the prompt hack;
- the diff is per row: j/k rewrites about 13 rows of 36 instead of all of them.

Two workarounds remain in both versions:

- a synthesized Ctrl+E after `Input.setValue`, because there is no public way
  to put the cursor at the end;
- an Esc check around `Editor`, which has no `onEscape`.

The maintainer relaxed the bar from Q4 B ("zero workarounds") to: public API
only, with every workaround in one adapter file marked `ponytail:` and its
upstream fix requested (`Input` cursor control, `Editor.onEscape`).

Why pi-tui beats Ink here: overlays (Q5's sidebar, Q10's details over the
board, Q13's expanded row), `Input` with kill ring and undo, and a
multi-line `Editor` come with the library. On Ink each would be our own
code, and none of the three exists there today. Cost: the screens and the
React glue to the engine's topics (`context.tsx`, `use-write.ts`) are
rewritten, and the tests move from `ink-testing-library` to `render(width)`
in `node:test`. The pure modules carry over: `outline-tree`, `board-columns`,
`fields`, `line`, `status-line`, `session`, `editor`, and the store under
`topics` (its React hook goes). Most screens
are redrawn by this redesign anyway.

Why 1.4.0 rather than the older 1.1.0: 1.4.0 restores the terminal on an
uncaught exception and on an unhandled rejection through its own `exit`
hook, where 1.1.0 left it broken. It is one day old, so a regression is
possible; the exact pin and bumps in their own PRs contain that.

Constraints that follow:

- the app handles SIGTERM itself, because neither version restores the
  terminal on signal death;
- exit goes through `stop({ preserveScreen: true })`, because the default
  prints the last frame into the shell's scrollback;
- the mouse stays off (`mouse: false`), and the alternate-screen keybindings
  are rebound, so the terminal's own selection keeps working and PageUp,
  PageDown and Ctrl+Home/End reach the app.

### Three full-height columns (Q2)

**Decision.** Sidebar | outline | detail pane, all at the terminal's full
height, with the status line at the bottom. Moving the cursor changes only the
detail pane's contents. The outline never moves because of the selection.

**Rejected.** The detail pane at a fixed height below the outline (B): on 24
rows it takes half the screen from the list. Details replacing the outline on
Enter (C): it loses the list while reading a task, and that is the context
switch the fixed pane exists to avoid.

### Pane boxes (maintainer request 2026-10-22)

**Decision.** After running the borderless frame the maintainer asked for a
box around each pane and a highlight on the active one: without borders the
outline's right-aligned `#project` read as part of the details beside it. Each
visible pane (`Views`, `Tasks`, `Details`, and `Board` for a kanban view) is drawn in
a rounded box with its title in the top border. The boxes sit side by side with
no gap, so a pane's content is two cells narrower and two rows shorter than
its column. The overlay sidebar (90–119) and the full-screen details (< 90)
are boxed too; the two status lines stay outside, full width. The active pane
(the focus) has a cyan border and a bold cyan title, the others are dim. Under
`NO_COLOR` the active pane has a double border instead (colour never carries
the meaning alone). The minimum terminal is 60×14.

### The sidebar mirrors the web's navigation, tags added in the core (Q6)

**Decision.** The sidebar lists All open, Today, Upcoming and each project,
each with its count from the core's `catalog.nav` (the navigation projection
added by core task C2), then the saved views from `catalog.views`, which
carry no count, as in the web (my call: no core change for view counts).
These are the same `watch` keys the web uses, and the TUI counts nothing
itself. Tags are added as a core built-in view `tag:<id>` with a `catalog.nav`
count, a client-core task in the pattern of C2, so the web gets it too.
Selecting a row watches that key.

**Rejected.** Tags only through `/` search (B): it leaves tags without counts
and without a place on screen. Tuxedo-style toggled filters that combine over
the current view (C): that is a new query language on top of views, and the
client would have to compute counts.

## Routine choices

- **Narrow terminals (Q5 A).**
  - ≥ 120 columns: three columns.
  - 90–119: the sidebar is hidden. Focusing it opens it as an overlay over
    the outline (my call). Tab cycles sidebar → outline → detail pane at
    every width.
  - < 90: only the outline. Enter shows the details full screen and Esc goes back.

  Navigation goes first and details second. The outline stays put in every
  mode.
- **Editing (Q3 A).** Every field is edited in the detail pane. Tab moves
  focus from the outline into the pane, and j/k moves over the fields. Enter
  turns the field's own row into an input in the same place. Enter saves and
  Esc cancels. Notes use the multi-line `Editor`: Enter saves and
  Shift+Enter or Alt+Enter inserts a newline (my call, `Editor`'s own default).
- **Detail pane contents (Q7 A).** A flat list of every field: title,
  project, tags, priority, status, scheduled, due, repeat, notes. Below it the
  subtasks with checkboxes and the progress from the core. Nothing is folded.
- **A refused edit (Q8 A).** As in the web's task drawer (stage W4 of the web
  redesign): the field is marked ✗, and
  under it shows "saved → yours · reason". `r` resends the same write with the
  same opId (the held intent in the core); Esc discards it. The person's input
  is never lost.
  _Maintainer decision 2026-10-22:_ `r` is offered and acts only when the
  refusal is retryable, that is the server kept no verdict for the op (a
  batch refused whole, an op whose transaction rolled back). A recorded
  rejection or conflict, which the backend repeats for that opId, and a
  partly applied command are for good: `✗` and "saved → yours · reason"
  without `r`; Enter reopens the field with the person's value and saving it
  is a new write (a new opId). 401, 403 and 429 leave the edit queued and are
  no refusal: no `✗`, the status line shows it queued and names the reason
  (`offline · 1 queued · <reason>`).
- **Keys (Q9 A).** Two modes, NORMAL and INSERT, named in the status line,
  with hints that follow the focus. Esc closes the innermost thing first
  (my call): an open input or the `Editor`, then a refusal shown under its
  field, then an overlay (sidebar, card details, the full-screen details
  below 90 columns), then the `/` filter.
- **Kanban (Q10 B).** The board takes the outline and detail columns, in
  one box titled `Board`; the sidebar box stays. Enter opens a card's details
  boxed over the board's right side, and Esc closes them with the cursor on
  the same card. Between 90 and 119 columns it keeps that layout. Below 90 one
  status column shows at a time, switched with ←/→ or h/l, under the header
  `STATUS (n/m)`, its place among the columns (my call on the 90 boundary,
  matching Q5); Enter shows the details full screen. A column taller than the
  box scrolls so the cursor's card is always drawn.
- **Outline row (Q11 C).** One line per task: status marker, priority, title
  truncated with "…", and short fields on the right (#project, due, subtask
  progress). The row under the cursor shows its full title.
- **How the cursor row expands (Q13 B).** The full title is drawn as an
  overlay over the rows below it, so no outline row ever changes position.
  The hidden rows reappear as soon as the cursor moves. It shows at most
  three lines, the last ending with "…" (the detail pane has the rest). Near
  the bottom of the pane it grows upward instead (my call).
- **New task (Q12 A).** `n` opens an input line in the outline under the
  cursor, where the task will appear, using the quick-add grammar
  (`#project @tag pN`, dates). Enter creates it and Esc cancels.
  The row stands after the cursor's group (a subtask's with `O`), so only
  the rows below it move; a view that sorts itself then places the task by
  its sort. `o` stays an alias of `n` and `O` adds a subtask (my call: no
  muscle memory breaks). A refused add follows Q8: the text stays in its row,
  marked `✗` with the reason under it; `r` resends a retryable refusal with
  the same opId, Enter reopens the text and saving it after a permanent
  refusal is a new add, Esc drops the row. From Enter until the answer (and
  the `move` that places it in a manual view) the row shows `saving…` and
  takes no key, and the new task shows only there, not where the engine
  first ranks it.
- **Look (Q14 C).** Section headers in capitals and dim separators, as in
  tuxedo. Panes are boxed (maintainer request 2026-10-22, see "Pane boxes"). Only the 16 ANSI colours, which follow the
  terminal's theme. Colour carries meaning only: priority, overdue, the
  cursor, errors. `NO_COLOR` gives monochrome, and nothing may rely on colour
  alone.
- **Status line (Q16 B).** Two lines. The top line shows the mode and sync
  state: synced, offline, N queued, N refused, then the reason a request was
  refused for now (403, 429), cut first when the line is short; while `/` is
  typed it shows the input instead. The bottom line shows the key
  hints for the focus, truncated at the right and never wrapped.
- **Search (Q17 A).** `/` filters the current outline by a substring of the
  title on the client, and Esc clears it. Search across all tasks is a
  separate design. The input sits in the top status line (INSERT); each key
  narrows the rows, matching case-insensitively after `normalize('NFC')`
  and folding nothing else (`ё` is not `е`). A matching subtask keeps its
  parent row, dimmed. Enter keeps the filter in NORMAL and the Tasks box
  title shows it (`Tasks /milk`); Esc in the input, or last in the Esc order,
  clears it, and so does picking another view. A task added under the
  filter stays among the rows, with the cursor on it, until the filter text
  changes. The sidebar counts stay the core's.
- **Work split (Q15 A).** One PR each, in order:
  - step 0: the core `tag:<id>` built-in view and count;
  - step 1: the frame on `pi-tui`: layout, sidebar, outline, status lines and
    modes, plus straight ports of today's details, board, status and help
    screens, so nothing is lost when Ink goes (my call);
  - step 2: the detail pane with in-place editing and refusals;
  - step 3: quick add in place and the kanban.

  Each step leaves a working TUI.

## Verified facts

- `pi-tui` 0.73.1 (README and `dist`):
  - components implement `render(width): string[]`, `handleInput?`, `invalidate?`;
  - `Container` and `Box` stack children vertically;
  - there is no alternate-screen support (no `?1049` in `dist`);
  - the first render does not clear scrollback;
  - updates are wrapped in synchronized output (CSI 2026);
  - overlays are positioned over existing content;
  - built in: Text, TruncatedText, Input, Editor, Markdown, Loader, SelectList, SettingsList, Spacer, Image, Box, Container.
- `@earendil-works/pi-tui` 1.1.0 and 1.4.0 (d.ts, js, spike runs):
  - `TuiAltScreen` with `setLayoutRoot`, `HStack`/`VStack`/`ScrollView`;
  - `Input({ prompt, placeholder })` and `onEscape`;
  - `setValue` keeps the cursor at `min(cursor, length)`, and there is no
    `setCursor`;
  - `Editor` has no `onEscape`;
  - mouse capture is on by default, and the alternate-screen keybindings
    take PageUp/PageDown, Ctrl+Home/End and Ctrl+Shift+F;
  - `stop()` prints the last frame into the main buffer unless given
    `preserveScreen: true`;
  - 1.4.0 adds an `exit` hook that restores the terminal after a crash;
    neither version restores it on SIGTERM.
- `todoer-tui` before this redesign: Ink 8 + `ink-text-input`. Panes are framed to their content's height. Status line: `synced · j/k move · o new · x done · e details · m status · [ ] views · ? help · q quit`.
- `tuxedo` at 140×36:
  - FILTERS/PROJECTS sidebar with counts, a numbered one-line list, a DETAIL pane with fields and the RAW line;
  - the status line carries `NORMAL`, the hints, the open count, the date and the version.
- The core's `catalog.nav` (C2) has all, today, upcoming and project counts. There is no tag built-in view.

## Risks

- `pi-tui` moves fast (renamed once, 1.0 to 1.4 in three weeks). Pin it
  exactly and bump it in its own PR with the tmux frame check from the
  spike. Each bump re-checks the two workarounds.
- An overlay is positioned by screen coordinates that our own column layout
  computes (Q13's expanded row, Q5's sidebar). A layout change can misplace
  it, so the render tests cover overlays at every width.
- Three layouts (Q5) and two status lines (Q16) mean render tests at several
  widths. Without them the narrow modes will rot.
- The tag view changes the client core only: `{tag: uuid}` is already a
  filter in `@todoer/specs`, and the watch key never reaches the server. It
  lands first, or step 1's sidebar ships without tags. The web's navigation
  must learn the `tag:` key in the same change, or its sidebar links break.

## Deferred

Nothing was deferred in the interview.

## Open threads

- Search across all tasks as a shared core view (Q17 B) needs its own design:
  what counts as a match (notes? closed tasks?).
