# Plan T3a: the TUI's outline (list layout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The list layout shows tasks as a todool-style outline: subtasks
nested under their parent, folding, indent and outdent, moving a task among
its siblings, adding a task or a subtask.

**Architecture:** A pure function turns the view's flat `Item[]` into outline
rows; `outline.tsx` renders them and owns the outline's keys, delegating the
shared task keys to `useTaskKeys`. Indent and outdent are the engine's
`reparent` write; moving is its `move` write with an `after` anchor.

**Tech Stack:** Ink 8, React 19.3, Vitest 5, `ink-testing-library`.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Q6, Routine choices:
the outline, keys).

## Global Constraints

- A `LineInput` closes only when its write is taken (`result.ok`; a queued offline write counts) and stays open with the typed text on a refusal: `onSubmit={(t) => void write(…).then((r) => r.ok && close())}`, never `close()` before the write (shell plan, rule after `flat-list.tsx`).
- Requires plan T2 (the shell), plan T1 Task 3 (the engine's `reparent`
  write) and plan T1b (`Item.subtasks`) merged. Rebase on `origin/main` first; if
  `packages/client-core/src/engine-protocol.ts` has no `'reparent'` kind,
  stop and tell the coordinator.
- This plan owns `apps/tui/src/outline.tsx` (replace the stub wholesale),
  `apps/tui/src/outline-tree.ts` and their specs. Edit no other source file;
  the board, details and statuses plans run in parallel.
- Moving a task (`J`/`K`) only in a view sorted `manual`; elsewhere say so on
  the status line and write nothing (web departure 7: ranks only in a manual
  view).
- Work on branch `feat/tui-outline` in this plan's own worktree.

---

### Task 1: Outline rows

**Files:**

- Create: `apps/tui/src/outline-tree.ts`, `apps/tui/src/outline-tree.spec.ts`
- Create: `specs/tasks/active/T-2026-10-03-tui-outline.md`

**Interfaces:**

- Consumes: `Item` from `@todoer/client-core`.
- Produces:
  - `type OutlineRow = { item: Item; depth: 0 | 1; children: number; open: number; folded: boolean }`
  - `outline(items: Item[], folded: ReadonlySet<string>): OutlineRow[]`
  - `parentIn(items: Item[], item: Item): string | null`: the listed parent's id, or null
  - `indentTarget(rows: OutlineRow[], at: number): string | null`
  - `moveAfter(items: Item[], taskId: string, step: -1 | 1): string | null | undefined`
    (`undefined`: nothing to do)

- [ ] **Step 1: Task spec**

Create `specs/tasks/active/T-2026-10-03-tui-outline.md` from
`specs/tasks/templates/feature.md`, with:

- Goal: the list layout as an outline, as the design describes.
- Requirements:
  - **FR-001** nest a listed subtask under its listed parent; a subtask whose
    parent is not listed stands at the top level with `parent ›`
  - **FR-002** `h`/`l` fold and unfold; a folded parent shows `+N`
  - **FR-003** `Tab` indents under the nearest top-level task above;
    `Shift-Tab` outdents; refusals reach the status line
  - **FR-004** `J`/`K` move a task among its siblings in a manual view only
  - **FR-005** `o` adds a task, `O` a subtask of the current top-level task
  - **FR-006** the shared task keys work on every row
- Steps T001–T004 mirroring this plan's Tasks 1–4.

- [ ] **Step 2: Failing tests**

`apps/tui/src/outline-tree.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Item } from '@todoer/client-core';
import { indentTarget, moveAfter, outline } from './outline-tree.js';

const item = (
  id: string,
  extra: Partial<Item> & { parentId?: string } = {},
): Item =>
  ({
    id,
    title: id,
    ref: id,
    occurrence: null,
    project: null,
    tags: [],
    status: null,
    column: null,
    closed: false,
    parentTitle: null,
    ...extra,
  }) as Item;

describe('outline', () => {
  const items = [
    item('a'),
    item('a1', { parentId: 'a' }),
    item('b'),
    item('a2', { parentId: 'a', closed: true }),
    item('x1', { parentId: 'x', parentTitle: 'x' }), // parent not listed
  ];

  it('nests listed subtasks under their parent, in view order', () => {
    expect(outline(items, new Set()).map((r) => [r.item.id, r.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
      ['x1', 0],
    ]);
  });

  it('counts children and open children', () => {
    const [a] = outline(items, new Set());
    expect(a).toMatchObject({ children: 2, open: 1, folded: false });
  });

  it('hides a folded parent’s subtasks', () => {
    expect(outline(items, new Set(['a'])).map((r) => r.item.id)).toEqual([
      'a',
      'b',
      'x1',
    ]);
    expect(outline(items, new Set(['a']))[0]?.folded).toBe(true);
  });

  it('does not fold a task without listed subtasks', () => {
    expect(outline(items, new Set(['b']))[3]?.folded).toBe(false);
  });
});

describe('indentTarget', () => {
  const rows = outline(
    [item('a'), item('a1', { parentId: 'a' }), item('b'), item('c')],
    new Set(),
  );
  it('is the nearest top-level row above', () => {
    expect(indentTarget(rows, 2)).toBe('a'); // b under a, past a1
    expect(indentTarget(rows, 3)).toBe('b');
  });
  it('is null for the first row and for a subtask', () => {
    expect(indentTarget(rows, 0)).toBeNull();
    expect(indentTarget(rows, 1)).toBeNull();
  });
});

describe('moveAfter', () => {
  const items = [
    item('a'),
    item('a1', { parentId: 'a' }),
    item('a2', { parentId: 'a' }),
    item('b'),
    item('c'),
  ];
  it('up: after the sibling two above, or first', () => {
    expect(moveAfter(items, 'c', -1)).toBe('a');
    expect(moveAfter(items, 'b', -1)).toBeNull();
    expect(moveAfter(items, 'a2', -1)).toBeNull();
  });
  it('down: after the next sibling', () => {
    expect(moveAfter(items, 'a', 1)).toBe('b');
    expect(moveAfter(items, 'a1', 1)).toBe('a2');
  });
  it('undefined at either end of its siblings', () => {
    expect(moveAfter(items, 'a', -1)).toBeUndefined();
    expect(moveAfter(items, 'c', 1)).toBeUndefined();
    expect(moveAfter(items, 'a2', 1)).toBeUndefined();
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/outline-tree.spec.ts`
Expected: FAIL, missing module.

- [ ] **Step 3: Implement**

`apps/tui/src/outline-tree.ts`:

```ts
import type { Item } from '@todoer/client-core';

export type OutlineRow = {
  item: Item;
  depth: 0 | 1;
  /** Listed subtasks (top-level rows only). */
  children: number;
  /** Of those, the ones not closed. */
  open: number;
  folded: boolean;
};

/** The listed parent's id; null for a top-level task or one whose parent
 *  the view does not list (it then stands at the top with `parent ›`). */
export function parentIn(items: Item[], item: Item): string | null {
  const parent = item.parentId;
  return typeof parent === 'string' && items.some((i) => i.id === parent)
    ? parent
    : null;
}

/** Parents in view order, each followed by its listed subtasks in view
 *  order, unless folded. The engine already sorted `items`. */
export function outline(
  items: Item[],
  folded: ReadonlySet<string>,
): OutlineRow[] {
  const kids = new Map<string, Item[]>();
  for (const i of items) {
    const p = parentIn(items, i);
    if (p !== null) kids.set(p, [...(kids.get(p) ?? []), i]);
  }
  const rows: OutlineRow[] = [];
  for (const i of items) {
    if (parentIn(items, i) !== null) continue;
    const mine = kids.get(String(i.id)) ?? [];
    const isFolded = mine.length > 0 && folded.has(String(i.id));
    rows.push({
      item: i,
      depth: 0,
      children: mine.length,
      open: mine.filter((k) => !k.closed).length,
      folded: isFolded,
    });
    if (isFolded) continue;
    for (const k of mine) {
      rows.push({ item: k, depth: 1, children: 0, open: 0, folded: false });
    }
  }
  return rows;
}

/** The task Tab puts row `at` under: the nearest top-level row above it.
 *  Null for the first row and for a subtask (two levels only). */
export function indentTarget(rows: OutlineRow[], at: number): string | null {
  if (rows[at]?.depth !== 0) return null;
  for (let i = at - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row?.depth === 0) return String(row.item.id);
  }
  return null;
}

/**
 * The `after` anchor that moves `taskId` one place among its siblings (same
 * listed parent), for the engine's `move`: the engine places the task right
 * after the anchor in rank order, and ranks are global, so the sibling order
 * comes out right whatever lies between. `undefined`: already at that end.
 */
export function moveAfter(
  items: Item[],
  taskId: string,
  step: -1 | 1,
): string | null | undefined {
  const me = items.find((i) => i.id === taskId);
  if (me === undefined) return undefined;
  const parent = parentIn(items, me);
  const siblings = items.filter((i) => parentIn(items, i) === parent);
  const k = siblings.findIndex((i) => i.id === taskId);
  if (step === -1) {
    if (k <= 0) return undefined;
    return k === 1 ? null : String(siblings[k - 2]?.id);
  }
  const next = siblings[k + 1];
  return next === undefined ? undefined : String(next.id);
}
```

Run: `pnpm --filter @todoer/tui exec vitest run src/outline-tree.spec.ts`
Expected: PASS.

Note on `moveAfter(items, 'b', -1)` returning `null` (first): "first" in the
engine is first in the whole view, which puts `b` before `a` and also before
`a`'s subtasks; that is the same sibling order the user asked for.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/outline-tree.ts apps/tui/src/outline-tree.spec.ts specs/tasks/active
git commit -m "feat(tui): build outline rows from a view's items"
```

---

### Task 2: The outline pane

**Files:**

- Replace: `apps/tui/src/outline.tsx`
- Create: `apps/tui/src/outline.spec.tsx`

**Interfaces:**

- Consumes: `PaneProps` (`screens.ts`), `useTaskKeys` (`task-keys.tsx`),
  `useWrite`, `useTui`, `LineInput`, `renderTui`, `fakeServer`, `KEY`
  (`test-kit.tsx`), the Task 1 functions.
- Produces: `OutlinePane: ComponentType<PaneProps>`.

- [ ] **Step 1: Failing render tests**

`apps/tui/src/outline.spec.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { fakeServer, KEY, renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

const status = {
  table: 'status',
  id: 's1',
  name: 'To do',
  rank: 'a0',
  completing: false,
  version: 1,
};
const task = (id: string, rank: string, extra: Record<string, unknown> = {}) => ({
  table: 'task',
  id,
  title: id,
  rank,
  priority: 0,
  version: 1,
  ...extra,
});

async function open(...rows: Record<string, unknown>[]) {
  const t = await renderTui(<App />, { server: fakeServer([status, ...rows]) });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.settle();
  return t;
}

const lines = (frame: string | undefined) =>
  (frame ?? '').split('\n').map((l) => l.trim());

describe('OutlinePane', () => {
  it('nests a subtask under its parent and folds it with h', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1', { parentId: 'alpha' }));
    const before = lines(t.lastFrame());
    const a = before.findIndex((l) => l.includes('alpha'));
    expect(before[a + 1]).toContain('beta');
    await t.press('h');
    expect(t.lastFrame()).not.toContain('beta');
    expect(t.lastFrame()).toContain('+1');
    await t.press('l');
    expect(t.lastFrame()).toContain('beta');
  });

  it('indents with Tab and outdents with Shift-Tab', async () => {
    const t = await open(task('alpha', 'a0'), task('gamma', 'a1'));
    await t.press('j', KEY.tab);
    const row = () => t.store.rows('task').find((r) => r.id === 'gamma');
    expect(row()?.parentId).toBe('alpha');
    await t.press(KEY.shiftTab);
    expect(row()?.parentId ?? null).toBeNull();
  });

  it('refuses to indent a task that has subtasks, on the status line', async () => {
    const t = await open(
      task('alpha', 'a0'),
      task('beta', 'a1'),
      task('beta1', 'a2', { parentId: 'beta' }),
    );
    await t.press('j', KEY.tab);
    expect(t.lastFrame()).toMatch(/subtasks cannot become a subtask/);
  });

  it('adds a subtask with O', async () => {
    const t = await open(task('alpha', 'a0'));
    await t.press('O', 'child', KEY.enter);
    const child = t.store.rows('task').find((r) => r.title === 'child');
    expect(child?.parentId).toBe('alpha');
  });

  it('moves a task down with J in a manual view', async () => {
    const t = await open(task('alpha', 'a0'), task('beta', 'a1'));
    await t.press('J');
    const frame = lines(t.lastFrame());
    expect(frame.findIndex((l) => l.includes('beta'))).toBeLessThan(
      frame.findIndex((l) => l.includes('alpha')),
    );
  });
});
```

("All open" is sorted `manual`: `ALL_OPEN` in the core. If it is not, give
the test a saved manual view and press `]` first.)

Run: `pnpm --filter @todoer/tui exec vitest run src/outline.spec.tsx`
Expected: FAIL (the stub is a flat list).

- [ ] **Step 2: Implement the pane**

`apps/tui/src/outline.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { Item } from '@todoer/client-core';
import { useTui } from './context.js';
import { indentTarget, moveAfter, outline, type OutlineRow } from './outline-tree.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

const BAR = 8;

/** `▓▓▓░░ 3/5` from the core's count of every live subtask (plan T1b), not
 *  only the ones this view lists. */
const bar = (item: Item) => {
  const p = item.subtasks;
  if (p === null || p.total === 0) return '';
  const done = Math.round((p.done / p.total) * BAR);
  return `${'▓'.repeat(done)}${'░'.repeat(BAR - done)} ${p.done}/${p.total}`;
};

const labels = (item: Item) =>
  [
    ...item.tags,
    ...(item.project === null ? [] : [`#${item.project}`]),
    ...(Number(item.priority ?? 0) > 0 ? [`p${String(item.priority)}`] : []),
    ...(typeof item.dueOn === 'string' ? [`due ${item.dueOn}`] : []),
  ].join(' ');

export function OutlinePane({ view, active, open }: PaneProps) {
  const { status } = useTui();
  const write = useWrite();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [at, setAt] = useState(0);
  const [adding, setAdding] = useState<null | { parentId?: string }>(null);
  const rows = outline(view.items, folded);
  const row = rows[Math.min(at, rows.length - 1)];
  const current = row?.item;
  const keys = useTaskKeys({ current, viewKey: view.key, open });

  const fold = (id: string, on: boolean) =>
    setFolded((f) => {
      const next = new Set(f);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const reparent = (taskId: string, parentId: string | null) =>
    void write((newId) => ({ kind: 'reparent', opId: newId(), taskId, parentId }));

  const move = (step: -1 | 1) => {
    if (current === undefined) return;
    if (view.sort !== 'manual') {
      status.say({ tone: 'info', text: 'this view sorts itself: moving needs a manual view' });
      return;
    }
    const after = moveAfter(view.items, String(current.id), step);
    if (after === undefined) return;
    void write((newId) => ({
      kind: 'move',
      opId: newId(),
      taskId: String(current.id),
      view: view.key,
      after,
    }));
    setAt((i) => Math.max(0, i + step));
  };

  useInput(
    (input, key) => {
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'j' || key.downArrow) {
        setAt((i) => Math.min(rows.length - 1, i + 1));
      } else if (input === 'k' || key.upArrow) {
        setAt((i) => Math.max(0, i - 1));
      } else if (input === 'o') {
        setAdding({});
      } else if (row === undefined) {
        return;
      } else if (input === 'O') {
        const parentId =
          row.depth === 0 ? String(row.item.id) : String(row.item.parentId);
        setAdding({ parentId });
      } else if (input === 'h' || key.leftArrow) {
        if (row.depth === 0 && row.children > 0) fold(String(row.item.id), true);
      } else if (input === 'l' || key.rightArrow) {
        fold(String(row.item.id), false);
      } else if (input === 'J' || (key.meta && key.downArrow)) {
        move(1);
      } else if (input === 'K' || (key.meta && key.upArrow)) {
        move(-1);
      } else if (key.tab && key.shift) {
        if (typeof row.item.parentId === 'string') {
          reparent(String(row.item.id), null);
        }
      } else if (key.tab) {
        const target = indentTarget(rows, at);
        if (target === null) {
          status.say({ tone: 'info', text: 'nothing above to indent under' });
        } else {
          reparent(String(row.item.id), target);
        }
      }
    },
    { isActive: active && adding === null && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {rows.length === 0 ? <Text dimColor>nothing here</Text> : null}
      {rows.map((r, i) => {
        const id = String(r.item.id);
        const glyph =
          r.depth === 1 ? '    ' : r.children === 0 ? '  ' : r.folded ? '▸ ' : '▾ ';
        const orphan =
          r.depth === 0 && r.item.parentTitle !== null ? `${r.item.parentTitle} › ` : '';
        return (
          <Box key={id} justifyContent="space-between">
            <Text inverse={active && i === at}>
              {glyph}
              {r.item.closed ? '✓ ' : ''}
              {orphan}
              {String(r.item.title)}
              {r.folded ? <Text dimColor>{`  +${r.children}`}</Text> : null}
            </Text>
            <Text dimColor>
              {labels(r.item)} {bar(r.item)}
            </Text>
          </Box>
        );
      })}
      {keys.overlay}
      {adding === null ? null : (
        <LineInput
          label={adding.parentId === undefined ? 'new:' : 'new subtask:'}
          initial=""
          onCancel={() => setAdding(null)}
          onSubmit={(text) => {
            const { parentId } = adding;
            setAdding(null);
            void write((newId) => ({
              kind: 'add',
              opId: newId(),
              id: newId(),
              text,
              ...(parentId === undefined ? {} : { parentId }),
            }));
          }}
        />
      )}
    </Box>
  );
}
```

`Shift-Tab` arrives as `key.tab && key.shift` in Ink; some terminals send it
as `\u001b[Z` without setting `shift`. If the render test's `KEY.shiftTab`
does not set it, also treat `input === '\u001b[Z'` as Shift-Tab.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS, every TUI spec (the app spec included: the list layout is
now the outline).

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/outline.tsx apps/tui/src/outline.spec.tsx
git commit -m "feat(tui): show the list layout as an outline"
```

---

### Task 3: By hand

- [ ] **Step 1: Run it**

`pnpm -w exec turbo run build --filter=@todoer/tui...`, then with a backend
and `todoer login`: `node apps/tui/dist/main.js`. Fold, indent, outdent,
move, add a subtask. In another shell `todoer list` shows the same nesting.
Note `Alt-↑`/`Alt-↓` and `Shift-Tab` behaviour in the terminal you use in
the task spec (design Risks: terminal differences).

---

### Task 4: Documents, gates, PR

- [ ] **Step 1: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/tui... && pnpm lint`
Expected: green.

- [ ] **Step 2: Close the task spec, changelog, PR**

Tick, `Status: done`, `Completed`, `Result`; `git add`; `git mv` to
`specs/tasks/done/`.

`dnote add todoer -c "2026-10-03 · The TUI's list layout is an outline: nested subtasks, folding, indent and outdent, moving among siblings."`

```bash
git add -A
git commit -m "docs: close the TUI outline task"
git push -u origin feat/tui-outline
gh pr create --title "feat(tui): show the list layout as an outline" --body "…"
```
