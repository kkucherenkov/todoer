# Plan T1b: subtask progress on every listed task

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `Item` a view lists carries its subtask progress,
`{ done, total }` over its live subtasks, so a client shows "2/5" without
the closed subtasks being in the view.

**Architecture:** A view of open tasks does not list closed subtasks, so a
client cannot count them from the view. `itemOf` in `operations.ts` gains a
second lookup built once per listing, as `titlesOf` is: each parent's live
subtasks, closed or not at the parent's current occurrence, the same rule
`taskDetails` already uses for its checklist (ADR 0009).

**Tech Stack:** TypeScript 5.6, Vitest 5.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Routine choices: the
outline); `docs/proposals/2026-10-03-web-ux-redesign.md` (hierarchy: "the
parent shows the number of finished children and the total").

## Global Constraints

- Additive: `Item` gains `subtasks: { done: number; total: number } | null`
  (null: no live subtasks). No existing field changes; the web compiles
  unchanged.
- "Closed" means exactly what `taskDetails`'s `subtasks[].closed` means:
  done or skipped at the parent's current occurrence; a recurring parent
  whose series ended counts none as done.
- One pass over tasks and marks per listing, not per item.
- Work on branch `feat/core-subtask-progress` in this plan's own worktree.

---

### Task 1: `subtasks` on `Item`

**Files:**

- Modify: `packages/client-core/src/operations.ts` (`Item`, `itemOf`, its two
  callers at the `selected` listing and in `taskDetails`)
- Test: `packages/client-core/src/operations.spec.ts`
- Create: `specs/tasks/active/T-2026-10-03-core-subtask-progress.md`

**Interfaces:**

- Produces: `Item['subtasks']: { done: number; total: number } | null`, and
  `TaskDetails` inherits it.

- [ ] **Step 1: Task spec**

From the template, with:

- **FR-001** every listed item carries `subtasks: { done, total }` over its
  live subtasks, or null when it has none
- **FR-002** `done` counts subtasks closed at the parent's current
  occurrence, the same as `taskDetails`
- **FR-003** tombstoned subtasks do not count
- Steps T001–T002 mirroring this plan's Tasks 1–2.

- [ ] **Step 2: Failing tests**

Append to `packages/client-core/src/operations.spec.ts`:

```ts
describe('subtask progress', () => {
  function family() {
    const store = openStore(':memory:');
    put(store, 'task', task('p'));
    put(store, 'task', task('s1', { parentId: 'p' }));
    put(store, 'task', task('s2', { parentId: 'p' }));
    put(store, 'task', task('s3', { parentId: 'p', deletedAt: '2026-10-01' }));
    put(store, 'task', task('lone'));
    return store;
  }
  const progress = (store: Store, id: string) =>
    viewTasks(store, TODAY, ALL_OPEN).find((i) => i.id === id)?.subtasks;

  it('counts live subtasks and those closed', () => {
    const store = family();
    expect(progress(store, 'p')).toEqual({ done: 0, total: 2 });
    closeAt(store, 's1', TODAY);
    expect(progress(store, 'p')).toEqual({ done: 1, total: 2 });
  });

  it('is null without live subtasks', () => {
    expect(progress(family(), 'lone')).toBeNull();
  });

  it('agrees with taskDetails’ checklist', () => {
    const store = family();
    closeAt(store, 's2', TODAY);
    const checklist = taskDetails(store, TODAY, 'p')?.subtasks ?? [];
    expect({
      done: checklist.filter((s) => s.closed).length,
      total: checklist.length,
    }).toEqual(progress(store, 'p'));
    expect(progress(store, 'p')).toEqual({ done: 1, total: 2 });
  });
});
```

(`closeAt` writes a one-off `task_occurrence` with `occurrence: null`: the
current occurrence of a subtask under a one-off parent.)

Run: `pnpm --filter @todoer/client-core exec vitest run src/operations.spec.ts -t "subtask progress"`
Expected: FAIL, `subtasks` is undefined.

- [ ] **Step 3: Implement**

In `packages/client-core/src/operations.ts`, extend `Item`:

```ts
  /** Live subtasks, and how many are closed at this task's current
   *  occurrence; null without any (views count them though a view of open
   *  tasks lists none of the closed). */
  subtasks: { done: number; total: number } | null;
```

Add next to `titlesOf`:

```ts
/** Each parent's live subtasks counted once per listing: closed is done or
 *  skipped at the parent's current occurrence (ADR 0009), as taskDetails'
 *  checklist reads it; a series that ended has none closed. */
function progressOf(store: Store) {
  const kids = new Map<string, Row[]>();
  for (const t of liveTasks(tasks(store))) {
    if (typeof t.parentId !== 'string') continue;
    kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
  }
  const marks = occurrences(store);
  return (row: Row): Item['subtasks'] => {
    const mine = kids.get(String(row.id));
    if (mine === undefined) return null;
    const occurrence =
      typeof row.occurrence === 'string' ? row.occurrence : null;
    const ended = typeof row.rrule === 'string' && occurrence === null;
    const done = ended
      ? 0
      : mine.filter((t) => isClosed(stateOf(marks, String(t.id))(occurrence)))
          .length;
    return { done, total: mine.length };
  };
}
```

Change `itemOf` to take both lookups:

```ts
function itemOf(
  titles: Map<string, string>,
  progress: (row: Row) => Item['subtasks'],
) {
  return ({ row, facts, closed }: Listed): Item => ({
    ...row,
    column: facts.statusId,
    closed,
    parentTitle:
      typeof row.parentId === 'string'
        ? (titles.get(row.parentId) ?? null)
        : null,
    subtasks: progress(row),
  });
}
```

and its two callers: `.map(itemOf(titlesOf(store), progressOf(store)))` and
`...itemOf(titlesOf(store), progressOf(store))(found)`.

`isClosed` and `stateOf` are declared further up the file than `itemOf`
(`isClosed` near `editTask`); if the order makes TypeScript or ESLint
complain about use before definition, move `progressOf` below them.

Run: `pnpm --filter @todoer/client-core exec vitest run`
Expected: PASS, the whole package.

- [ ] **Step 4: Commit**

```bash
git add packages/client-core/src specs/tasks/active
git commit -m "feat(client-core): count subtask progress on every listed task"
```

---

### Task 2: Gates and PR

- [ ] **Step 1: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter=@todoer/client-core... --filter=@todoer/web... --filter=@todoer/cli... && pnpm lint`
Expected: green; the web and CLI compile with the extra field.

- [ ] **Step 2: Close the task spec, changelog, PR**

Tick, `Status: done`, `Completed`, `Result`; `git add`; `git mv` to
`specs/tasks/done/`.

`dnote add todoer -c "2026-10-03 · Every listed task carries its subtask progress (done/total at its current occurrence), for the TUI's outline and the web redesign."`

```bash
git add -A
git commit -m "docs: close the subtask progress task"
git push -u origin feat/core-subtask-progress
gh pr create --title "feat(client-core): count subtask progress on every listed task" --body "…"
```
