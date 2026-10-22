# TUI UX redesign implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw `todoer-tui` as three full-height columns with a fixed
detail pane and in-place editing, on `@earendil-works/pi-tui`.

**Architecture:** Four pull requests, each one leaving a working TUI.

- PR 0 adds a `tag:<id>` built-in view to the client core, and the web's
  navigation learns it.
- PR 1 replaces Ink with `pi-tui`. It moves the TUI onto a pure
  `render(width)` component tree driven by the engine's topics, ports
  today's screens as they are, and adds the new frame: sidebar, outline,
  status lines and modes.
- PR 2 turns the details into the fixed pane with in-place editing and
  refusals. The web's held intent moves into the client core for this.
- PR 3 adds quick add in place, the new kanban layout and `/` filtering.

**Tech stack:**

- TypeScript on Node 24 (`NodeNext`, `strict`, `exactOptionalPropertyTypes`);
- `@earendil-works/pi-tui` 1.4.0, pinned exactly;
- vitest;
- `@todoer/client-core` (`createEngine`, topics).

**Spec:** [`docs/specs/2026-10-22-tui-ux-redesign-design.md`](../specs/2026-10-22-tui-ux-redesign-design.md)
(Q-numbers below refer to it). It amends
[`docs/specs/2026-10-03-tui-client-design.md`](../specs/2026-10-03-tui-client-design.md).

## Global constraints

- `@earendil-works/pi-tui` is pinned at exactly `1.4.0`, with no range. A bump
  is its own PR.
- Public `pi-tui` API only. The two allowed workarounds (a synthesized Ctrl+E
  after `Input.setValue`, and an Esc check around `Editor`) live in one file,
  `apps/tui/src/pi/adapter.ts`, each marked `// ponytail:` with the upstream
  fix it waits for.
- Exit goes through `tui.stop({ preserveScreen: true })`. The app installs a
  SIGTERM handler that calls it. `TuiAltScreen` is created with
  `mouse: false`, and its alternate-screen keybindings are rebound so PageUp,
  PageDown and Ctrl+Home/End reach the app.
- Widths: three columns at ≥ 120; at 90–119 the sidebar is hidden and opens as
  an overlay when focused; below 90 only the outline, with details full screen
  on Enter.
- Colour: only the 16 ANSI colours; colour carries meaning only (priority,
  overdue, cursor, errors); `NO_COLOR` gives monochrome, and no meaning rests
  on colour alone.
- No frames around panes. Section headers are in capitals.
- The TUI computes no counts: sidebar counts come from `catalog.nav`.
- Repo rules:
  - each PR starts with a task spec in `specs/tasks/active/` and moves it to
    `done/` when it lands;
  - commits are in English, conventional, with no `Co-Authored-By`;
  - docs that become false change in the same PR;
  - `pnpm -w exec turbo run build typecheck test` and `pnpm lint` pass.

## Review focus

- **Wide and combining characters** (CJK, emoji, Cyrillic) in titles, tags and
   project names. Every rendered line stays exactly the pane width, and the
   list never drifts a column. Pinned by the layout test in Task 1.2 and the
   outline test in Task 1.4.
- **A refusal that arrives after the cursor has moved to another task.** It
   shows on the task it belongs to when that task is next selected, never on
   the current one, and the input is kept. Pinned in Task 2.2.
- **Resize while an input or the `Editor` is open, including below 90
   columns.** Nothing typed is lost, and the edit stays on its field. Pinned in
   Task 2.1.
- **A tiny terminal** (< 60 columns or < 12 rows). The app renders a single
   "Terminal too small (need 60×12)" line and recovers on resize, instead of
   throwing on width overflow. Pinned in Task 1.2.
- **The engine publishes while an overlay or an input is open** (a sync tick,
   another client's change). The open input keeps its text and cursor, and an
   overlay stays anchored to its row. Pinned in Task 1.4 and Task 2.1.

---

## PR 0: `tag:<id>` built-in view

Task spec first: `specs/tasks/active/T-2026-10-22-core-tag-view.md`, from the
template, following
[`T-2026-10-21-core-nav-projections`](../../specs/tasks/done/T-2026-10-21-core-nav-projections.md).
Branch `feat/core-tag-view`. `packages/specs` does not change: `{tag: uuid}` is
already a filter, and the watch key is client-only.

### Task 0.1: Core view and navigation entry

**Files:**

- Modify: `packages/client-core/src/engine-protocol.ts` (constants next to
  `PROJECT_PREFIX`, around line 86)
- Modify: `packages/client-core/src/operations.ts` (`builtInView` around line
  1010; `nav` in `catalog()` around line 1356)
- Modify: `packages/client-core/src/engine.ts` (`viewSpec`, around line 165)
- Test: `packages/client-core/src/engine.spec.ts`
  (`describe('built-in views and navigation')`, line 853)
- Modify: `docs/specs/2026-10-01-views-design.md` (the built-in views list)

**Interfaces:**

- Produces:
  - `export const TAG_PREFIX = 'tag:'` (from `engine-protocol.ts`, re-exported
    where `PROJECT_PREFIX` is);
  - `export const tagView = (id: string): ViewSpec`, which returns
    `{ filter: { tag: id }, sort: 'manual', layout: 'list' }`;
  - `builtInView(key: string, projectIds: readonly string[], tagIds: readonly string[]): ViewSpec | undefined`;
  - the `catalog.nav` order is `all, today, upcoming, project:<id>…` then
    `tag:<id>…` (live tags, in `catalog.tags` order).

- [ ] **Step 1: Write the failing tests** in the `built-in views and navigation` block:
  - `tag:<id>: its open tasks in any layout, sorted manual`. Add three tasks:
    two tagged `@home`, and one of those two closed. `watch` the view
    `tag:<home id>` and assert that `items` holds only the open tagged task,
    with `sort === 'manual'`. Then pass `layout: 'kanban'` and assert that the
    published layout is `kanban`.
  - `tag:<id> of an unknown or a deleted tag is published as deleted`. A random
    uuid gives `problem: 'deleted'`, and so does a tag tombstoned after a sync.
  - `the catalog lists tags after projects, each with its count`. With projects
    `B`, `A` and tags `zeta`, `alpha`, the expected keys are
    `['all','today','upcoming','project:<A>','project:<B>','tag:<alpha>','tag:<zeta>']`.
    The `alpha` count equals the number of open tasks tagged `alpha`, subtasks
    included, each task counted once.
  - `a task detached from a tag leaves its count`. Detach the tag and assert
    the count drops by 1 on the next publish.
- [ ] **Step 2: Run them.**
  `pnpm --filter @todoer/client-core test -- -t "tag:"` should fail: the key
  is unknown, and `nav` has no tag entries.
- [ ] **Step 3: Implement.**
  - Add `TAG_PREFIX` and `tagView`.
  - Add a `tag:` branch to `builtInView`, mirroring the `project:` branch:
    `undefined` unless the id is in `tagIds`.
  - In `engine.ts`, `viewSpec` passes `cat.tags.map(t => t.id)`.
  - `catalog()` appends one `nav` entry per entry in `catalog.tags`, counted
    with the same `count` helper.
  - Update the built-in views list in the views design doc.
- [ ] **Step 4: Run** `pnpm -w exec turbo run build test --filter=@todoer/client-core...`. Expected: all pass, the CLI and TUI included.
- [ ] **Step 5: Commit** `feat(client-core): add a tag:<id> built-in view with a navigation count`.

### Task 0.2: Web navigation knows tag entries

**Files:**

- Modify: `apps/web/app/utils/nav.ts` (`navEntries`, `navPath`, `routeKey`,
  `isBuiltIn`)
- Create: `apps/web/app/pages/tags/[id].vue` (a copy of
  `pages/projects/[id].vue` with the `tag:` key)
- Test: `apps/web/app/utils/nav.spec.ts`; `apps/web/e2e/nav.spec.ts`
- Modify: `docs/design/DESIGN.md` (Navigation row: tags listed after projects)

**Interfaces:**

- Consumes: `TAG_PREFIX` and `catalog.nav` tag entries from Task 0.1.
- Produces: `navPath('tag:<id>') === '/tags/<id>'`, and
  `routeKey('/tags/<id>') === 'tag:<id>'`.

- [ ] **Step 1: Write the failing unit tests** in `nav.spec.ts`:
  - `navEntries` names a `tag:` entry from `catalog.tags`;
  - `navPath` and `routeKey` round-trip `tag:<id>` ↔ `/tags/<id>`;
  - a tag missing from `catalog.tags` is left out, the same as an unknown
    project.
- [ ] **Step 2: Write the failing e2e test** in `nav.spec.ts`
  (`a tag in the sidebar opens its tasks with the count from the core`).
  Quick-add `milk @home`, then click `home` in the sidebar. The URL is
  `/tags/<id>`, the list shows `milk`, and the badge is `1`.
- [ ] **Step 3: Run them.** They fail.
- [ ] **Step 4: Implement** the `tag:` branches and the page. The page watches
  `tag:<id>` exactly as the project page watches `project:<id>`.
- [ ] **Step 5: Run** `pnpm --filter @todoer/web test`, `typecheck`, then
  `CI=1 … pnpm --filter @todoer/web e2e -- nav.spec.ts` on chromium and
  firefox, against its own `todoer_e2e_*` database. Expected: pass.
- [ ] **Step 6: Commit** `feat(web): list tags in the navigation`. Move the task
  spec to `done/` in the same PR.

---

## PR 1: The frame on pi-tui

Task spec first: `specs/tasks/active/T-2026-10-22-tui-frame-pi.md`. Branch
`feat/tui-frame-pi`. When this PR lands, Ink, React, `ink-text-input` and
`ink-testing-library` leave `apps/tui/package.json`. `.claude/CLAUDE.md`
("The terminal client (Ink)") and the TUI client design's Q1 note change in
this PR.

### Task 1.1: Runtime shell, topics without React, test kit

**Files:**

- Modify: `apps/tui/package.json`
  - add `"@earendil-works/pi-tui": "1.4.0"`;
  - remove `ink`, `ink-text-input`, `react`, `ink-testing-library`, `@types/react`.
- Create: `apps/tui/src/pi/adapter.ts`, `apps/tui/src/pi/app-shell.ts`
- Modify: `apps/tui/src/topics.ts` (drop the hooks; keep `createTopics` and
  `Topics$`)
- Modify: `apps/tui/src/main.tsx` → rename to `apps/tui/src/main.ts`
- Rewrite: `apps/tui/src/test-kit.tsx` → `apps/tui/src/test-kit.ts`
- Modify: `apps/tui/tsconfig.json` (drop `jsx`); `apps/tui/vitest.config.mjs`
  (include `src/**/*.spec.ts`)

**Interfaces:**

- Produces:
  - `interface Pane extends Component { focus?(on: boolean): void }`, where
    `Component` is pi-tui's (`render(width): string[]`, `handleInput?(data)`,
    `invalidate?()`).
  - `createShell(deps: { terminal: Terminal; root: Pane; onExit: (code: number) => void }): { start(): void; stop(code?: number): void; rows(): number }`.
    It builds `TuiAltScreen` with `mouse: false`, rebinds the
    `tui.altScreen.*` page and home/end keys to nothing, calls
    `setLayoutRoot(root)`, installs SIGTERM and SIGINT handlers that call
    `stop`, and stops with `{ preserveScreen: true }`.
  - In `adapter.ts`:
    - `setInputValue(input: Input, value: string): void`, which is
      `setValue` plus the `ponytail:` Ctrl+E;
    - `withEscape(editor: Editor, onEscape: () => void): Component`, which
      wraps `handleInput` with `matchesKey(data, Key.escape)`.
  - `renderApp(opts?: { server?: FakeServer; width?: number; rows?: number }): Promise<{ frame(): string; lines(): string[]; press(...keys: string[]): Promise<void>; resize(width: number, rows: number): void; settle(): Promise<void>; engine; topics; store; server; cleanup(): void }>`.
    It keeps today's `fakeServer`, `NOW`, `KEY` and the sequential `newId`.
    `frame()` is the root's `render(width)` joined by `\n` and cut to `rows`.
    `press` feeds `root.handleInput` and then `settle()`s.

- [ ] **Step 1: Write the failing test**
  `apps/tui/src/pi/app-shell.spec.ts`
  (`stops on SIGTERM with the screen preserved`). Use a fake `Terminal` that
  records writes. Emit `SIGTERM` and assert that `onExit(143)` was called,
  that `stop` ran once, and that the alternate screen was left (`?1049l` in
  the writes).
- [ ] **Step 2: Write the failing test**
  `apps/tui/src/pi/adapter.spec.ts`
  (`setInputValue puts the cursor at the end`). Call `setInputValue(i, 'abc')`,
  then `i.handleInput('x')`, and expect `getValue() === 'abcx'`.
- [ ] **Step 3: Implement** the files above, and swap the dependencies.
  Port `use-write.ts` to `createWrite(tui: Tui): (build) => Promise<Result>`
  with the same behaviour, and `key-hold.ts` to its pure `createKeyHold`.
  pi-tui routes keys to the focused component, so the Ink-era
  "every `useInput` sees every key" workaround (`KeyHold`) is deleted if no
  caller still needs it.
- [ ] **Step 4: Run**
  `pnpm --filter @todoer/tui test -- src/pi` and `pnpm --filter @todoer/tui typecheck`.
  Expected: the two new specs pass. The old `.spec.tsx` files are deleted as
  each screen is ported in Task 1.6, not before.
- [ ] **Step 5: Commit** `refactor(tui): run on pi-tui with topics outside React`.

### Task 1.2: Layout by width

**Files:**

- Create: `apps/tui/src/layout.ts`
- Test: `apps/tui/src/layout.spec.ts`

**Interfaces:**

- Produces:
  - `type Mode = 'three' | 'two' | 'one'`;
  - `modeFor(columns: number): Mode`, returning `'three'` at ≥ 120, `'two'` at
    90–119, and `'one'` below 90;
  - `widths(columns: number, mode: Mode): { sidebar: number; outline: number; detail: number }`,
    where `sidebar` is 24 in `three` and 0 otherwise,
    `detail = min(48, floor(columns × 0.35))` in `three`/`two` and 0 in `one`,
    and `outline` is the rest minus one-column gaps;
  - `columns(parts: { lines: string[]; width: number }[], rows: number): string[]`,
    which pads or truncates each part to its width with pi-tui's
    `truncateToWidth`/`visibleWidth` and zips the parts into exactly `rows`
    lines;
  - `MIN = { columns: 60, rows: 12 }`;
  - `tooSmall(columns: number, rows: number): string[] | null`.

- [ ] **Step 1: Write the failing tests:**
  - `modeFor` at 140, 120, 119, 90, 89 and 60;
  - `columns` returns exactly `rows` lines, each exactly the sum of the widths
    plus the gaps, for ASCII, `'Разобрать'`, `'買い物'` and `'👍🏽 done'` inputs
    (Review focus 1);
  - `tooSmall(59, 30)` and `tooSmall(80, 11)` return
    `['Terminal too small (need 60×12)']`, and `tooSmall(60, 12)` returns
    `null` (Review focus 4).
- [ ] **Step 2: Run** `pnpm --filter @todoer/tui test -- layout`. Expected: FAIL.
- [ ] **Step 3: Implement** in `layout.ts`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tui): lay out three, two or one column by width`.

### Task 1.3: Sidebar

**Files:**

- Create: `apps/tui/src/sidebar.ts`; delete `sidebar.tsx`
- Test: `apps/tui/src/sidebar.spec.ts`

**Interfaces:**

- Consumes: `catalog.nav` (including `tag:` from PR 0), `catalog.projects`,
  `catalog.tags`, `catalog.views`.
- Produces:
  - `class Sidebar implements Pane`, constructed as
    `new Sidebar({ topics, onPick: (key: string) => void })`;
  - sections `VIEWS` (All open, Today, Upcoming), `PROJECTS`, `TAGS` and
    `SAVED`, each row `name  count`, with the count right-aligned;
  - saved views have no count;
  - j/k move, Enter calls `onPick(key)`, and the current key is marked.

- [ ] **Step 1: Write the failing tests:**
  - `sidebar lists built-ins, projects, tags and saved views with core counts`.
    Seed one project, one tag and one view, then assert the section headers
    in order and the counts equal `catalog.nav`.
  - `Enter on a tag row watches tag:<id>`. The engine receives
    `watch {view: 'tag:<id>'}`.
- [ ] **Step 2–4:** Run (fail), implement, run (pass):
  `pnpm --filter @todoer/tui test -- sidebar`.
- [ ] **Step 5: Commit** `feat(tui): list destinations, projects, tags and views in the sidebar`.

### Task 1.4: Outline with the cursor row overlay

**Files:**

- Create: `apps/tui/src/outline.ts`; delete `outline.tsx` and
  `outline.spec.tsx` once their cases are ported
- Reuse: `outline-tree.ts`, `line.ts` (unchanged)
- Test: `apps/tui/src/outline.spec.ts`

**Interfaces:**

- Consumes: the `view` topic (`items`), the `outline-tree.ts` helpers, and
  `createWrite` (Task 1.1).
- Produces:
  - `class Outline implements Pane`, constructed as
    `new Outline({ tui, onSelect: (taskId: string | null) => void })`;
  - each row is: status marker, `pN` (hidden for the default `p4`), title
    truncated with `…`, then right-aligned `#project`, due and `done/total`;
  - the row under the cursor shows its title on up to 3 lines over the rows
    below it, with the last line ending in `…` when the title is longer. In
    the bottom 3 rows of the pane it grows upward. The other rows are never
    re-ordered or shifted.
  - The pane scrolls only when the cursor leaves it.
  - Today's keys (j/k, o, O, h/l, J/K, Tab and Shift+Tab reparent,
    x/space, s, dd y) work as before. `e` is removed, since details are
    always visible; `i`/Enter moves to Task 2.1.

- [ ] **Step 1: Port the existing cases** from `outline.spec.tsx` to
  `outline.spec.ts` with `renderApp` (adds with `o`, subtask with `O`, fold,
  move, reparent, done and undo, and delete). They fail.
- [ ] **Step 2: Write the failing new tests:**
  - `moving the cursor never shifts a row`. Seed 10 tasks, one with a 200-char
    title. For each j from row 0 to 9, assert that every row except the
    cursor row and the two rows under it keeps the text and the screen row it
    had before.
  - `a long cursor row grows upward at the bottom`. With the cursor on the
    last row, the overlay occupies the rows above it.
  - `a publish while the cursor sits on a long row keeps the overlay on that
    row`. Publish an unrelated change through `fakeServer` and assert that the
    overlay is still anchored to the same task (Review focus 5).
  - A row with a CJK title stays exactly the outline width (Review focus 1).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @todoer/tui test -- outline`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tui): one-line outline rows with the cursor row shown in full`.

### Task 1.5: Root, focus, modes and two status lines

**Files:**

- Create: `apps/tui/src/root.ts`, `apps/tui/src/status-bar.ts`; delete
  `app.tsx`, `status-bar.tsx` and `view-pane.tsx` once their cases are ported
- Reuse: `status-line.ts`
- Test: `apps/tui/src/root.spec.ts`, `apps/tui/src/status-bar.spec.ts`

**Interfaces:**

- Consumes: `Sidebar` (Task 1.3), `Outline` (Task 1.4), `layout.ts`
  (Task 1.2), the detail pane (Task 1.6 port, then Task 2.1).
- Produces:
  - `class Root implements Pane`, constructed as
    `new Root({ tui, rows: () => number })`;
  - focus is `'sidebar' | 'outline' | 'detail'`, cycled by Tab. In `two`, a
    sidebar focus draws it as an overlay over the outline. In `one`, Enter on
    the outline shows the details full screen;
  - `mode: 'NORMAL' | 'INSERT'`, where INSERT is any open input or `Editor`;
  - Esc closes the innermost thing first: input/editor → shown refusal →
    overlay (sidebar, card details, full-screen details) → `/` filter;
  - global keys as today: `q`, `]`/`[`, `v`, `?`, `r` and `S`. Tab no longer
    reparents when focus can move: reparent moves to `>` and `<` (my call,
    write it in the help text).
  - `renderStatus(width: number, s: { mode; sync: Topics['sync']; message: Message | null; hints: string }): [string, string]`.
    Line 1 is the mode, then `synced` / `offline` / `N queued` /
    `N refused`, then the message. Line 2 is the hints, truncated at the right
    with `…` and never wrapped.

- [ ] **Step 1: Port** `app.spec.tsx` and `status-bar.spec.tsx` to `.spec.ts`.
  They fail.
- [ ] **Step 2: Write the failing new tests:**
  - `renderStatus` at widths 140, 80 and 60 always returns exactly 2 lines of
    exactly `width` cells;
  - `offline with 2 queued` shows `offline · 2 queued`;
  - `Tab cycles sidebar → outline → detail` at 140;
  - at 100 columns, focusing the sidebar draws it over the outline, and Esc
    returns;
  - at 80 columns, Enter shows the details full screen, and Esc returns with
    the cursor on the same task;
  - with `NO_COLOR=1`, no frame contains `\x1b[3`;
  - `resize(59, 30)` shows the "too small" line, and `resize(140, 36)` restores
    the frame.
- [ ] **Step 3–4:** Implement, then run `pnpm --filter @todoer/tui test`.
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(tui): three-column frame with modes and a two-line status bar`.

### Task 1.6: Straight ports of the remaining screens

**Files:**

- Create: `details.ts` (today's behaviour, drawn in the detail column),
  `board.ts`, `statuses.ts`, `help.ts`, `ui/picker.ts`, `ui/status-picker.ts`,
  `ui/line-input.ts`. Delete their `.tsx` files and specs once ported.
- Reuse: `board-columns.ts`, `fields.ts`, `editor.ts`, `ui/confirm.ts`
- Modify: `.claude/CLAUDE.md` (the `apps/tui` row: pi-tui, not Ink);
  `docs/specs/2026-10-03-tui-client-design.md` (the Q1 note becomes "done");
  `apps/tui/README.md` if it names Ink

**Interfaces:**

- Consumes: `Pane`, `renderApp` and `createWrite` (Task 1.1).
- Produces: the same keys and behaviour as today for details, board,
  statuses, pickers and help, now as `Pane`s placed by `Root`. The board
  stays in the outline column until PR 3.

- [ ] **Step 1: Port every remaining `.spec.tsx`** to `.spec.ts`, case by case,
  with the same names. They fail.
- [ ] **Step 2: Implement** each screen.
- [ ] **Step 3: Run** `pnpm -w exec turbo run build typecheck test --filter=@todoer/tui...`
  and `pnpm lint`. Expected: pass. `rg -l "from 'ink'|from 'react'" apps/tui`
  finds nothing.
- [ ] **Step 4: Check by hand in tmux** at 140×36, 100×30, 80×24 and 59×20.
  Then run the cross-client scenario from W7 (parent/child → status →
  progress → Undo → offline → sync) against a local backend with
  `TODOER_URL` set and a throwaway `HOME`. Never use `~/.config/todoer`.
- [ ] **Step 5: Commit**
  `refactor(tui): port details, board, statuses and pickers to pi-tui`. Move
  the task spec to `done/`. Tuxedo 434 closes (the status line no longer
  wraps).

---

## PR 2: The fixed detail pane with in-place editing

Task spec first: `specs/tasks/active/T-2026-10-22-tui-detail-pane.md`. Branch
`feat/tui-detail-pane`.

### Task 2.0: Held intent in the client core

**Files:**

- Create: `packages/client-core/src/intent.ts`
- Modify: `packages/client-core/src/index.ts` (export it)
- Modify: `apps/web/app/utils/intent.ts` (re-export from the core, or delete
  it and import the core's at its callers); `apps/web/app/db/client.ts`
  (`Draft` and `mint` move to the core if `intent.ts` needs them)
- Test: `packages/client-core/src/intent.spec.ts`. The web's existing
  `intent.spec.ts` keeps passing unchanged.

**Interfaces:**

- Produces:
  - `type Draft<W extends Write = Write> = Omit<W, 'opId' | 'id'>`;
  - `mint(draft: Draft, newId: () => string): Write`, which adds `opId`, and
    an `id` for `add | saveView | saveStatus | moveOccurrence`, exactly as
    `apps/web/app/db/client.ts:199-205` does today;
  - `createIntent(deps: { mint(d: Draft): Write; write(w: Write): Promise<Result> }): (draft: Draft) => Promise<Result & { write: Write }>`,
    with the web's current behaviour unchanged.

- [ ] **Step 1: Move the web's `intent.spec.ts` cases** into the core's spec.
  Run `pnpm --filter @todoer/client-core test -- intent`. Expected: FAIL.
- [ ] **Step 2: Move the code.**
- [ ] **Step 3: Run** `pnpm -w exec turbo run build test --filter=@todoer/client-core... --filter=@todoer/web`.
  Expected: PASS.
- [ ] **Step 4: Commit** `refactor(client-core): share the held intent with every client`.

### Task 2.1: Fields in place

**Files:**

- Create: `apps/tui/src/detail-pane.ts`; delete the Task 1.6 `details.ts`
- Reuse: `fields.ts`; `pi/adapter.ts` (`setInputValue`, `withEscape`)
- Test: `apps/tui/src/detail-pane.spec.ts`

**Interfaces:**

- Consumes: the `task` topic, `createIntent` (Task 2.0), `Root`'s focus and
  mode (Task 1.5).
- Produces:
  - `class DetailPane implements Pane`;
  - a flat field list in this order: title, project, tags, priority, status,
    scheduled, due, repeat, notes;
  - below it, the subtasks with `[ ]`/`[x]` and the core's progress;
  - j/k moves over the fields and subtasks. Enter puts pi-tui's `Input` on
    that field's own row and column. For notes it is the `Editor`, where
    Enter saves and Shift+Enter or Alt+Enter inserts a newline. Enter saves,
    and Esc cancels.
  - x/space on a subtask row ticks it at the parent's occurrence, as today.
  - Each save is one `edit` write built as a draft through `createIntent`.

- [ ] **Step 1: Write the failing tests:**
  - `Enter on project opens an input on the project row with its value`. The
    input sits on the same screen row as the field, and the rows above it are
    unchanged.
  - `Enter saves one edit with the changed field only`. For example
    `{project: 'work'}`.
  - `Esc cancels and sends nothing`.
  - `notes: Alt+Enter inserts a newline and Enter saves both lines`.
  - `resize to 80 columns while editing keeps the typed text and the field`.
    Type `wor`, resize, and assert the input still holds `wor` on the project
    row of the full-screen details (Review focus 3).
  - `a publish while editing keeps the text and the cursor`. Push an
    unrelated change mid-edit and assert the input value and the cursor
    column (Review focus 5).
- [ ] **Step 2–4:** Run (fail), implement, run (pass):
  `pnpm --filter @todoer/tui test -- detail-pane`.
- [ ] **Step 5: Commit** `feat(tui): edit task fields in place in the detail pane`.

### Task 2.2: Refusals on the field

**Files:**

- Modify: `apps/tui/src/detail-pane.ts`
- Test: `apps/tui/src/detail-pane.spec.ts`

**Interfaces:**

- Consumes: the `Result` from `createIntent` (`{ ok: false, failure: { kind: 'refused', detail } } & { write }`).
- Produces:
  - a refused field keeps the person's value and is marked `✗`;
  - under it: `saved → yours · <failure.detail>`;
  - `r` resends the held write with the same `opId`;
  - Esc discards the refusal and shows the saved value;
  - refusals are held per `taskId` + field, so they survive selecting another
    task.

- [ ] **Step 1: Write the failing tests** with `fakeServer` refusing the op:
  - `a refused project change shows saved → yours · reason`;
  - `r resends the same opId`. `server.sent` has two ops with equal `opId`;
  - `Esc discards and shows the saved value`;
  - `a refusal for task A that arrives while task B is selected shows only on A`.
    Edit A, move to B before the refusal resolves, and assert B's pane has no
    `✗`. Move back to A and assert the `✗` and the kept value
    (Review focus 2).
  - `an unreachable server is not a refusal`. Offline, the edit is queued,
    the status line shows `1 queued`, and no `✗` appears.
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(tui): show a refused field change in place with retry`.
  Move the task spec to `done/`.

---

## PR 3: Quick add in place, the kanban layout and `/`

Task spec first: `specs/tasks/active/T-2026-10-22-tui-add-board-search.md`.
Branch `feat/tui-add-board-search`.

### Task 3.1: `n` adds in place

**Files:**

- Modify: `apps/tui/src/outline.ts`
- Test: `apps/tui/src/outline.spec.ts`

**Interfaces:**

- Consumes: `createIntent` (Task 2.0), the `add` write
  (`{kind: 'add', text, parentId?}`, parsed by the core's quick-add grammar).
- Produces:
  - `n` inserts an input row under the cursor, at the screen row where the
    new task will appear;
  - Enter sends one `add` write and keeps the cursor on the new task; Esc
    removes the row;
  - a refused add keeps the text in the row with the reason under it, and `r`
    resends;
  - `o`/`O` stay as aliases for `n` (my call: no muscle memory breaks).

- [ ] **Step 1: Write the failing tests:**
  - `n, text, Enter adds under the cursor with #project and @tag parsed`.
    For example `buy milk #home @shop p1`.
  - `Esc removes the input row and sends nothing`.
  - `a refused add keeps the text`.
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(tui): type a new task in place in the outline`.

### Task 3.2: Kanban across two columns

**Files:**

- Modify: `apps/tui/src/board.ts`, `apps/tui/src/root.ts`
- Test: `apps/tui/src/board.spec.ts`

**Interfaces:**

- Produces:
  - in `three` and `two`, the board takes the outline and detail columns;
  - Enter opens the card's details as an overlay over the board, and Esc
    closes it;
  - in `one`, one status column shows at a time, switched with ←/→, under the
    header `STATUS (n/m)`;
  - card moves (`J`/`K`/`H`/`L`) are unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `at 140 the board spans outline and detail and the sidebar stays`;
  - `Enter opens card details over the board and Esc closes them with the
    cursor kept`;
  - `at 80 one column shows and → shows the next status`.
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(tui): give the board the outline and detail columns`.

### Task 3.3: `/` filters the outline

**Files:**

- Modify: `apps/tui/src/outline.ts`, `apps/tui/src/root.ts`
- Test: `apps/tui/src/outline.spec.ts`

**Interfaces:**

- Produces:
  - `/` opens an input in the top status line (INSERT);
  - typing keeps only the rows whose title contains the text,
    case-insensitively after `normalize('NFC')`. A matching subtask keeps its
    parent row, shown dimmed;
  - Enter keeps the filter and returns to NORMAL; Esc clears it;
  - the sidebar counts do not change (they are the core's).

- [ ] **Step 1: Write the failing tests:**
  - `/milk keeps the matching rows`;
  - `a matching subtask keeps its parent`;
  - `Esc clears the filter and restores the rows`;
  - `Ё and ё match`.
- [ ] **Step 2–4:** Run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `feat(tui): filter the outline by a substring with /`. Move
  the task spec to `done/`. Tuxedo 436 closes. Close the TUI redesign design
  doc's open thread on search only if the maintainer decides it.

## Self-review

| Spec item | Task |
| --- | --- |
| Q1/Q4 pi-tui 1.4.0, workarounds in one file, SIGTERM, `preserveScreen`, `mouse: false` | 1.1 |
| Q2 three columns, list never moves | 1.2, 1.4, 1.5 |
| Q5 narrow modes | 1.2, 1.5 |
| Q6 sidebar with core counts, `tag:<id>` | 0.1, 0.2, 1.3 |
| Q3/Q7 fields in place, flat list | 2.1 |
| Q8 refusals, same opId | 2.0, 2.2 |
| Q9 modes, Esc order | 1.5 |
| Q10 kanban | 3.2 |
| Q11/Q13 one-line rows, overlay | 1.4 |
| Q12 `n` in place | 3.1 |
| Q14 ANSI 16, `NO_COLOR`, no frames | 1.5 (test), every pane |
| Q16 two status lines | 1.5 |
| Q17 `/` | 3.3 |
| Docs: CLAUDE.md, TUI design Q1, views design, DESIGN.md | 0.1, 0.2, 1.6 |
