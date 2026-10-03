# Plan T3d: the TUI's statuses screen

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `S` opens the statuses (the board's columns): add, rename,
reorder, mark completing, delete.

**Architecture:** `statuses.tsx` exports `StatusesScreen`, which the shell's
`SCREENS` already reads. It lists `catalog.statuses` (rank order) and maps
keys to the engine's `saveStatus`, `setCompleting` and `deleteStatus`
writes. Reordering uses an `after` anchor, as tasks do.

**Tech Stack:** Ink 8, React 19.3, Vitest 5, `ink-testing-library`.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Q7, Routine choices:
the statuses screen); the views design, Q8 (deleting a status moves its
tasks to the first status, in the same batch — the core does that).

## Global Constraints

- Requires plan T2 (the shell) merged. Rebase on `origin/main` first.
- This plan owns `apps/tui/src/statuses.tsx` (replace the stub wholesale)
  and `apps/tui/src/statuses.spec.tsx`. Edit no other source file; the
  outline, board and details plans run in parallel.
- Deleting asks `y/n` on the status line and names how many tasks move
  (`catalog.statuses[].tasks`).
- Work on branch `feat/tui-statuses` in this plan's own worktree.

---

### Task 1: The statuses screen

**Files:**

- Replace: `apps/tui/src/statuses.tsx`
- Create: `apps/tui/src/statuses.spec.tsx`
- Create: `specs/tasks/active/T-2026-10-03-tui-statuses.md`

**Interfaces:**

- Consumes: `useTui`, `useTopic`, `useWrite`, `LineInput`, `confirmKeys`,
  `renderTui`, `fakeServer`, `KEY`; the engine writes
  `{ kind: 'saveStatus'; opId; id; name?; after? }`,
  `{ kind: 'setCompleting'; opId; id }`, `{ kind: 'deleteStatus'; opId; id }`.
- Produces: `StatusesScreen: (p: { close(): void }) => ReactNode`.

- [ ] **Step 1: Task spec**

Create `specs/tasks/active/T-2026-10-03-tui-statuses.md` from the template:

- **FR-001** `S` lists the statuses in rank order with the completing one
  marked and each one's task count; Esc closes
- **FR-002** `a` adds a status after the cursor
- **FR-003** Enter renames
- **FR-004** `J`/`K` reorder
- **FR-005** `c` marks the completing status
- **FR-006** `dd` then `y` deletes, naming how many tasks move
- Steps T001–T003 mirroring this plan's Tasks 1–3.

- [ ] **Step 2: Failing tests**

`apps/tui/src/statuses.spec.tsx`:

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

async function statuses() {
  const t = await renderTui(<App />, {
    server: fakeServer([
      status('todo', 'To do', 'a0'),
      status('doing', 'Doing', 'a1'),
      status('done', 'Done', 'a2', true),
    ]),
  });
  cleanup = t.cleanup;
  await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
  await t.press('S');
  return t;
}
const live = (t: Awaited<ReturnType<typeof statuses>>) =>
  t.store
    .rows('status')
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => String(a.rank).localeCompare(String(b.rank)));

describe('StatusesScreen', () => {
  it('lists the statuses in rank order and closes with Esc', async () => {
    const t = await statuses();
    const frame = t.lastFrame() ?? '';
    expect(frame.indexOf('To do')).toBeLessThan(frame.indexOf('Doing'));
    expect(frame).toMatch(/Done.*✓/);
    await t.press(KEY.escape);
    expect(t.lastFrame()).not.toContain('Doing (');
  });

  it('adds a status after the cursor', async () => {
    const t = await statuses();
    await t.press('a', 'Review', KEY.enter);
    expect(live(t).map((s) => s.name)).toEqual(['To do', 'Review', 'Doing', 'Done']);
  });

  it('renames with Enter', async () => {
    const t = await statuses();
    await t.press('j', KEY.enter);
    // The input opens on "Doing"; clear it and type the new name.
    await t.press(...Array.from({ length: 5 }, () => '\u007f'), 'Working', KEY.enter);
    expect(live(t).map((s) => s.name)).toContain('Working');
  });

  it('moves a status down with J', async () => {
    const t = await statuses();
    await t.press('J');
    expect(live(t).map((s) => s.name)).toEqual(['Doing', 'To do', 'Done']);
  });

  it('marks completing with c', async () => {
    const t = await statuses();
    await t.press('j', 'c');
    expect(live(t).find((s) => s.name === 'Doing')?.completing).toBe(true);
  });

  it('deletes with dd y, and dd n keeps it', async () => {
    const t = await statuses();
    await t.press('j', 'd', 'd', 'n');
    expect(live(t)).toHaveLength(3);
    await t.press('d', 'd', 'y');
    expect(live(t).map((s) => s.name)).toEqual(['To do', 'Done']);
  });
});
```

(`completing` is the store's field per `catalog`; if the store row says it
differently, read `catalog(store).statuses` through
`t.topics.get('catalog')` instead. The `\u007f` is Backspace for
`ink-text-input`.)

Run: `pnpm --filter @todoer/tui exec vitest run src/statuses.spec.tsx`
Expected: FAIL (`S` says "statuses is not built yet").

- [ ] **Step 3: Implement**

`apps/tui/src/statuses.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { useTui } from './context.js';
import { useTopic } from './topics.js';
import { confirmKeys } from './ui/confirm.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

type Editing = null | { kind: 'add' } | { kind: 'rename'; id: string; name: string };

function Statuses({ close }: { close: () => void }) {
  const { topics, status } = useTui();
  const write = useWrite();
  const list = useTopic(topics, 'catalog')?.statuses ?? [];
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState(false);
  const pendingD = useRef(false);
  const k = Math.min(at, list.length - 1);
  const current = list[k];

  /** The anchor that moves `current` one place: after the status two above
   *  (or first), or after the next one. */
  const reorder = (step: -1 | 1) => {
    if (current === undefined) return;
    const target = step === -1 ? k - 1 : k + 1;
    if (target < 0 || target >= list.length) return;
    const after = step === -1 ? (list[k - 2]?.id ?? null) : (list[k + 1]?.id ?? null);
    void write((newId) => ({ kind: 'saveStatus', opId: newId(), id: current.id, after }));
    setAt(target);
  };

  useInput(
    (input, key) => {
      if (deleting) {
        setDeleting(false);
        status.clear();
        if (confirmKeys(input) === 'yes' && current !== undefined) {
          void write((newId) => ({ kind: 'deleteStatus', opId: newId(), id: current.id }));
          setAt((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (input === 'd') {
        if (!pendingD.current) {
          pendingD.current = true;
          return;
        }
        pendingD.current = false;
        if (current === undefined) return;
        setDeleting(true);
        status.say({
          tone: 'info',
          text: `delete "${current.name}"? its ${current.tasks} task(s) move to the first status · y/n`,
        });
        return;
      }
      pendingD.current = false;
      status.clear();
      if (key.escape || input === 'q') close();
      else if (input === 'j' || key.downArrow) setAt(Math.min(list.length - 1, k + 1));
      else if (input === 'k' || key.upArrow) setAt(Math.max(0, k - 1));
      else if (input === 'a') setEditing({ kind: 'add' });
      else if (current === undefined) return;
      else if (key.return) setEditing({ kind: 'rename', id: current.id, name: current.name });
      else if (input === 'J') reorder(1);
      else if (input === 'K') reorder(-1);
      else if (input === 'c') {
        void write((newId) => ({ kind: 'setCompleting', opId: newId(), id: current.id }));
      }
    },
    { isActive: editing === null },
  );

  return (
    <Box flexDirection="column">
      <Text bold>Statuses</Text>
      {list.length === 0 ? <Text dimColor>none yet · a to add</Text> : null}
      {list.map((s, i) => (
        <Text key={s.id} inverse={editing === null && i === k}>
          {s.name}
          {s.completing ? ' ✓' : ''} ({s.tasks})
        </Text>
      ))}
      {editing === null ? null : (
        <LineInput
          label={editing.kind === 'add' ? 'new status:' : 'rename:'}
          initial={editing.kind === 'add' ? '' : editing.name}
          onCancel={() => setEditing(null)}
          onSubmit={(name) => {
            const e = editing;
            setEditing(null);
            if (e.kind === 'rename') {
              void write((newId) => ({ kind: 'saveStatus', opId: newId(), id: e.id, name }));
              return;
            }
            const after = current?.id ?? null;
            void write((newId) => ({
              kind: 'saveStatus',
              opId: newId(),
              id: newId(),
              name,
              after,
            }));
            setAt(k + 1);
          }}
        />
      )}
      <Text dimColor>a add · Enter rename · J/K move · c completing · dd delete · Esc back</Text>
    </Box>
  );
}

export const StatusesScreen = (p: { close: () => void }) => <Statuses {...p} />;
```

Check the engine's `saveStatus` case (`packages/client-core/src/engine.ts`,
`apply`): a new status is told apart from a rename by its `id` not being a
known status, and `after: null` means "first". If a create needs a name
and refuses an `after` of `undefined`, the code above already passes both.

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/tui/src/statuses.tsx apps/tui/src/statuses.spec.tsx specs/tasks/active
git commit -m "feat(tui): manage statuses from a statuses screen"
```

---

### Task 2: By hand

- [ ] **Step 1: Run it**

Build and run; `S`; add, rename, reorder, set completing, delete one with
tasks in it; on a board view, the columns follow; `todoer statuses` (or the
CLI's equivalent) agrees. Note anything surprising in the task spec.

---

### Task 3: Gates and PR

- [ ] **Step 1: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/tui... && pnpm lint`
Expected: green.

- [ ] **Step 2: Close the task spec, changelog, PR**

Tick, `Status: done`, `Completed`, `Result`; `git add`; `git mv` to
`specs/tasks/done/`.

`dnote add todoer -c "2026-10-03 · The TUI manages statuses: add, rename, reorder, mark completing, delete with the tasks moving to the first status."`

```bash
git add -A
git commit -m "docs: close the TUI statuses task"
git push -u origin feat/tui-statuses
gh pr create --title "feat(tui): manage statuses from a statuses screen" --body "…"
```
