# Redesigning the web client with Open Design

[Open Design](https://github.com/nexu-io/open-design) is a local app that
drives the Claude Code CLI as a design engine: you pick a design system and a
skill, type a prompt, and it writes files into a project folder and previews
the HTML. Its defaults (one self-contained HTML artefact, its own token names)
do not match this repository, which needs Nuxt UI 4 tokens, Vue SFCs on Nuxt
UI components, and mockups that leave behaviour and the e2e selectors alone.
This kit steers it:

| Piece                       | Where                                                         | In git                 |
| --------------------------- | ------------------------------------------------------------- | ---------------------- |
| Design system (source)      | [`docs/design/DESIGN.md`](../DESIGN.md), [`docs/design/tokens.css`](../tokens.css) | yes                    |
| Design system (installed)   | `~/projects/petProjects/tools/open-design/design-systems/todoer/` | no, local copy     |
| Output-contract skill       | `~/projects/petProjects/tools/open-design/skills/todoer-repo-bundle/SKILL.md` | no, local only |
| Prompts and reconcile steps | this file                                                     | yes                    |

## 1. Run Open Design

It is cloned at `~/projects/petProjects/tools/open-design` with dependencies
installed. It requires Node 24 (`"engines": { "node": "~24" }`) and pnpm
10.33.2 through corepack; the system Node on this machine is newer, so put
nvm's Node 24 first:

```sh
cd ~/projects/petProjects/tools/open-design
nvm use 24                 # or: export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
pnpm -v                    # expect 10.33.2 (corepack reads packageManager)
pnpm tools-dev run web     # daemon + web UI in the foreground; open the URL it prints
```

`pnpm tools-dev` (no arguments) starts the daemon, web UI and desktop shell in
the background instead; `pnpm tools-dev status`, `logs` and `stop` manage it.
On first load it detects local agent CLIs; choose **Claude Code** (`claude`
must be on `PATH`).

## 2. Select the design system and the skill

Both are already installed (section 7 says how to refresh them). Open
Design's daemon rescans `skills/` and `design-systems/` on every listing
request, so a new or edited file shows up after a page reload: **no daemon
restart and no registry step**. A skill change applies to the next run; start
a new project, or re-select the skill, so the run picks up the new body.

1. **New project → Prototype**, platform **Desktop** (the web client is a
   desktop-first SPA that also has to work at phone width).
2. **Design system: todoer** (category Productivity & SaaS). If it is missing,
   reload; the folder needs `manifest.json`, `DESIGN.md` and `tokens.css`.
3. Create the project. In the chat composer, open the skills picker ("Search
   skills") and choose **todoer repo bundle**, or type `@todoer-repo-bundle`
   in the message. The picker sets it as the project's skill, so later prompts
   in the same project keep it.
4. Paste the prompts below one at a time, **tokens first**. Review each
   result in the preview before sending the next.

Open Design writes into `.od/projects/<project-id>/` inside its checkout.

## 3. What every run produces

The skill fixes the output (its full rules are in the installed `SKILL.md`):

- **Tokens run:** `theme/app.config.ts` (Nuxt UI `ui.colors` and component
  slot settings), `theme/main.css` (the `:root` and `.dark` overrides of
  `--ui-*` variables, as they would be appended to the app's `main.css`),
  `tokens.css` (resolved values in the same shape as
  [`docs/design/tokens.css`](../tokens.css)) and `index.html` (swatches,
  type, radius and focus ring in both themes).
- **Screen run:** `<screen>.vue`, a Vue SFC with `<script setup lang="ts">`
  on Nuxt UI 4 components and Tailwind 4 semantic utilities, and
  `<screen>.html`, a viewable copy that links `tokens.css` and uses the same
  `--ui-*` variables, with every state shown in light and dark side by side.
  Open Design cannot render `.vue`; the `.html` is what its preview shows.
  `index.html` gains a link to each screen.

## 4. Prompts, one at a time

Each prompt names the strings and states of the real screen. Strings in
quotes are the app's English strings; keep them verbatim, the e2e suite finds
controls by them. Screens marked **W5** are on `feat/web-task-editing`, not
yet on `main`; their behaviour is in
[`docs/plans/2026-10-02-plan-w5-web-task-editing.md`](../../plans/2026-10-02-plan-w5-web-task-editing.md)
on that branch.

### 0. Tokens

```text
Emit the todoer tokens per the skill: theme/app.config.ts, theme/main.css,
tokens.css and index.html. Use the todoer DESIGN.md exactly: primary indigo,
secondary zinc, success green, info sky, warning amber, error red, neutral
zinc; light shades primary 600, success 800, info 700, warning 800, error 700;
dark shade 400; --ui-radius 0.25rem; Tailwind's system font stack. Add the
focus-ring slot overrides DESIGN.md lists. index.html shows every semantic
colour as solid, subtle and text, the neutral roles, the type steps, radii and
a focused button and input, in light and dark side by side, with the
measured contrast ratios from DESIGN.md next to each pair.
```

### 1. Gate, sign-in and owner registration

```text
gate (gate.vue + gate.html): what the app shows before the replica is ready.
Single column, max-w-sm, app name "Todoer" and the language switch
("English" / "Русский") on top. States: booting (two skeleton lines);
insecure origin (warning alert "A secure connection is required" + body);
engine failed (error alert "The local database did not start", the reason,
action "Reload"); sign-in form ("Sign in" heading, "Email", "Password",
button "Sign in"; idle, submitting with spinner, error alert "Wrong email or
password."); owner registration on an empty instance ("Create the owner
account", intro line, "Email", "Password" with help "At least 8 characters,
with a letter, a digit and another character.", "Confirm password", button
"Create account"; idle, mismatch error "The passwords do not match." on the
confirm field, server refusal alert). Also the Russian sign-in form to check
longer labels.
```

### 2. Shell: sidebar, sync and update

```text
shell (shell.vue + shell.html): UDashboardGroup with UDashboardSidebar and
UDashboardPanel. Sidebar header "Todoer"; navigation labelled "Views": "All
open" (inbox icon, active), saved views with list / kanban / calendar icons,
one view with the warning icon for a problem, then "New view". Sidebar footer:
"12 tasks", "Last synced 2 minutes ago", badges, buttons "Sync now" and "Sign
out", language switch. Show every sync state from DESIGN.md: synced; syncing
(Sync now loading); "3 waiting"; "Offline" with waiting writes; "2 refused";
never synced ("Not synced yet"). Above the panel body: the sync problem alert
("Sync refused", server text, action "Sync now") and the update prompt ("A new
version is available", "Reload to use it. Your tasks stay on this device.",
"Reload"). Show the sidebar collapsed at phone width.
```

### 3. List view

```text
list (list.vue + list.html): the view body for layout list, content capped at
max-w-3xl. Quick add on top (placeholder "Buy milk #home @errand p2", label
"Quick add", plus icon) with its inline error ("That cannot be done." + the
core's detail). Rows: round "Mark done" button, title (a button that opens
the drawer), parent link for a subtask (W5: corner-down-right icon + parent
title, label "Open parent: <title>"), "#project", "@tags", priority badge p1-p4
per DESIGN.md, the occurrence date of a recurring task, "due 2026-10-05",
status badge, and the "Task actions" menu (Skip, Move up, Move down, Open).
States: empty ("No open tasks."), populated with a mix of all fields, a long
title that wraps, manual sort with the drop line between two rows, the
actions menu open, offline with waiting writes, and the toasts "Done" with
Undo, "Done for 2026-10-02, next 2026-10-03" with Undo, "Skipped" with Undo.
```

### 4. Task drawer

```text
task-drawer (task-drawer.vue + task-drawer.html): USlideover on the right,
title "Task". Fields, each saving on blur: "Title", "Notes" (textarea),
"Project" (select menu with "No project" and create), "Tags" (multi select
with create), "Priority" (radio p0-p4), "Scheduled" and "Due" (date inputs,
each with a "Clear …" x button), "Status" (select, only when statuses exist).
A recurring task shows the scheduled date read-only with "Repeats: <rule>"
and a "Repeat…" / "Edit repeat…" button (W5). W5 also adds: "Subtask of
<title>" link at the top for a subtask; a "Subtasks" section with "1 of 3
done", checkbox per subtask ("Done: <title>"), titles as links, struck when
done, and an "Add subtask" input; a destructive outline "Delete" button at the
bottom. States: loading (two skeletons), populated, "This task no longer
exists.", ended series (fields disabled, "This series has ended; only its
rule can be changed."), moved occurrence ("Moved from 2026-10-01" with
"Return to series"), invalid date toast "Use a date, YYYY-MM-DD.", a refused
save toast.
```

### 5. Recurrence and delete dialogs (W5)

```text
task-dialogs (task-dialogs.vue + task-dialogs.html): two UModal dialogs that
open over the drawer. Recurrence, title "Repeat": select "Repeat" with "Does
not repeat", "Daily", "Weekly", "Monthly", "Yearly", "Custom (RRULE)";
"Every" number input with "day(s)" / "week(s)" / "month(s)" / "year(s)"; for
Weekly an "On" group of weekday checkboxes (Mon … Sun, localised); "Starts"
date; for Custom an "RRULE" text field in the mono font; below, either the
preview list of the next dates (full dates, as <time datetime>) or an error
alert ("Pick at least one day", or the parser's message); "Cancel" and
"Save" (disabled while invalid or unchanged, loading while saving). Show:
none, daily every 2 days, weekly Mon/Wed/Fri with preview, monthly, custom
valid, custom invalid. Delete, title "Delete task": "Delete “Clean kitchen”
and 2 subtasks?", "This cannot be undone.", "Cancel" and a solid error
"Delete" that has focus; plus the variant without subtasks and the toast
"Task deleted".
```

### 6. Kanban board and columns

```text
kanban (kanban.vue + kanban.html): toolbar with an outline "Columns" button.
Columns w-72 scroll horizontally; each is a section named by its status:
header with the name, the completing column's circle-check icon (label
"Completing column") and the count. Cards: title, closed cards struck and
muted, "#project", "@tags", priority, occurrence, "due …", parent link (W5),
and the "Task actions" menu with "Move to" ▸ column list (current one
disabled), Move up, Move down, Open. States: no statuses yet ("Columns appear
after the first sync.", Columns disabled), populated, an empty column, a
card being dragged with the drop line, a focused card, the Move to submenu
open, the toast after dropping into the completing column. Then the Columns
dialog ("Columns", "Rename, reorder and choose the column that completes a
task."): one row per column with the name input ("Column name"), "Make
completing" or the completing icon, Move up / Move down, a destructive
"Delete"; the inline confirm "Delete “Doing”? Its tasks move to Todo (3
tasks)." with "Delete column" and "Cancel"; "New column" input and "Add
column".
```

### 7. Calendar

```text
calendar (calendar.vue + calendar.html): toolbar with "Previous" and "Next"
icon buttons, "Today", the title ("October 2026" for month, "Sep 28 – Oct 4,
2026" for week), and "Week" / "Month" tabs. Month: 7-column grid, weekday
heads, days outside the month muted, today ringed in primary and marked
aria-current, at most 3 placements per day then "+2 more". Week: one column
per day, no limit; stacks to one column at phone width. Placement chip:
calendar icon (scheduled) or flag (due) or check (closed, struck), title,
repeat icon for an occurrence, priority, and "Placement actions" menu (Open,
"Move to date…", the latter absent when closed). States: loading (seven
skeleton cells), empty month, busy month, a day highlighted while a chip is
dragged over it, the menu open, the "Move to date…" dialog (date input,
"Move"), toasts "Moved to Oct 9" and "Oct 7 moved to Oct 9" with Undo.
```

### 8. View form and filter tree

```text
view-form (view-form.vue + view-form.html): UModal "New view" / "Edit view",
"A view shows the tasks its filter matches." Fields: "Name"; "Filter" with a
"Start from" dropdown (Today, Overdue, Next 7 days, Project…, Tag…,
Status…) above the filter tree; the tree: a group row with a "Match" select
("All of" / "Any of"), a "Not" switch, an "Add" menu (Tag, Project, Status,
Priority, Scheduled, Due, Recurring, Group) and children indented with a
left rule; leaf rows with their label and value control (select; p0-p4
checkboxes for priority; for Scheduled/Due a "From" and "To" bound each
"None" / "Days from today" / "Date" with a number or date input and the hint
"0 = today, −1 = yesterday"), a "Not" switch and a "Remove" button; the
limits line "5/256 conditions · depth 2/8". "Raw JSON" switch that swaps the
tree for a mono textarea; the problem line under the filter in text-error.
"Layout" radio (List, Kanban, Calendar), "Sort" select (Manual, Priority,
Due date, Scheduled date), "Cancel" and "Save" (disabled while invalid).
States: new view from Today, a nested tree three levels deep, raw JSON valid,
raw JSON invalid with the problem, a filter the tree cannot edit (raw forced
on). Also the view page header with "Edit" and "Delete" ghost buttons, the
delete confirm "Delete “Work”?" / "The view goes away; its tasks stay.", and
the view problem alert "This view cannot be shown".
```

There is no settings or account screen: the language switch and Sign out
live in the sidebar footer, and nothing else is configurable from the web.

## 5. Reconcile into the repository

Open Design's output is a proposal. The repository takes it in four steps,
each its own commit, with a task spec in `specs/tasks/active/` first.

1. **Tokens → Nuxt UI theming.** Compare the generated `tokens.css` with
   [`docs/design/tokens.css`](../tokens.css). If they differ, decide which is
   right, change `DESIGN.md` and `tokens.css` first, and re-copy them to Open
   Design (section 7). Then:
   - `theme/app.config.ts` → `apps/web/app/app.config.ts` (new file):
     `ui.colors` and the focus-ring `slots` overrides.
   - `theme/main.css` → appended to `apps/web/app/assets/css/main.css`
     after the two `@import` lines: unlayered `:root { … }` and
     `.dark { … }` blocks that set `--ui-<colour>` to
     `var(--ui-color-<colour>-<shade>)`. Unlayered rules win over the
     `@layer theme` block Nuxt UI writes at runtime.
   - Update the "Status" table in `DESIGN.md`: the values are now shipped.
2. **Mockups → `docs/design/mockups/`.** Copy every `<screen>.html` and
   `index.html`, then point them at the shared tokens:
   `sd 'href="tokens.css"' 'href="../tokens.css"' docs/design/mockups/*.html`.
   They are references to look at, not code.
3. **SFCs → `docs/design/mockups/vue/`**, also references: outside
   `apps/web/app`, so Nuxt never builds them. Run
   `./node_modules/.bin/prettier --write docs/design/mockups` before
   committing; Prettier checks every `.vue`, `.css` and `.html` in the repo.
4. **Port into `apps/web` one component at a time.** Take the template and
   classes from the reference; keep the component's `<script setup>` logic,
   props, emits, i18n keys and every item in the contract below. No new
   dependency: if a reference imports anything but Vue, Nuxt UI and the
   app's composables, rewrite that part. Run the component's Vitest specs and
   the Playwright suite (`pnpm --filter @todoer/web e2e`, needs a `*_e2e`
   database, see `.claude/CLAUDE.md`) before each commit. A new string goes
   into both `en.json` and `ru.json`.

### What must not change

The redesign changes how screens look, never what they do: the same writes,
the same toasts with Undo, fields that save on blur, the URL as the source of
the open task (`?task=`) and of the calendar span (`?mode=&at=`), every
keyboard path in `DESIGN.md`, and the CSP (no inline handlers, no remote
fonts, icons bundled by literal name).

The Playwright suite in `apps/web/e2e/` (plus W5's `editing.spec.ts`) finds
elements by the names below. The test id list is every id the app sets, most
of which a test reads; keep them all. Renaming, removing or re-roling any of them
breaks a test; if a redesign needs to, the test changes in the same
commit, deliberately.

**`data-testid`:** `insecure`, `engine-failed`, `loading`, `sign-in`,
`sign-in-error`, `email`, `password`, `confirm`, `register`, `register-form`,
`register-error`, `task-count`, `last-synced`, `offline`, `pending`,
`failed`, `sync-now`, `sign-out`, `sync-problem`, `update-available`,
`new-view`, `view`, `task-list`, `task-row`, `task-title`, `occurrence`,
`task-drawer`, `rule`, `moved-from`, `board`, `column-name`, `completing`,
`cards`, `card`, `calendar`, `calendar-title`, `calendar-skeleton`,
`calendar-day`, `placement`, `placement-title`, `more`, `edit-view`,
`delete-view`, `confirm-delete`, `view-name`, `start-from`, `view-filter`,
`filter-problem`, `view-raw`, `view-sort`, `view-save`, `filter-limits`, and
the filter tree's path-derived ids `node-n…`, `op-n…`, `value-n…`, `not-n…`,
`add-n…`, `remove-n…`, `from-kind-n…`, `to-kind-n…`, `from-offset-n…`,
`to-offset-n…`, `from-date-n…`, `to-date-n…`. W5 adds `parent-link`,
`subtask-of`, `subtasks`, `subtask`, `progress`, `delete-task`,
`rule-problem`, `rule-preview`.

**Accessible names and roles** (`getByRole`, `getByLabel`):

- navigation "Views" with links named after the views ("All open", saved
  view names);
- buttons "Mark done", "Task actions", "Undo", "Sync now", "Columns", "Make
  completing", "Delete column", "Add column", "Move up", "Return to series",
  "Clear Due", "Today", "Next", "Delete", "Русский", and the select-menu
  triggers "Project", "Tags", "Status" (their field labels);
- menu items "Move to", "Move down", "Move to date…", "Project…", column
  names, "Done";
- textboxes "Quick add", "Title", "Notes", "Scheduled", "Due", "Column
  name", "New column"; the dialog's "Date";
- radios "p0"…"p4", "List", "Kanban", "Calendar"; tabs "Week", "Month";
- regions: each kanban column (a `section` named by its status) and each
  calendar day (named by its full date); list items in the Columns dialog
  named by column; `dialog` for the drawer and every modal (the recurrence
  dialog stacks over the drawer as a second dialog); the drawer's
  `heading`; inline errors as `alert`;
- W5: buttons "Repeat…", "Edit repeat…", "Save", "Cancel", "Open parent:
  <title>"; checkboxes "Done: <title>" and the weekday names ("Mon" …);
  combobox "Repeat"; spinbutton "Every"; textboxes "Add subtask", "RRULE";
  field "Starts".

**Attributes and classes:** `data-date` on calendar days, `data-kind`
(`scheduled` / `due`) and `data-task-id` on placements, `data-task-id` on
rows and cards, `aria-current="date"` on today, the `line-through` class on
a closed placement's title, a Lucide calendar icon (`class` containing
`lucide` and `calendar`) inside a calendar view's nav link, `<time
datetime>` in the recurrence preview, Nuxt UI's `[data-slot="description"]`
on toasts, and `aria-selected="true"` on the active tab.

**Visible text** the tests read: "That cannot be done.", "Done for <date>,
next <date>", "Moved from", "The passwords do not match.", "Task deleted",
"The task was deleted", the core's refusal detail "not synced yet" in a toast
description, and the task titles themselves. All English strings come from
`apps/web/i18n/locales/en.json`; tests run in English.

## 6. Contrast and focus, before merging a ported screen

`DESIGN.md` lists measured ratios for the palette. A ported screen keeps them
if it uses only the semantic utilities; check by eye in both themes that
metadata on `bg-elevated` uses `text-toned`, nothing informative uses
`text-dimmed`, and Tab shows a solid indigo ring on every control.

## 7. Refreshing the installed copies

The tool's copies are not in git. After editing the design system:

```sh
cp docs/design/DESIGN.md ~/projects/petProjects/tools/open-design/design-systems/todoer/DESIGN.md
cp docs/design/tokens.css ~/projects/petProjects/tools/open-design/design-systems/todoer/tokens.css
```

The folder also holds a `manifest.json` (Open Design's package format,
`od-design-system-project/v1`, id `todoer`). The skill lives only in
`tools/open-design/skills/todoer-repo-bundle/SKILL.md`; edit it there. Both
show up as untracked files in the Open Design checkout and survive a
`git pull` there. Reload the web UI afterwards; nothing needs a restart.

## Open questions

- **Accent.** Indigo is a proposal that fits "one accent, calm". Any Tailwind
  palette works the same way; changing it means one name in `app.config.ts`
  and re-checking the contrast table.
- **Colour-mode toggle.** Dark mode follows the system today and the web has
  no switch. Adding `UColorModeButton` to the sidebar footer is a behaviour
  change for its own task.
- **Keyboard shortcuts.** None exist. Single-key shortcuts (`n` for quick
  add, `/` for views) would suit "keyboard-first", but they are new
  behaviour, not styling.
- **Focus-ring overrides.** The `slots` keys in section 5 are written
  against Nuxt UI 4.11.3; confirm each component's slot name when porting.
