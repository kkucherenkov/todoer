# todoer

> Category: Productivity & SaaS
> A calm, dense working tool for tasks that sync. Neutral zinc, one indigo accent, the system font.

todoer's web client is for working through a list. Zinc greys carry the
structure, one indigo accent marks what is interactive or current, and the
operating system's own font sets the text. Light and dark get the same care,
and every screen is designed in both. Every value below is a Nuxt UI 4 token, so the whole
system lands in the app as `app.config.ts` and a few CSS variables.

This file is two things at once: the design reference for the web client, and
the `DESIGN.md` of the `todoer` design system in Open Design (a copy lives at
`tools/open-design/design-systems/todoer/DESIGN.md`). The compiled values are
in [`tokens.css`](tokens.css). The workflow that uses both is in
[`open-design/README.md`](open-design/README.md).

## Status: proposed, not shipped

As of 2026-10-02 the web client runs Nuxt UI 4.11.3 with its default theme:

| Setting                | Today                                                                  | Where                                     |
| ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| Semantic colours       | Nuxt UI defaults: `primary` green, `neutral` slate, `secondary` blue    | no `app/app.config.ts` exists             |
| CSS variables          | none overridden; `main.css` is `@import 'tailwindcss'; @import '@nuxt/ui';` | `apps/web/app/assets/css/main.css`        |
| `--ui-radius`          | `0.25rem` (default)                                                    | —                                         |
| Font                   | Tailwind's system stack; `@nuxt/fonts` is off (`ui: { fonts: false }`) | `apps/web/nuxt.config.ts`                 |
| Icons                  | Lucide, bundled into the client (`icon: { provider: 'none', clientBundle: { scan: true } }`) | `apps/web/nuxt.config.ts`, `@iconify-json/lucide` |
| Colour mode            | Nuxt UI's colour mode follows the system preference; no toggle in the UI | —                                         |

Everything this document proposes (the palette, the shade overrides, the
focus ring) takes effect only when the reconcile step in the Open Design
README lands it. Until then this file describes the target and the table above
describes the app.

Binding decisions it builds on: the client-shells design's "Visual design"
(Nuxt UI components and theme, changed only through tokens; the Flutter client
later copies the same tokens) in
[`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md),
its departure 5 (system fonts), and the maintainer's direction of 2026-10-02
(calm, dense, neutral grey, one accent, keyboard-first, light and dark).

## Product context

- **What it is.** A personal task manager: tasks with a project, `@tags`,
  priority `p0`–`p4`, a scheduled date and a due date (dates only, no times,
  ADR 0010), recurrence through an RRULE subset (ADR 0002), one level of
  subtasks, and saved views drawn as a list, a kanban board or a calendar.
- **Local first.** The browser holds a replica in SQLite (WASM, OPFS) run by
  one leader tab's worker. Every write applies locally at once and waits in an
  outbox until `POST /sync` accepts it. The UI therefore has states most todo
  apps do not: waiting, offline, refused, and a stale tab after an update.
- **Two clients.** The CLI is the reference client and its primary caller is
  a script or an agent (ADR 0015). The web client is the human one: the place
  to read, sort, drag and review. It is not the place for bulk automation.
- **One owner per instance, self-hosted.** The first visitor of an empty
  instance registers the owner (ADR 0014); after that the page shows sign-in.
- **Two languages.** English and Russian, switchable at any time. Russian
  labels run about a third longer, and plural forms differ (`1 задача`,
  `3 задачи`, `5 задач`). No layout may depend on English string widths.

## Principles

1. **The list is the loudest thing on screen.** Sidebar, toolbars and badges
   use neutral greys; task titles use `--ui-text-highlighted`. If a decoration
   competes with a title, the decoration goes.
2. **Dense, not cramped.** A task row is one line at 36 px when it has no
   wrapped metadata. Space between rows is a 1 px divider, not padding.
   Controls keep Nuxt UI's `md` size (14 px text); density comes from layout,
   not from shrinking type below 12 px.
3. **One accent, one meaning.** `primary` (indigo) means interactive, selected
   or current: the solid button, the active nav item, today's cell, the drop
   line, the focus ring. It never decorates.
4. **Colour never carries meaning alone.** Priority badges say `p4`, the
   completing column has an icon with a label, offline is a word. A
   colour-blind user loses nothing.
5. **Every pointer action has a keyboard path.** Drag has a menu
   equivalent (Move up/down, Move to, Move to date…). See Accessibility.
6. **Sync state is honest and quiet.** The sidebar says how many writes wait
   and when the last sync happened. A refusal is shown with the server's
   reason, never swallowed, never a modal.
7. **Tokens only.** Components use Nuxt UI props (`color`, `variant`, `size`)
   and Tailwind's semantic utilities (`text-muted`, `bg-elevated`,
   `border-default`). No hex, no arbitrary values, no new UI dependency.

## Colour

### Nuxt UI semantic colours

`app.config.ts` maps each semantic colour to a Tailwind palette:

| Nuxt UI colour | Palette  | Used for                                                              |
| -------------- | -------- | --------------------------------------------------------------------- |
| `primary`      | `indigo` | the accent: solid buttons, active nav, today, drop line, focus ring    |
| `secondary`    | `zinc`   | not used; mapped to grey so an accidental use cannot add a second accent |
| `success`      | `green`  | the completing column's mark, done states                              |
| `info`         | `sky`    | the update prompt, priority `p2`                                       |
| `warning`      | `amber`  | offline, a view with a problem, priority `p1`                          |
| `error`        | `red`    | refusals, sync problem, destructive buttons, priority `p0`             |
| `neutral`      | `zinc`   | every surface, border and text role                                    |

Nuxt UI points `--ui-<colour>` at shade 500 in light mode and 400 in dark.
Shade 500 fails AA for text and subtle badges in light mode, so `main.css`
moves the light shades down; dark keeps Nuxt UI's 400:

| Variable       | Light (`:root`)         | Dark (`.dark`)          |
| -------------- | ----------------------- | ----------------------- |
| `--ui-primary` | indigo-600 `#4f39f6`    | indigo-400 `#7c86ff`    |
| `--ui-success` | green-800 `#016630`     | green-400 `#05df72`     |
| `--ui-info`    | sky-700 `#0069a8`       | sky-400 `#00bcff`       |
| `--ui-warning` | amber-800 `#973c00`     | amber-400 `#ffb900`     |
| `--ui-error`   | red-700 `#c10007`       | red-400 `#ff6467`       |

Hex values are the sRGB rendering of Tailwind 4's oklch palette; `tokens.css`
holds the oklch originals.

### Neutral roles

Nuxt UI's defaults on the `zinc` palette, unchanged:

| Variable                | Light           | Dark            | Role                                          |
| ----------------------- | --------------- | --------------- | --------------------------------------------- |
| `--ui-bg`               | white           | zinc-900 `#18181b` | page, panel, drawer, card                  |
| `--ui-bg-muted`         | zinc-50 `#fafafa`  | zinc-800 `#27272a` | sidebar, hover row                      |
| `--ui-bg-elevated`      | zinc-100 `#f4f4f5` | zinc-800 `#27272a` | kanban column, menu, muted calendar day |
| `--ui-bg-accented`      | zinc-200 `#e4e4e7` | zinc-700 `#3f3f46` | pressed, selected row                   |
| `--ui-bg-inverted`      | zinc-900        | white           | tooltip                                       |
| `--ui-border`           | zinc-200        | zinc-800        | dividers, card and input borders              |
| `--ui-border-muted`     | zinc-200        | zinc-700        | nested group rule (filter tree)               |
| `--ui-border-accented`  | zinc-300 `#d4d4d8` | zinc-700     | hovered input                                 |
| `--ui-text-dimmed`      | zinc-400 `#9f9fa9` | zinc-500 `#71717b` | placeholders and disabled text only     |
| `--ui-text-muted`       | zinc-500 `#71717b` | zinc-400 `#9f9fa9` | metadata: project, tags, dates, counts  |
| `--ui-text-toned`       | zinc-600 `#52525c` | zinc-300     | metadata on `--ui-bg-elevated`                |
| `--ui-text`             | zinc-700 `#3f3f46` | zinc-200 `#e4e4e7` | body text, labels                       |
| `--ui-text-highlighted` | zinc-900        | white           | task titles, headings                         |
| `--ui-text-inverted`    | white           | zinc-900        | text on a solid accent                        |

### Semantic roles in todoer

**Priority.** User decision 2026-10-03: P0 is highest, P4 is lowest.
Sort ascending (0 first). P0 is a real priority, never “none”; every value
has a visible `pN` badge. Core currently uses the previous descending scale;
implement the shared semantic change before porting these badges.

| Priority | Badge | Meaning |
| --- | --- | --- |
| `p0` | `color="error" variant="subtle"` | highest |
| `p1` | `color="warning" variant="subtle"` | high |
| `p2` | `color="info" variant="subtle"` | medium |
| `p3` | `color="neutral" variant="subtle"` | low |
| `p4` | `color="neutral" variant="subtle"` | lowest |

**Language.** One RU/EN switch displays both labels and the current state.
RU selected means Russian; EN selected means English. Keyboard focus and
an accessible localized language name are required; the switch must not
show only the destination language.

**Status columns.** Status names are the user's own, so they get no colour.
A column header is `text-highlighted` with a muted count. The completing
column carries `i-lucide-circle-check` in `text-success` with the label
"Completing column". In a list row the status is a `neutral` `outline` badge.
A closed card or placement is `text-muted line-through`.

**Sync states**, shown in the sidebar footer:

| State                           | Signal                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| synced                          | "Last synced 2 minutes ago" in `text-muted`; no badge                  |
| syncing                         | the Sync now button shows Nuxt UI's `loading` spinner                  |
| writes waiting                  | `neutral` `subtle` badge "3 waiting"                                   |
| offline (server not reached)    | `warning` solid badge "Offline"; writes keep queueing                  |
| writes refused                  | `error` `subtle` badge "2 refused"                                     |
| sync refused (a problem string) | `error` `subtle` `UAlert` "Sync refused" above the page, with Sync now |
| update waiting                  | `info` `subtle` `UAlert` "A new version is available" with Reload      |

### Contrast, measured

Computed with the WCAG 2 formula from Tailwind 4's oklch values (subtle
backgrounds composited at 10 % over the surface). Every pair the system uses
for text meets 4.5:1:

| Pair                                                   | Light | Dark  |
| ------------------------------------------------------ | ----- | ----- |
| `--ui-text` on `--ui-bg`                               | 10.46 | 13.98 |
| `--ui-text-muted` on `--ui-bg`                         | 4.83  | 6.74  |
| `--ui-text-muted` on `--ui-bg-muted`                   | 4.62  | 5.66  |
| `--ui-text-toned` on `--ui-bg-elevated`                | 7.02  | —     |
| `--ui-primary` text on `--ui-bg`                       | 6.44  | 5.68  |
| `--ui-primary` text on `--ui-bg-elevated`              | 5.85  | 4.77  |
| `--ui-text-inverted` on solid `--ui-primary`           | 6.44  | 5.68  |
| `--ui-error` on its subtle badge                       | 5.33  | 5.39  |
| `--ui-success` on its subtle badge                     | 6.07  | 8.35  |
| `--ui-warning` on its subtle badge                     | 6.09  | 8.50  |
| `--ui-info` on its subtle badge                        | 5.06  | 6.94  |
| `--ui-primary` on its subtle badge                     | 5.51  | 4.97  |
| subtle badges over `--ui-bg-muted` (lowest: info)      | 4.85  | —     |

Two pairs fail and are therefore rules, not accidents:

- `--ui-text-muted` on `--ui-bg-elevated` in light mode is **4.39**. On an
  elevated surface (kanban column, muted calendar day) metadata uses
  `text-toned`.
- `--ui-text-dimmed` is **2.63** on white and **3.67** on zinc-900. It is for
  placeholders and disabled controls only, never for information.

Nuxt UI's stock shade 500 would have failed here: green-500 is 2.22:1 and
amber-500 2.15:1 on white, and even red-600 on its own 10 % tint is 3.99.

## Typography

**The system font stack, kept.** Tailwind 4's default `--font-sans`
(`ui-sans-serif, system-ui, sans-serif`, plus emoji fonts) renders San
Francisco on Apple, Segoe UI on Windows and the distribution's sans on Linux.
Reasons to keep it: the CSP forbids remote fonts, `@nuxt/fonts` would make
every CI build depend on the network (departure 5), OS fonts cover Cyrillic
properly, and the offline PWA precache stays small. Bundling a face (Inter,
Public Sans) stays possible later as a single `--font-sans` change.

`--font-mono` (Tailwind's default stack) is for the raw filter JSON and the
RRULE field only.

| Role                     | Tailwind         | Size / line height | Weight          |
| ------------------------ | ---------------- | ------------------ | --------------- |
| Auth heading             | `text-xl`        | 20 / 28 px         | `font-semibold` |
| Panel and calendar title | `text-lg`        | 18 / 28 px         | `font-semibold` |
| Task title in a row      | `text-sm`        | 14 / 20 px         | `font-medium`   |
| Body, labels, controls   | `text-sm`        | 14 / 20 px         | `font-normal`   |
| Row metadata             | `text-sm`        | 14 / 20 px         | `font-normal`, `text-muted` |
| Section heading in drawer | `text-sm`       | 14 / 20 px         | `font-medium`   |
| Calendar chip, day number, hints | `text-xs` | 12 / 16 px        | `font-normal`   |

Counts, dates and the sync time use `tabular-nums` so they do not jitter as
they change. No text below 12 px. No negative letter-spacing: at 14 px it
costs legibility for nothing.

## Spacing and density

Tailwind's 4 px scale (`--spacing: 0.25rem`). The rhythm:

| Where                              | Value                                  |
| ---------------------------------- | -------------------------------------- |
| Task row                           | `px-2 py-1.5`, `gap-3` between check, text and menu; rows separated by `divide-y divide-default` |
| Row metadata                       | `gap-x-2 gap-y-1`, wraps under the title on narrow screens |
| Kanban column                      | `w-72`, `p-2`, `gap-2` between cards   |
| Kanban card, placement chip        | card `p-2`; chip `px-1.5 py-1`         |
| Calendar day                       | `min-h-24` (week: no limit), `p-1`, `gap-1` between days |
| Form stacks (dialogs, drawer)      | `gap-4` between fields                 |
| Panel body                         | Nuxt UI `UDashboardPanel` padding (`p-4 sm:p-6`) |
| List reading width                 | content capped at `max-w-3xl` so a row does not stretch across a wide monitor; board and calendar use the full width |

Controls stay at Nuxt UI's `md` (14 px text, 32 px tall). Icon-only buttons
inside rows, cards and chips are `sm` or `xs`; every target stays at least
24 × 24 px (WCAG 2.2, 2.5.8).

## Shape and elevation

**Radius.** `--ui-radius: 0.25rem`, Nuxt UI's default. Tailwind's radii derive
from it: `rounded-sm` 4 px, `rounded-md` 6 px (buttons, inputs, cards,
chips), `rounded-lg` 8 px (kanban columns, dialogs). `rounded-full` is for the
round "Mark done" button only.

**Elevation.** The page is flat. Surfaces separate by background step
(`bg-default` → `bg-muted` → `bg-elevated`) and a 1 px `border-default`.
Shadows belong to overlays only, as Nuxt UI draws them: dropdown menus,
select menus, the slideover, modals and toasts. In dark mode a shadow is
nearly invisible, so overlays rely on their border and on `--ui-bg-elevated`.

## Motion

Nuxt UI's own transitions stay on (`theme.transitions: true`): overlays fade
and slide in about 200 ms, buttons transition colour. The app adds nothing
else; the drag indicator is a static 2 px `border-primary` line, not an
animation. New motion must sit behind `motion-safe:` and must never move
layout under the pointer. `USkeleton` pulses; that is the one loop, and it
only runs while something loads.

## Iconography

Lucide, through `@iconify-json/lucide`, bundled into the client: the CSP's
`connect-src 'self'` blocks the Iconify API. The bundle is built by scanning
the source, so an icon name must appear **literally** (`'i-lucide-kanban'`);
a name assembled at runtime is not bundled and renders as nothing.

| Meaning                 | Icon                          |
| ----------------------- | ----------------------------- |
| All open (nav)          | `i-lucide-inbox`              |
| List, kanban, calendar view | `i-lucide-list`, `i-lucide-kanban`, `i-lucide-calendar` |
| View with a problem     | `i-lucide-triangle-alert` (`text-warning`) |
| Add, quick add          | `i-lucide-plus`               |
| Mark done               | `i-lucide-check`              |
| Skip                    | `i-lucide-skip-forward`       |
| Move up / down          | `i-lucide-arrow-up`, `i-lucide-arrow-down` |
| Open task               | `i-lucide-panel-right-open`   |
| Row actions             | `i-lucide-ellipsis`           |
| Columns, Move to        | `i-lucide-columns-3`          |
| Completing column       | `i-lucide-circle-check`       |
| Scheduled, due, recurring | `i-lucide-calendar`, `i-lucide-flag`, `i-lucide-repeat` |
| Move to date…           | `i-lucide-calendar-arrow-down` |
| Previous / next period  | `i-lucide-chevron-left`, `i-lucide-chevron-right` |
| Edit, delete            | `i-lucide-pencil`, `i-lucide-trash-2` |
| Clear a field           | `i-lucide-x`                  |
| Parent link, subtask of | `i-lucide-corner-down-right`, `i-lucide-corner-up-left` (W5) |

Icons are 20 px in `md` buttons, 16 px in `sm`/`xs`, 14 px (`size-3.5`) in
calendar chips. An icon-only button always has an `aria-label`.

## Layout

One shell, `UDashboardGroup`:

- **Sidebar** (`UDashboardSidebar`): the app name in the header; `ViewNav`
  (`UNavigationMenu`, vertical, labelled "Views": All open, then the saved
  views with their layout icon, then "New view"); the footer holds the sync
  summary and the language switch.
- **Panel** (`UDashboardPanel`): `UDashboardNavbar` with the title, the sync
  problem alert under it, then the view body: list, board or calendar.
- **Task drawer** (`USlideover`, right side) opens over any view from the
  `?task=<id>` query, so a task link survives a reload.
- **Overlays**: `UModal` for the view form, columns, Move to date, and (W5)
  recurrence and delete; `UToast` for marks, moves and refusals, each with
  Undo where an inverse exists.

Before sign-in the gate shows a single column, `max-w-sm`, with the app name
and the language switch at the top.

## Components

Every app component maps onto Nuxt UI. The redesign restyles these through
props, slots, `ui` overrides and semantic utilities; it adds no component
library.

| App component                         | Nuxt UI parts                                                   | Design notes                                                   |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `AppGate`                             | `UAlert`, `USkeleton`                                           | insecure origin (warning), engine failed (error, Reload), loading skeleton |
| `SignInForm`, `RegisterForm`          | `UForm`, `UFormField`, `UInput`, `UButton`, `UAlert`            | one column; the error alert sits above the fields; the password rule is the field's help text |
| `LocaleSwitch`                        | `UButton` × 2                                                   | current locale `solid`, other `outline`; could become a `UFieldGroup` |
| `AppShell`                            | `UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`, `UAlert` | see Layout                                    |
| `ViewNav`                             | `UNavigationMenu`, `UButton`                                    | active item in `primary`; a problem view gets the warning icon |
| `SyncStatus`                          | `UBadge`, `UButton`                                             | task count, last synced, badges per sync state, Sync now, Sign out |
| `UpdatePrompt`                        | `UAlert` (info)                                                 | above everything, Reload action                                |
| `ViewBody`                            | `UAlert` (warning)                                              | a view whose filter is invalid or deleted shows why            |
| `QuickAdd`                            | `UInput` (`size="lg"`, leading `i-lucide-plus`)                 | placeholder shows the syntax: `Buy milk #home @errand p2`; error line in `text-error` |
| `TaskList`, `TaskRow`                 | `UButton`, `UBadge`, `UDropdownMenu`                            | round check, title, parent link (W5), `#project`, `@tags`, priority, occurrence, due, status; actions menu |
| `KanbanBoard`, `KanbanColumn`, `KanbanCard` | `UButton`, `UIcon`, `UBadge`, `UDropdownMenu`             | columns scroll horizontally; card focusable, Enter opens       |
| `ColumnsDialog`                       | `UModal`, `UInput`, `UButton`, `UIcon`                          | rename inline, reorder with arrows, make completing, delete with inline confirm |
| `CalendarView`, `CalendarDay`         | `UButton`, `UTabs`, `USkeleton`                                 | toolbar: previous, next, Today, title, Week/Month tabs         |
| `PlacementChip`                       | `UIcon`, `UBadge`, `UDropdownMenu`                              | kind icon, title, repeat icon, priority, menu                  |
| `MoveDateDialog`                      | `UModal`, `UInput type="date"`, `UButton`                       | the keyboard path for a calendar drag                          |
| `ViewForm`                            | `UModal`, `UForm`, `UInput`, `UDropdownMenu`, `UTextarea`, `USwitch`, `URadioGroup`, `USelect` | name, Start from, filter tree or raw JSON, layout, sort |
| `FilterTree`, `FilterNode`            | `USelect`, `UCheckboxGroup`, `UInputNumber`, `UInput`, `USwitch`, `UDropdownMenu`, `UButton` | nested groups indent with a `border-l border-default` rule; limits line in `text-xs text-muted` |
| `TaskDrawer`                          | `USlideover`, `UFormField`, `UInput`, `UTextarea`, `USelectMenu`, `URadioGroup`, `UButton`, `USkeleton` | fields save on blur; priority as radio `p0`–`p4` |
| `SubtaskList` (W5)                    | `UCheckbox`, `UButton` (link), `UInput`                         | progress "1 of 3 done"; add on Enter                           |
| `RecurrenceDialog` (W5)               | `UModal`, `USelect`, `UInputNumber`, `UCheckboxGroup`, `UInput`, `UAlert` | presets, weekdays, start, raw RRULE in mono, preview list or problem alert |
| `DeleteTaskDialog` (W5)               | `UModal`, `UButton`                                             | Delete has focus so Enter confirms; "This cannot be undone."   |
| toasts (`useMarked`, `useFail`, calendar moves) | `useToast()`                                          | title, task title as description, Undo action; refusals in `error` |

**Focus ring.** Nuxt UI 4.11 draws focus as a 3 px outline in the component's
colour at 25 % opacity. Measured against the surface that is 1.5–2.3:1, below
the 3:1 WCAG 1.4.11 asks of a focus indicator. The system therefore sets the
outline colour to solid `primary` on focus (indigo-600 on white 6.44:1,
indigo-400 on zinc-900 5.68:1), through `ui.<component>.slots` in
`app.config.ts` (`focus-visible:outline-primary`) for `button`, `input`,
`select`, `selectMenu`, `textarea`, `checkbox`, `radioGroup` and `switch`.
The app's own focusable cards and chips already use
`focus-visible:outline-2 focus-visible:outline-primary`.

## Accessibility

- **Contrast**: AA for all text (see Colour). Non-text indicators (focus
  ring, completing icon, drop line, today ring) meet 3:1.
- **Focus**: always visible on keyboard focus, never on mouse click
  (`focus-visible`). Overlays trap focus and return it on close (Nuxt UI).
- **Landmarks and names**: the sidebar navigation is labelled "Views"; each
  kanban column is a `section` named by its status; each calendar day is a
  `region` named by its full date, and today carries `aria-current="date"`;
  inline errors are `role="alert"`; the drawer's "not found" and "ended"
  lines are `role="status"`.
- **Keyboard paths that exist** (the redesign keeps every one):
  - Quick add: type, Enter adds. Subtask input (W5): Enter adds.
  - Task row: Tab to the check button ("Mark done") and the actions menu
    ("Task actions": Skip, Move up, Move down under the manual sort, Open);
    the title is a button that opens the drawer.
  - Kanban card: focusable, Enter opens; actions menu has "Move to" with a
    submenu of columns, plus Move up / Move down and Open.
  - Calendar chip: focusable, Enter opens; "Placement actions" menu has Open
    and "Move to date…", which opens a dialog with a date field.
  - Calendar navigation: Previous, Next, Today buttons; Week / Month tabs.
  - Columns dialog: rename in place, Move up / Move down, Make completing,
    Delete with an inline confirm.
  - Filter tree: every node's operator, value, Not switch, Add menu and
    Remove button are form controls.
  - Overlays: Escape closes the drawer and every dialog. In the delete
    dialog (W5) the Delete button has focus, so Enter confirms.
  - Drawer fields commit on blur, so Tab moves on and saves.
- **No global shortcuts exist today.** "Keyboard-first" in this system means
  every action is reachable and visible on focus; single-key shortcuts would
  be new behaviour and need their own task.
- **Motion**: see Motion; nothing essential is conveyed by animation.
- **Language**: every string is in `en.json` and `ru.json`; layouts tolerate
  the longer Russian labels and wrap rather than truncate labels of controls.

## States

Every screen is designed in each of these, in both themes:

| State          | What the app shows today                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Booting        | gate: two `USkeleton` lines while the worker starts and the session restores                               |
| Insecure       | gate: warning alert "A secure connection is required" (no worker without HTTPS or localhost)               |
| Engine failed  | gate: error alert "The local database did not start" with the reason and Reload                            |
| Signed out     | sign-in form; on an empty instance, the owner registration form instead                                    |
| Empty          | list: "No open tasks." under quick add; board: "Columns appear after the first sync."; drawer: "This task no longer exists." |
| Loading        | calendar: seven skeleton cells until the worker answers the span; drawer: two skeleton blocks              |
| Populated      | the view's rows, cards or placements; closed items struck through in `text-muted`                          |
| Offline        | "Offline" warning badge; writes apply locally and the "N waiting" badge counts them; nothing blocks        |
| Write refused  | an error toast with the reason (`useFail`); the field or row goes back to the server's value               |
| Sync refused   | error alert "Sync refused" with the server's text and Sync now; the "N refused" badge                      |
| Conflict       | no merge dialog: fields merge last-write-wins (ADR 0004). A rule change sent against a stale version is refused and shows as a write refusal |
| View problem   | warning alert "This view cannot be shown" with the filter problem, or "This view no longer exists."        |
| Read-only      | a recurring task whose series ended: fields disabled, "This series has ended" status line                  |
| Moved occurrence | drawer: "Moved from {date}" with Return to series                                                        |
| Update waiting | info alert "A new version is available" with Reload; tasks stay on the device                              |

## Voice

Plain, short, specific. Say what happened and what to do: "The server cannot
be reached.", "Delete “Groceries”? Its tasks move to Inbox (3 tasks)." No
exclamation marks, no jokes in errors, no "Oops". Mockups use the existing
English strings verbatim: the Playwright suite finds controls by them.

## Anti-patterns

- A second accent colour, gradients, glass, glow, or colour used as
  decoration.
- Hex, `px` or arbitrary Tailwind values in components; raw palette classes
  (`text-indigo-600`) instead of semantic ones (`text-primary`).
- A web font, a remote stylesheet, an inline script, or an icon from outside
  Lucide (the CSP and the offline bundle forbid them).
- A computed icon name (`` `i-lucide-${x}` ``): it is not bundled.
- `--ui-text-dimmed` for anything a user must read; `text-muted` on
  `bg-elevated` in light mode.
- State shown by colour alone; a priority badge without its `pN` text.
- Hiding a refusal or a waiting write to look tidy.
- Changing a `data-testid`, an accessible name, a role or a visible label the
  e2e suite reads (the list is in the Open Design README).
- A new UI dependency, or a component that re-implements one Nuxt UI already
  has.
