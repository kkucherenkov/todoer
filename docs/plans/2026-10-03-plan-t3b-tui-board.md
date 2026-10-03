# Plan T3b: the TUI's board (kanban layout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kanban view shows one column per status, cards in rank order,
the completing column with the tasks closed in the last seven days; cards
move between columns and within one.

**Architecture:** A pure function groups the view's `Item[]` (the engine
publishes `boardTasks` for a kanban view) into columns by `item.column` over
the catalog's statuses. `board.tsx` renders the visible window of columns
and owns the board's keys; the shared task keys come from `useTaskKeys`.
Moving across columns is the engine's `move` with `statusId`; within a
column, `move` with `after`.

**Tech Stack:** Ink 8, React 19.3, Vitest 5, `ink-testing-library`.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Q7, Routine choices:
keys, changing status).

## Global Constraints

- Requires plan T2 (the shell) merged. Rebase on `origin/main` first.
- This plan owns `apps/tui/src/board.tsx` (replace the stub wholesale),
  `apps/tui/src/board-columns.ts` and their specs. Edit no other source
  file; the outline, details and statuses plans run in parallel.
- Within a column, moving only in a view sorted `manual` (web departure 7).
- A user with no statuses sees one column, "Tasks", and `H`/`L` say there is
  nowhere to move (the core treats any `statusId` then as completing).
- Work on branch `feat/tui-board` in this plan's own worktree.

---

### Task 1: Columns

**Files:**

- Create: `apps/tui/src/board-columns.ts`, `apps/tui/src/board-columns.spec.ts`
- Create: `specs/tasks/active/T-2026-10-03-tui-board.md`

**Interfaces:**

- Consumes: `Item`, `Catalog` from `@todoer/client-core`.
- Produces:
  - `type Column = { id: string | null; name: string; completing: boolean; items: Item[] }`
  - `columns(items: Item[], statuses: Catalog['statuses']): Column[]`
  - `visible(count: number, at: number, fit: number): { from: number; to: number }`
    (the window of columns that fits, keeping `at` in it)
  - `moveAfterIn(column: Item[], taskId: string, step: -1 | 1): string | null | undefined`

- [ ] **Step 1: Task spec**

Create `specs/tasks/active/T-2026-10-03-tui-board.md` from the template:

- **FR-001** one column per status in rank order; cards by the view's order
- **FR-002** `h`/`l` change column, `j`/`k` the card
- **FR-003** `H`/`L` move the card to the neighbouring column; into the
  completing column it is marked done and the status line says so
- **FR-004** `J`/`K` reorder within a column in a manual view only
- **FR-005** `o` adds a card to the current column
- **FR-006** the shared task keys, `m` included, work on a card
- **FR-007** more columns than fit scroll horizontally with the cursor
- Steps T001–T004 mirroring this plan's Tasks 1–4.

- [ ] **Step 2: Failing tests**

`apps/tui/src/board-columns.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Catalog, Item } from '@todoer/client-core';
import { columns, moveAfterIn, visible } from './board-columns.js';

const item = (id: string, column: string | null): Item =>
  ({ id, title: id, column, closed: false, tags: [], project: null }) as Item;
const status = (id: string, completing = false): Catalog['statuses'][number] => ({
  id,
  name: id.toUpperCase(),
  rank: id,
  color: null,
  completing,
  tasks: 0,
  version: 1,
});

describe('columns', () => {
  it('groups by column over the statuses, keeping the view order', () => {
    const cols = columns(
      [item('t1', 'b'), item('t2', 'a'), item('t3', 'b')],
      [status('a'), status('b'), status('c', true)],
    );
    expect(cols.map((c) => [c.id, c.items.map((i) => i.id)])).toEqual([
      ['a', ['t2']],
      ['b', ['t1', 't3']],
      ['c', []],
    ]);
    expect(cols[2]?.completing).toBe(true);
  });

  it('is one "Tasks" column when there are no statuses', () => {
    const cols = columns([item('t1', null)], []);
    expect(cols).toEqual([
      { id: null, name: 'Tasks', completing: false, items: [item('t1', null)] },
    ]);
  });
});

describe('visible', () => {
  it('shows everything that fits', () => {
    expect(visible(3, 0, 5)).toEqual({ from: 0, to: 3 });
  });
  it('slides to keep the cursor in view', () => {
    expect(visible(6, 0, 3)).toEqual({ from: 0, to: 3 });
    expect(visible(6, 4, 3)).toEqual({ from: 2, to: 5 });
    expect(visible(6, 5, 3)).toEqual({ from: 3, to: 6 });
  });
});

describe('moveAfterIn', () => {
  const col = [item('a', 's'), item('b', 's'), item('c', 's')];
  it('up and down among the column’s cards', () => {
    expect(moveAfterIn(col, 'c', -1)).toBe('a');
    expect(moveAfterIn(col, 'b', -1)).toBeNull();
    expect(moveAfterIn(col, 'a', 1)).toBe('b');
  });
  it('undefined at the ends', () => {
    expect(moveAfterIn(col, 'a', -1)).toBeUndefined();
    expect(moveAfterIn(col, 'c', 1)).toBeUndefined();
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/board-columns.spec.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Implement**

`apps/tui/src/board-columns.ts`:

```ts
import type { Catalog, Item } from '@todoer/client-core';

export type Column = {
  id: string | null;
  name: string;
  completing: boolean;
  items: Item[];
};

/** One column per status in rank order (the catalog's order), each with the
 *  items whose `column` is that status, in the view's order. No statuses:
 *  one column, the way `displayStatus` leaves every column null. */
export function columns(
  items: Item[],
  statuses: Catalog['statuses'],
): Column[] {
  if (statuses.length === 0) {
    return [{ id: null, name: 'Tasks', completing: false, items }];
  }
  return statuses.map((s) => ({
    id: s.id,
    name: s.name,
    completing: s.completing,
    items: items.filter((i) => i.column === s.id),
  }));
}

/** The columns `[from, to)` that fit `fit` at a time with `at` among them. */
export function visible(
  count: number,
  at: number,
  fit: number,
): { from: number; to: number } {
  if (count <= fit) return { from: 0, to: count };
  const from = Math.min(Math.max(0, at - fit + 1), count - fit);
  return { from, to: from + fit };
}

/** The engine's `after` anchor for moving a card one place in its column;
 *  undefined at that end (see outline-tree's moveAfter for why an anchor in
 *  rank order is enough). */
export function moveAfterIn(
  column: Item[],
  taskId: string,
  step: -1 | 1,
): string | null | undefined {
  const k = column.findIndex((i) => i.id === taskId);
  if (k < 0) return undefined;
  if (step === -1) {
    if (k === 0) return undefined;
    return k === 1 ? null : String(column[k - 2]?.id);
  }
  const next = column[k + 1];
  return next === undefined ? undefined : String(next.id);
}
```

Run: `pnpm --filter @todoer/tui exec vitest run src/board-columns.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/board-columns.ts apps/tui/src/board-columns.spec.ts specs/tasks/active
git commit -m "feat(tui): group a board view's items into columns"
```

---

### Task 2: The board pane

**Files:**

- Replace: `apps/tui/src/board.tsx`
- Create: `apps/tui/src/board.spec.tsx`

**Interfaces:**

- Consumes: `PaneProps`, `useTaskKeys`, `useWrite`, `useTui`, `useTopic`,
  `LineInput`, `renderTui`, `fakeServer`, `KEY`, Task 1's functions.
- Produces: `BoardPane: ComponentType<PaneProps>`.

- [ ] **Step 1: Failing render tests**

`apps/tui/src/board.spec.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { fakeServer, KEY, renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

const status = (id: string, name: string, rank: string, completing = false) => ({
  table: 'status',
  id,
  name,
  rank,
  completing,
  version: 1,
});
const board = {
  table: 'view',
  id: 'v1',
  name: 'Board',
  layout: 'kanban',
  sort: 'manual',
  filter: { all: [] },
  rank: 'a0',
  version: 1,
};
const task = (id: string, statusId: string, rank: string) => ({
  table: 'task',
  id,
  title: id,
  statusId,
  rank,
  priority: 0,
  version: 1,
});

async function open() {
  const t = await renderTui(<App />, {
    server: fakeServer([
      status('todo', 'To do', 'a0'),
      status('doing', 'Doing', 'a1'),
      status('done', 'Done', 'a2', true),
      board,
      task('alpha', 'todo', 'a0'),
      task('beta', 'todo', 'a1'),
    ]),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press(']'); // All open → Board
  return t;
}
const statusOf = (t: Awaited<ReturnType<typeof open>>, id: string) =>
  t.store.rows('task').find((r) => r.id === id)?.statusId;

describe('BoardPane', () => {
  it('shows a column per status with its cards', async () => {
    const t = await open();
    const frame = t.lastFrame() ?? '';
    for (const name of ['To do', 'Doing', 'Done', 'alpha', 'beta']) {
      expect(frame).toContain(name);
    }
  });

  it('moves a card right with L, and into Done marks it done', async () => {
    const t = await open();
    await t.press('L');
    expect(statusOf(t, 'alpha')).toBe('doing');
    await t.press('l', 'L');
    expect(t.lastFrame()).toMatch(/marked done/);
  });

  it('adds a card to the current column with o', async () => {
    const t = await open();
    await t.press('l', 'o', 'gamma', KEY.enter);
    const gamma = t.store.rows('task').find((r) => r.title === 'gamma');
    expect(gamma?.statusId).toBe('doing');
  });
});
```

(The filter `{ all: [] }` must pass `filterProblem`; use the smallest filter
the core accepts if it does not.)

Run: `pnpm --filter @todoer/tui exec vitest run src/board.spec.tsx`
Expected: FAIL (the stub is a flat list).

- [ ] **Step 2: Implement the pane**

`apps/tui/src/board.tsx`:

```tsx
import { Box, Text, useInput, useWindowSize } from 'ink';
import { useState } from 'react';
import { columns, moveAfterIn, visible } from './board-columns.js';
import { useTui } from './context.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { useTopic } from './topics.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

/** The narrowest a column gets before the board scrolls instead. */
const MIN_COLUMN = 22;

export function BoardPane({ view, active, open }: PaneProps) {
  const { topics, status } = useTui();
  const write = useWrite();
  const { columns: width } = useWindowSize();
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const cols = columns(view.items, statuses);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(0);
  const [adding, setAdding] = useState(false);
  const c = Math.min(col, cols.length - 1);
  const cards = cols[c]?.items ?? [];
  const current = cards[Math.min(row, cards.length - 1)];
  const keys = useTaskKeys({ current, viewKey: view.key, open });
  // The sidebar takes 22 columns when shown (app.tsx).
  const fit = Math.max(1, Math.floor((width - (width >= 80 ? 24 : 2)) / MIN_COLUMN));
  const { from, to } = visible(cols.length, c, fit);

  const toColumn = (step: -1 | 1) => {
    const target = cols[c + step];
    if (current === undefined || target === undefined) return;
    if (target.id === null) {
      status.say({ tone: 'info', text: 'no statuses yet — S to add some' });
      return;
    }
    const statusId = target.id;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId: String(current.id),
      view: view.key,
      statusId,
    }));
    setCol(c + step);
  };

  const inColumn = (step: -1 | 1) => {
    if (current === undefined) return;
    if (view.sort !== 'manual') {
      status.say({ tone: 'info', text: 'this view sorts itself: moving needs a manual view' });
      return;
    }
    const after = moveAfterIn(cards, String(current.id), step);
    if (after === undefined) return;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId: String(current.id),
      view: view.key,
      after,
    }));
    setRow((r) => Math.max(0, r + step));
  };

  useInput(
    (input, key) => {
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'h' || key.leftArrow) {
        setCol(Math.max(0, c - 1));
        setRow(0);
      } else if (input === 'l' || key.rightArrow) {
        setCol(Math.min(cols.length - 1, c + 1));
        setRow(0);
      } else if (input === 'j' || key.downArrow) {
        setRow((r) => Math.min(cards.length - 1, r + 1));
      } else if (input === 'k' || key.upArrow) {
        setRow((r) => Math.max(0, r - 1));
      } else if (input === 'H') {
        toColumn(-1);
      } else if (input === 'L') {
        toColumn(1);
      } else if (input === 'J' || (key.meta && key.downArrow)) {
        inColumn(1);
      } else if (input === 'K' || (key.meta && key.upArrow)) {
        inColumn(-1);
      } else if (input === 'o') {
        setAdding(true);
      }
    },
    { isActive: active && !adding && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        {cols.slice(from, to).map((column, k) => {
          const i = from + k;
          return (
            <Box
              key={column.id ?? 'tasks'}
              flexDirection="column"
              width={MIN_COLUMN}
              marginRight={1}
            >
              <Text bold color={i === c ? 'cyan' : undefined}>
                {column.name}
                {column.completing ? ' ✓' : ''} ({column.items.length})
              </Text>
              {column.items.map((item, r) => (
                <Text
                  key={String(item.id)}
                  wrap="truncate-end"
                  inverse={active && i === c && r === Math.min(row, cards.length - 1)}
                  dimColor={item.closed}
                >
                  {String(item.title)}
                </Text>
              ))}
            </Box>
          );
        })}
      </Box>
      {from > 0 || to < cols.length ? (
        <Text dimColor>
          columns {from + 1}–{to} of {cols.length}
        </Text>
      ) : null}
      {keys.overlay}
      {adding ? (
        <LineInput
          label="new:"
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={(text) => {
            setAdding(false);
            const statusId = cols[c]?.id ?? null;
            // `add` sets no status, and a task without one shows in the first
            // column (`displayStatus`): elsewhere a `move` follows the add.
            void (async () => {
              let id = '';
              const added = await write((newId) => {
                id = newId();
                return { kind: 'add', opId: newId(), id, text };
              });
              if (!added.ok || statusId === null || c === 0) return;
              await write((newId) => ({
                kind: 'move',
                opId: newId(),
                taskId: id,
                view: view.key,
                statusId,
              }));
            })();
          }}
        />
      ) : null}
    </Box>
  );
}
```


- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/board.tsx apps/tui/src/board.spec.tsx
git commit -m "feat(tui): show the kanban layout as a board"
```

---

### Task 3: By hand

- [ ] **Step 1: Run it**

Build and run as in the shell plan; open a kanban view; move cards across
and within columns, into the completing column and back out (undo), add a
card to a column; shrink the terminal until the board scrolls. `todoer
list` in another shell agrees. Note anything surprising in the task spec.

---

### Task 4: Documents, gates, PR

- [ ] **Step 1: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/tui... && pnpm lint`
Expected: green.

- [ ] **Step 2: Close the task spec, changelog, PR**

Tick, `Status: done`, `Completed`, `Result`; `git add`; `git mv` to
`specs/tasks/done/`.

`dnote add todoer -c "2026-10-03 · The TUI shows kanban views as a board: columns by status, cards moved across and within columns, closed cards in the completing column for seven days."`

```bash
git add -A
git commit -m "docs: close the TUI board task"
git push -u origin feat/tui-board
gh pr create --title "feat(tui): show the kanban layout as a board" --body "…"
```
