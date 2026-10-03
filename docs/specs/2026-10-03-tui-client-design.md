# Sub-project 3: the terminal client

A keyboard-first terminal client in the spirit of
[todool](https://github.com/Skytrias/todool)'s list mode, next to the CLI.
It is `apps/tui`, a new package with the binary `todoer-tui`, written with Ink
on Node. It shares the CLI's replica and session at
`~/.config/todoer/todoer.db`, so `todoer login` once serves both. It runs the
same sync engine as the web client: before the TUI is built, that engine moves
out of `apps/web` into `@todoer/client-core`. v1 has the list and kanban
layouts, full task editing, status management and a new core operation to
re-parent a task. The work ships as four pull requests, T0 to T3.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **engine** | The long-lived session around the client core: one replica, single-flight sync, every write kind, and the topics a screen subscribes to. `createEngine` in `@todoer/client-core`. | worker, service |
| **topic** | A value the engine publishes after every change: `session`, `sync`, `catalog`, `view`, `task`. | event, store |
| **outline** | The list layout as the TUI shows it: subtasks nested under their parent when both are listed. | tree view |
| **re-parent** | Setting or clearing a task's `parentId`: indent and outdent. | move (a move changes rank or status) |

## Why

The domain design deferred "a terminal client, in the spirit of `tuxedo`" to
v2, and named its cost: the offline requirement makes every client thick, so
a TUI needs its own replica, outbox, replay and recurrence expansion
(`2026-09-25-domain-and-sync-design.md`, Deferred). Plan W0 paid that cost by
moving all of it into `@todoer/client-core`. What a long-lived client still
lacks is the loop around the core: when to sync, what to recompute, how a
write's result reaches the screen. The web client had that loop in
`apps/web/app/db/engine.ts`; the CLI does not need one, because each of its
invocations is one command.

## Locked decisions

### Ink on Node (Q1)

**Decision.** `apps/tui` renders with Ink 8 (React 19.3+), on the Node 24 the
repository already runs, with `ink-testing-library` for render tests.

**Rejected.**

- *OpenTUI.* Faster renderer, but it requires Bun, and the core's
  `./node-sqlite` adapter is built on `node:sqlite`: a Bun adapter and a second
  runtime in CI, for a list of a few hundred rows.
- *vue-termui.* Would match the web's Vue, but it is an abandoned experiment.
- *neo-blessed, terminal-kit.* Imperative widgets: the state-to-screen code
  that React does is written by hand.
- *Hand-rolled ANSI.* No dependency, and a thousand lines of terminal
  infrastructure (widths, resize, text input) instead of features.
- *Go (Bubble Tea) or Rust (ratatui).* No reuse of the client core: a fifth
  implementation of replay, recurrence and the outbox, which is the cost the
  domain design warned about.

**Cost.** React enters the stack next to the web's Vue. It stays inside
`apps/tui`.

### The web client stays on Vue (Q2)

**Decision.** The web client is not rewritten in React to share code with the
TUI.

**Rejected.** *Port the web client to React.* What the two clients share is
the client core and the engine, both framework-free. Ink's `<Box>` and DOM
components do not substitute for each other, so a shared React layer would be
a hook of about 30 lines that subscribes to topics. It would cost rewriting
W2–W5. The web also runs the engine inside a leader tab's worker, and the TUI
runs it in-process, so even that hook would differ.

### A separate package sharing the CLI's replica (Q3)

**Decision.** `apps/tui` with its own binary `todoer-tui`, opening the same
database file as the CLI.

**Rejected.**

- *A `todoer tui` subcommand.* Ink and React would become CLI dependencies,
  and the CLI's first callers are scripts and agents (ADR 0015).
- *Its own replica.* A second sign-in and a second snapshot on the same
  machine, and a task the CLI just added would not show until both synced.

**Cost.** Several processes write one SQLite file: the CLI's short-lived ones
and the TUI's long-lived one. See Risks.

### The engine moves into the client core (Q4)

**Decision.** `createEngine` moves from `apps/web/app/db/engine.ts` to
`@todoer/client-core` (portable entry, no Node or DOM import), with the types
it speaks: `Command`, `Write`, `Topics`, `Result`, `Failure`, `SyncReason`,
`ALL`. Its `auth` and `tokens` dependencies are narrowed to two structural
types, `EngineAuth` and `EngineTokens`, which `CookieAuthApi` and
`CookieTokenSource` already satisfy. The dispatcher and the worker's message
types (`ToWorker`, `FromWorker`) move too: they have no browser dependency,
and the engine's spec tests the dispatcher. The web keeps only the names of
its browser transport: `CHANNEL`, `LEADER_LOCK`, `Init`, `Fatal`.
`engine.spec.ts` moves with the engine, with only its imports and its mocked
module changed (ADR 0018).

The TUI adapts the CLI's session model (`tokenSource`, the refresh token kept
by `Store.saveAuth`) to `EngineTokens`. `TODOER_TOKEN` overrides the stored
session as it does in the CLI.

**Rejected.**

- *A small engine of the TUI's own.* About 150 lines, and the web untouched,
  but a third copy of when and how to sync, next to the web's and the CLI's.
- *Drive the CLI's `run()`.* It is shaped for one command and an exit code.

**Cost.** A refactor of the web's most central file before any TUI code. Its
proof is that nothing changes: the moved `engine.spec.ts`, the web's unit
tests and the Playwright suite pass untouched.

### The TUI is one tab to the engine (Q5)

**Decision.** The TUI calls `watch('tui', …)` for what it shows and receives
topics through the `publish` callback, read by components with
`useSyncExternalStore`. The engine's multi-tab bookkeeping stays and costs
nothing here.

### Re-parenting is a new core operation (Q6)

**Decision.** `reparent(core, minted, taskId, parentId | null)` joins the core
operations, and `Write` gets `kind: 'reparent'`. It checks on the client what
the server enforces, so a refused indent never reaches the outbox: a task is
not its own parent, the parent has no parent, the task has no live subtasks
(the two-level rule), and a recurring task has no parent (`row-rules.ts`).

**Rejected.** *Indent through `editTask`.* `TaskChanges` has no `parentId`,
and a parent change carries rules no other field has.

**Cost.** The web gets a write kind it does not use yet.

### v1 scope (Q7)

**Decision.** v1 has:

- the list layout as an outline, with folding and indent/outdent;
- the kanban layout over the view's statuses;
- adding, editing in place, done/undo, skip, delete;
- full task editing in a details panel: title, project, tags, priority,
  status, scheduled and due dates, recurrence, notes;
- changing a task's status from either layout;
- managing statuses: add, rename, reorder, mark completing, delete.

Not in v1: creating or editing views (the filter tree), the calendar layout,
a sign-in screen, the mouse.

## Routine choices

- **Layout.** A sidebar with the views beside the main pane, and a status bar
  below. Under 80 columns the sidebar hides and `v` opens a view picker. The
  view's `layout` picks the list or the board, as on the web. Projects and
  tags are filters, and a filter is a view: they reach the sidebar with views
  CRUD. Built-in presets the web adds ("Today", "Upcoming" in the web
  redesign proposal) belong in the client core beside `ALL_OPEN`, so the TUI
  lists them without code of its own.
- **The outline.** Built in the TUI from the view's flat `Item[]`. A subtask
  nests under its parent when the parent is listed. One whose parent is
  filtered out stands at the top level with a `parent ›` prefix, as on the
  web; there are no duplicates. Fold state lives in memory. A parent shows
  `done/total` and a bar over all its live subtasks, closed ones included,
  from `Item.subtasks` (plan T1b): a view of open tasks lists no closed
  subtasks, so the TUI cannot count them itself. A folded parent also shows
  `+N`. Completing a subtask does not complete its parent.
- **The board's cards.** A subtask is a card of its own, named
  `parent › title`.
- **Keys.** Arrow keys and vim keys both work.

  | Key | List | Board |
  | --- | --- | --- |
  | `j` `k` `↓` `↑` | cursor | cursor in the column |
  | `h` `l` `←` `→` | fold, unfold | neighbouring column |
  | `J` `K` `Alt-↑` `Alt-↓` | move the task (manual sort only) | move in the column |
  | `H` `L` | — | move to the neighbouring column |
  | `Tab` `Shift-Tab` | indent under the previous task, outdent | — |
  | `o` `O` | new task below, new subtask | new task in the column |
  | `Enter` `i` | edit the line in place | edit the line in place |
  | `x` `Space` | done, undo | done, undo |
  | `s` | skip a recurring occurrence | skip |
  | `m` | status picker | status picker |
  | `e` | details panel | details panel |
  | `dd` | delete, confirmed with `y` | delete |
  | `S` | statuses screen | statuses screen |
  | `[` `]` `v` | previous, next view, view picker | the same |
  | `r` `?` `q` | sync now, help, quit | the same |

- **Editing a line.** The line opens as `title @tags #project pN` and is read
  back with `parseQuickAdd`; the difference becomes one `editTask`. Adding and
  editing share that grammar. An input closes when its write is taken (a
  queued offline write is) and keeps the typed text on a refusal, whose
  reason the status bar shows.
- **The details panel.** It takes the main pane; a side-by-side layout from
  120 columns is deferred.
  Each field saves on its own as one `editTask` (or `setRecurrence`), with no
  Save step. Dates are `YYYY-MM-DD`, empty clears, and an unparsable value is
  reported on the field and not saved. Recurrence offers presets (daily,
  weekdays, weekly on a day, monthly on a date, none) and a raw RRULE checked
  with `parseRrule`; it is disabled for a subtask. Notes open in `$EDITOR`
  (`vi` when unset) with Ink suspended.
- **Changing status.** `m` opens a picker, and the choice is a `move` with
  `statusId`. Moving into the completing status closes the task, as on the
  web; the next occurrence of a recurring task is reported in the status bar.
- **The statuses screen.** `a` adds after the cursor, `Enter` renames, `J`/`K`
  reorder, `c` marks completing, `dd` deletes after `y`. These are the
  engine's `saveStatus`, `setCompleting` and `deleteStatus`.
- **Sync cadence.** At start, after every write, and every 30 s; `r` syncs at
  once. A task the CLI added shows on the next tick, because every publish
  recomputes from the local replica.
- **Failures.** A `Result` failure is one line in the status bar.
  `unreachable` reads `offline · N pending` and is not an error; `refused` and
  `invalid` show the core's text until the next key. No session, or a replica
  that belongs to another account, shows a screen that says to run
  `todoer login`. An exception while rendering restores the terminal, prints
  the stack to stderr and exits 3, the CLI's code for a local failure.
- **Testing.** `engine.spec.ts` moves unchanged. `reparent` gets a spec for
  each of its four rules. The TUI's logic is tested without rendering: the
  outline from `Item[]`, the line-to-`editTask` difference, the key map. A few
  `ink-testing-library` scenarios render against a real engine on a temporary
  SQLite file with a fake `send`. Nothing needs Postgres, so `Workspace tests`
  runs them and no CI job is added.
- **Text input.** `ink-text-input` if it supports Ink 8; otherwise a small
  input of our own. Decided in T2.

## Alignment with the web redesign

`docs/proposals/2026-10-03-web-ux-redesign.md` ("Синхронизация с TUI") asks
both clients for the same semantics. Where it left a question, the core
already answers it, and the TUI follows the core:

- **Completing a parent.** No cascade either way (ADR 0009): completing the
  parent leaves its subtasks open, completing every subtask leaves the
  parent open, and the parent shows derived progress.
- **A subtask's project.** `add` with a parent gives the new subtask the
  parent's project unless the text names one (`operations.ts`, `add`). It is
  a default at creation, not inheritance: `editTask` can set another
  project later, `reparent` leaves the project as it is, and nothing changes
  a subtask's project when its parent's changes. The proposal's "no implicit
  project inheritance" holds for later changes, not for this default; the
  maintainer kept the default (2026-10-03).
- **Deleting a parent.** `deleteTask` deletes the parent with its live
  subtasks in one batch (#391). That is the one cascade the core has.
- **A subtask's status.** Its own `statusId`; moving its card never touches
  the parent's.
- **Progress and subtasks outside the filter.** `Item.subtasks` counts every
  live subtask (plan T1b); `taskDetails` lists them all (the TUI's `e`). The
  view's own count is never mixed with either.
- **Layout.** The TUI draws the saved `view.layout` and has no override in
  v1. A client that lets a person switch list and board in place keeps that
  choice to itself and never writes it to the view.
- **Reparent.** Both clients use the core's `reparent` write and its checks.

## Plans

| Plan | Pull request | Done when |
| --- | --- | --- |
| T0 | Move the engine and its types into the client core; the web changes only imports. | The moved `engine.spec.ts`, the web's unit tests and Playwright pass untouched. |
| T1 | `reparent` and its write kind; a test of two stores flushing one file. | Each rule has a failing-first spec; the concurrency test passes. |
| T1b | `Item.subtasks`: `done/total` over a task's live subtasks. | It agrees with `taskDetails`' checklist. |
| T2 | `apps/tui`'s shell: session adapter, cadence, sidebar, a flat list, the shared task keys, line codec, status picker, one stub file per T3 plan. | Render scenarios pass; the walking-skeleton flow works by hand against a live backend. |
| T3a–d | Outline, board, details screen, statuses screen; each replaces one stub. | Render scenarios for each; documents updated. |

Each plan is built in its own worktree. T0 and T1 run in parallel, then T1b
and T2, then the four T3 plans in parallel. T0 also adds ADR 0018 (the
engine lives in the client core; the TUI is the fourth client) and T2 adds
the TUI to the stack table in `.claude/CLAUDE.md`.

## Risks

- **Several writers on one replica.** The web's engine assumes one writer:
  `cookieTokenSource` takes no lock because one worker owns the origin. The
  CLI already runs as concurrent processes, and `tokenSource` refreshes under
  `withWriteLock`, but `flush` takes no lock, and a long-lived process next to
  short-lived ones is new. T1's `shared-replica.spec.ts` flushes two stores
  on one file at once: no operation is lost, both outboxes end empty and the
  cursor never moves back. An operation may be sent twice; the server's opId
  guard answers the second with `duplicate` (ADR 0005). So `flush` stays
  unlocked: a lock would hold SQLite's write lock across a network call and
  stall every CLI run until its busy timeout.
- **The engine move (T0).** The web's most central file moves. The proof is
  the same as W0's: nothing changes, every existing test passes untouched.
- **Terminal differences.** `Alt-↑` and `Shift-Tab` arrive differently across
  terminals. The vim keys (`J`, `K`) are the fallback that always works.

## Deferred

- **Views CRUD and the filter tree.** After v1.
- **The calendar layout.** After v1; `calendarTasks` is ready for it.
- **A sign-in screen.** The session adapter can already save a login; only
  the screen is missing.
- **The mouse.**
- **A parent's subtasks outside the filter.** The web redesign proposal lets
  expanding a parent reveal its subtasks the filter leaves out; the outline
  shows only listed ones, and `e` lists them all.

## Open threads

None.
