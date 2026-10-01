# Plan V1: Views and statuses in the CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `todoer list --view <name>` applies a synced view's filter and sort,
`todoer views` lists the views, `list` shows each task's status, `done`/`undo`
keep `statusId` aligned with completion, and the duplicate-name merge folds
statuses and rewrites the view filters that name a merged-away row.

**Architecture:** everything rides what plan V2 shipped. The CLI reads `status`
and `view` rows from its generic replica through `overlay`, evaluates filters
with `matches` and places tasks with `displayStatus` from `@todoer/specs`. Two
small helpers join `@todoer/specs` so every client shares them: the completing
and first status, and `replaceIds` for rewriting a filter. No contract change,
no server change.

**Tech Stack:** TypeScript, `node:sqlite`, Vitest. No new dependencies.

**Spec:** [`docs/specs/2026-10-01-views-design.md`](../specs/2026-10-01-views-design.md)
— Q9, Q10, Q12, Q15 and the departures of plan V2 at its end. Plan V2:
[`docs/plans/2026-10-01-plan-v2-views-server.md`](2026-10-01-plan-v2-views-server.md).
Task spec:
[`specs/tasks/done/T-2026-10-01-views-cli.md`](../../specs/tasks/done/T-2026-10-01-views-cli.md).

## Where this plan departs from the design doc

Task 5 records them in the design doc.

1. **The CLI seeds statuses only when `done` needs one.** Q9 says a client
   that finds no statuses creates `Inbox`, `Doing`, `Done`. The CLI is an
   automation client (ADR 0015); seeding on every first sync would write three
   rows for a caller that never uses a board. `done` is the one command that
   needs a status (the completing one), so it seeds when the user has no live
   status, in the same batch as the mark.
2. **`undo` clears `statusId`** rather than writing the first status's id.
   Null already means "the first status" (Q9, plan V2 departure 3), and it
   stays right when the user reorders columns.
3. **`skip` leaves `statusId` alone.** The design names only `done` and
   `undo`; a skipped occurrence is shown by the occurrence rule anyway.
4. **Sort by priority puts 4 first, then 3, 2, 1, and 0 (none) last.** The
   domain design says only "0 means none"; quick-add's `p4` is the strongest
   marker a user can type.
5. **A recurring task is filtered at its current occurrence:** its
   `scheduledOn` for the filter is the date `list` shows; its `dueOn` is the
   task's own field.
6. **The merge rewrites view filters.** When a tag, project or status is
   folded into another (the #362 merge, now extended to statuses), each live
   view whose filter names the loser gets one `set filter` with the winner's
   id, so a merge never silently drops rows from a view.

## Global Constraints

- **Statuses:** a live status has `deletedAt === null`; seeded statuses are
  `Inbox` (`rank: 'a0'`), `Doing` (`'a1'`), `Done` (`'a2'`,
  `completing: true`); names compare by `nameKey`.
- **Views:** a live view has `deletedAt === null`; `--view <name>` matches by
  `nameKey`, the lowest id among duplicates; layout is ignored (Q12).
- **Sort keys:** `manual` → `rank` (code-unit order) then id; `priority` →
  4, 3, 2, 1, 0 then rank, id; `due` / `scheduled` → ascending date, tasks
  without one last, then rank, id. Without `--view`, `list` keeps its order.
- **Today:** the CLI's local date (`localDate(deps.now())`), passed to
  `matches`.
- **Exit codes and envelope** unchanged: usage errors exit 2, refusals 1, an
  unreachable server 5; `--json` prints `{ data, synced, outbox }`.
- **Tests:** `pnpm --filter @todoer/cli test` (TZ=UTC via its vitest config);
  specs `pnpm --filter @todoer/specs test`.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; `pnpm format` first; never commit to `main`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **A view naming a tag that was merged away** keeps showing the tasks that
   carry the winner, after the merge's next command (Task 2).
2. **`done` on an instance with no statuses** seeds exactly one set, even when
   two `done`s run before the first sync answers (the second sees the queued
   creates through the overlay) (Task 3).
3. **`list --view` with an unknown name, or with no views at all,** exits 2
   with a message naming the view; it never prints every task as if
   unfiltered (Task 4).
4. **A task whose status was deleted** shows in the first non-completing
   status in `list` (Task 3).
5. **Two devices seeding offline** end with one set after the merge, tasks
   moved to the winners (Task 2).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] Write `specs/tasks/active/T-2026-10-01-views-cli.md` (FR-001…FR-007,
      steps T001–T005). Commit `docs(plans): plan views and statuses in the
      CLI` on branch `feat/views-cli`.

---

### Task 1: Shared status helpers and filter rewriting

Implements FR-001 (T001).

**Files:**

- Modify: `packages/specs/src/status.ts`, `status.spec.ts`,
  `packages/specs/src/filter.ts`, `filter.spec.ts`

**Interfaces:**

- Produces: `completingStatus(statuses: readonly StatusRow[]): string | undefined`
  (the lowest id among completing ones); `firstStatus(statuses: readonly StatusRow[]): string | null`
  (first non-completing by rank then id, else the first, else null);
  `replaceIds(filter: Filter, ids: ReadonlyMap<string, string>): Filter`
  (returns the same object when nothing changes).

- [ ] **Step 1: Tests** — `status.spec.ts`:

```ts
describe('completingStatus and firstStatus', () => {
  it('agree with displayStatus on every vector', () => {
    for (const c of vectors.cases) {
      const statuses = c.statuses ?? vectors.seed;
      if (c.closed && completingStatus(statuses) !== undefined) {
        expect(displayStatus(null, statuses, true)).toBe(
          completingStatus(statuses),
        );
      }
      expect(displayStatus(null, statuses, false)).toBe(firstStatus(statuses));
    }
  });
  it('has no completing status in a set without one', () => {
    expect(
      completingStatus([{ id: 'x', rank: 'a0', completing: false }]),
    ).toBeUndefined();
  });
});
```

  `filter.spec.ts`:

```ts
describe('replaceIds', () => {
  const A = '018f0000-0000-7000-8000-00000000000a';
  const B = '018f0000-0000-7000-8000-00000000000b';
  const ids = new Map([[A, B]]);
  it('rewrites tag, project and status leaves at any depth', () => {
    expect(
      replaceIds(
        { and: [{ tag: A }, { not: { or: [{ project: A }, { status: A }] } }] },
        ids,
      ),
    ).toEqual({
      and: [{ tag: B }, { not: { or: [{ project: B }, { status: B }] } }],
    });
  });
  it('returns the same object when nothing names a replaced id', () => {
    const filter = { and: [{ tag: B }, { project: null }, { recurring: true }] };
    expect(replaceIds(filter, ids)).toBe(filter);
  });
});
```

- [ ] **Step 2:** run — FAIL (exports missing).
- [ ] **Step 3: Implement** — in `status.ts` extract from `displayStatus`:

```ts
/** The completing status: with several (merged seed sets), the lowest id. */
export function completingStatus(
  statuses: readonly StatusRow[],
): string | undefined {
  return statuses
    .filter((s) => s.completing)
    .map((s) => s.id)
    .sort()[0];
}

/** Where a task with no status goes: the first non-completing status by
 *  rank, or the first at all when every status is completing. */
export function firstStatus(statuses: readonly StatusRow[]): string | null {
  const ordered = [...statuses].sort(byRankThenId);
  return (ordered.find((s) => !s.completing) ?? ordered[0])?.id ?? null;
}
```

  and rewrite `displayStatus` on top of them (behaviour unchanged; all
  existing vectors stay green). In `filter.ts`:

```ts
/**
 * `filter` with every tag, project and status id found in `ids` replaced by
 * its value — how a client keeps a view pointing at the row a duplicate was
 * folded into. The same object comes back when nothing changes, so a caller
 * can tell whether a write is needed.
 */
export function replaceIds(
  filter: Filter,
  ids: ReadonlyMap<string, string>,
): Filter {
  if ('and' in filter || 'or' in filter) {
    const key = 'and' in filter ? 'and' : 'or';
    const children = 'and' in filter ? filter.and : filter.or;
    const next = children.map((child) => replaceIds(child, ids));
    return next.every((child, i) => child === children[i])
      ? filter
      : ({ [key]: next } as Filter);
  }
  if ('not' in filter) {
    const next = replaceIds(filter.not, ids);
    return next === filter.not ? filter : { not: next };
  }
  for (const key of ['tag', 'project', 'status'] as const) {
    if (key in filter) {
      const id = (filter as Record<string, unknown>)[key];
      const to = typeof id === 'string' ? ids.get(id) : undefined;
      return to === undefined ? filter : ({ [key]: to } as Filter);
    }
  }
  return filter;
}
```

- [ ] **Step 4:** PASS; typecheck, lint.
- [ ] **Step 5: Mutation:** `replaceIds` skips `not` → the depth test goes red.
- [ ] **Step 6: Commit** `feat(specs): share the completing and first status,
      and rewrite filter ids` — body: V1's done/undo and merge need them, and
      GUI clients will too. Tick T001.

---

### Task 2: Merge statuses, and keep views pointing at the winners

Implements FR-002 (T002). Departure 6.

**Files:** `apps/cli/src/merge.ts`, `merge.spec.ts`, `apps/cli/src/labels.ts`,
`apps/cli/src/run.ts` (the `planMerge` call), `run.spec.ts`.

**Interfaces:**

- Consumes: `replaceIds`, `filterProblem` (Task 1, plan V2).
- Produces: `type Replica = { tasks; projects; tags; links; statuses; views }`
  (renamed from `View`, which now means a view row); `liveStatuses(rows)` and
  `liveViews(rows)` in `labels.ts`.

- [ ] **Step 1: Tests** — `merge.spec.ts`, in the file's style:
  - two live, server-confirmed statuses named `Doing` and `doing` → the
    higher id's live tasks get `set statusId` to the winner, then the loser
    is deleted with its `baseVersion`; `merged` contains `Doing (2)`;
  - a late status tombstone (a live task points at a confirmed tombstone
    whose name a live status shares) → the task moves to the live winner;
  - a live view whose filter names a losing tag in a nested `not` → one
    `set filter` op with the winner's id, after the tag's link ops and before
    its delete; a view that names no loser gets no op; a tombstoned view gets
    no op;
  - a view naming two losers (a tag and a project) gets **one** `set filter`
    with both replaced;
  - a view whose rewritten filter would fail `filterProblem` (it cannot, but
    guard it) is left alone — assert by giving `planMerge` a view row whose
    stored filter is already invalid: no op, no throw.
- [ ] **Step 2: Run test (run.spec)** — after a pull that brings a duplicate
      tag and a view naming the loser, the next command sends the delete and
      the `set filter`; then `list --view` (Task 4 adds it — here assert on
      `store.pending()` only).
- [ ] **Step 3:** run — FAIL.
- [ ] **Step 4: Implement** — `labels.ts`:

```ts
/** Statuses and views in play: not deleted. */
export function liveStatuses(rows: Row[]): Row[] {
  return rows.filter((row) => row.deletedAt === null);
}
export const liveViews = liveStatuses;
```

  `merge.ts`: rename `View` → `Replica` and add `statuses: Row[]; views: Row[]`.
  Inside `planMerge` keep a `replaced = new Map<string, string>()` and record
  `loser.id → keep.id` (and `tomb.id → keep.id`) wherever a tag, project or
  status loses. Add `moveStatus(from, to)` beside `moveTasks` (same shape,
  field `statusId`), a duplicates loop over `liveStatuses(replica.statuses)`
  and a `lateTombstones` loop for statuses. After every loop, once:

```ts
  // A view naming a row that just lost keeps pointing at the winner
  // (plan V1, departure 6). One write per view, whatever it names.
  for (const view of [...liveViews(replica.views)].sort(compareIds)) {
    if (filterProblem(view.filter) !== null) continue;
    const next = replaceIds(view.filter as Filter, replaced);
    if (next === view.filter) continue;
    ops.push({
      opId: newId(),
      kind: 'set',
      table: 'view',
      id: String(view.id),
      field: 'filter',
      value: next,
      ts,
    });
  }
```

  Add `statuses` and `views` (both through `overlay`) to the `planMerge` call
  in `run.ts` via two new readers beside `tagRows`:

```ts
function statusRows(store: Store): Row[] {
  return overlay('status', store.rows('status'), store.pending());
}

function viewRows(store: Store): Row[] {
  return overlay('view', store.rows('view'), store.pending());
}
```

  Update `planMerge`'s doc comment (statuses, views).
- [ ] **Step 5:** PASS (all CLI tests); typecheck, lint.
- [ ] **Step 6: Mutations:** drop the view loop → the view tests go red; drop
      `replaced.set` for statuses → the two-loser or status test goes red.
- [ ] **Step 7: Commit** `feat(cli): merge duplicate statuses and keep views on
      the winners` — body: Q9's seeded sets fold like tags; a merge must not
      silently drop rows from a view. Tick T002.

---

### Task 3: Statuses in `list`, and `done`/`undo`

Implements FR-003, FR-004 (T003). Departures 1, 2, 3.

**Files:** `apps/cli/src/run.ts`, `run.spec.ts`.

**Interfaces:**

- Consumes: `displayStatus`, `completingStatus`, `firstStatus` (Task 1),
  `statusRows`, `liveStatuses` (Task 2).

- [ ] **Step 1: Tests** (`run.spec.ts`, `describe('statuses')`):
  - `list` with no statuses prints the old line shape (no status column) and
    `--json` rows carry `status: null`;
  - with statuses `Inbox`/`Doing`/`Done` in the replica, a task with
    `statusId` of Doing prints `…  Doing` as the last column; `--json` has
    `status: 'Doing'` and `statusId` unchanged; a task with no `statusId`
    or a deleted one shows `Inbox`; a task with `statusId` of Done (open)
    shows `Inbox`;
  - `done` on a one-off task with no statuses queues, in one batch: three
    status creates (names, ranks, `completing` as in Global Constraints),
    the `task_occurrence` create, and `set statusId` to the new `Done` id;
  - a second `done` (another task) before any sync answers seeds nothing new
    (the overlay shows the queued statuses) and sets `statusId` to the same
    `Done` id;
  - `done` with statuses present and the task already at the completing
    status sends no `set statusId`;
  - `undo` sends `set statusId` to `null` when the task has one, nothing
    otherwise; `skip` never sends a `statusId` op.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement.**
  - `due(…)`: add `status: string | null` to `Due`, computed with
    `displayStatus(task.statusId ?? null, statusFacts, false)` where
    `statusFacts` maps `liveStatuses(statusRows(store))` to `{ id, rank, completing }`,
    and the name looked up from that id (null when there are no statuses).
  - `list` human line: append `row.status` as the last column when non-null.
  - In the mark branch, build the ops list: the occurrence op as today, plus

```ts
/**
 * The statusId writes that keep a board aligned with a mark (views design,
 * Q7): done moves the task to the completing status, seeding Inbox, Doing,
 * Done first when the user has none (plan V1, departure 1); undo clears it
 * (departure 2); skip leaves it (departure 3).
 */
function statusOps(
  command: Mark,
  task: Row,
  statuses: Row[],
  newId: () => string,
  ts: string,
): Op[] {
  if (command === 'skip') return [];
  if (command === 'undo') {
    return task.statusId === null || task.statusId === undefined
      ? []
      : [setTask(task, 'statusId', null, newId, ts)];
  }
  const live = liveStatuses(statuses);
  const seeded: OpCreate[] =
    live.length > 0
      ? []
      : [
          { name: 'Inbox', rank: 'a0', completing: false },
          { name: 'Doing', rank: 'a1', completing: false },
          { name: 'Done', rank: 'a2', completing: true },
        ].map((fields) => ({
          opId: newId(),
          kind: 'create',
          table: 'status',
          id: newId(),
          fields,
          ts,
        }));
  const facts = [
    ...live,
    ...seeded.map((op) => ({ id: op.id, ...op.fields })),
  ].map((s) => ({
    id: String(s.id),
    rank: String(s.rank),
    completing: s.completing === true,
  }));
  const target = completingStatus(facts);
  if (target === undefined || task.statusId === target) return seeded;
  return [...seeded, setTask(task, 'statusId', target, newId, ts)];
}
```

    with a small `setTask(task, field, value, newId, ts): OpSet` helper, and
    `submit(store, deps.send, [...statusOps(...), op], command)` — statuses
    first so the server knows the status before the task points at it.
- [ ] **Step 4:** PASS; typecheck, lint.
- [ ] **Step 5: Mutations:** seed even when statuses exist → the "seeds
      nothing new" test goes red; `undo` writes the first status's id → the
      undo test goes red.
- [ ] **Step 6: Commit** `feat(cli): show statuses and keep them aligned with
      done and undo` — body: Q7 and Q15; the CLI seeds only when done needs a
      status (departure 1). Tick T003.

---

### Task 4: `todoer views` and `list --view`

Implements FR-005, FR-006 (T004). Departures 4, 5.

**Files:** `apps/cli/src/run.ts`, `run.spec.ts`, `apps/cli/src/occurrence.ts`
(drop its `addDays` for the one in `@todoer/specs`).

- [ ] **Step 1: Tests** (`describe('views')`, fixtures of status, view, tag,
      project rows through `mergeChanges`):
  - `views` prints live views in rank-then-id order as
    `name  layout  sort`; `--json` prints the rows; tombstoned views are
    left out; no views → empty output, exit 0;
  - `list --view Work` (filter `{ project: <work id> }`) prints only tasks in
    that project; name matching ignores case; `--view` combines with `@tag`
    (AND);
  - `list --view` without a name → exit 2 (`UsageError`); `list --view
    Nope` → `UsageError` naming `Nope`;
  - sort `priority` orders 4, 3, 1, 0; `due` orders by date with dateless
    tasks last; `manual` orders by `rank`; ties by id;
  - a view on `{ status: <Doing id> }` lists a task whose `statusId` is Doing
    and not one with no status (shown in Inbox);
  - a view on `{ scheduled: { from: 0, to: 0 } }` lists a daily recurring
    task (current occurrence today) and a one-off scheduled today, and not
    one scheduled tomorrow;
  - a view whose filter is invalid in the replica (written by a broken
    client) → `RefusalError` naming the view and the problem.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement.**
  - `views`: flush (like `list`), then `liveViews(viewRows(store))` sorted by
    `rank` then id; human `name  layout  sort`.
  - `list`: `takeOption(rest, '--view')` first; an empty value → `UsageError('--view needs a view name')`.
    Find the view with `winner` over live views whose `nameKey(name)`
    matches; none → `UsageError(\`no view named ${name}\`)`. Invalid filter
    → `RefusalError(\`view ${name} has an invalid filter: ${problem}\`)`.
  - For each `Due` row build a `FilterTask`: `tagIds` = ids of attached
    links to live tags, `projectId` = `task.projectId ?? null`, `statusId` =
    the displayed status id (Task 3), `priority`, `scheduledOn` = the current
    occurrence for a recurring task, else `task.scheduledOn ?? null`,
    `dueOn` = `task.dueOn ?? null`, `recurring` = recurrence non-null. Keep
    rows where `matches(filter, facts, today)`.
  - Sort per Global Constraints with one comparator keyed by `view.sort`.
  - `occurrence.ts`: replace its `addDays` with
    `export { addDays } from '@todoer/specs';` (same contract) and run its
    tests.
- [ ] **Step 4:** PASS; typecheck, lint.
- [ ] **Step 5: Mutations:** ignore the view filter → the project test goes
      red; reverse the priority comparator → the sort test goes red.
- [ ] **Step 6: Commit** `feat(cli): list a view, and list the views` — body:
      Q12; layout is the GUI's, the filter and sort are shared. Tick T004.

---

### Task 5: End to end, HELP, README, design

Implements FR-007 (T005).

**Files:** `scripts/walking-skeleton.sh`, `apps/cli/src/usage.ts`,
`usage.spec.ts`, `README.md`, `docs/specs/2026-10-01-views-design.md`.

- [ ] **Step 1: Skeleton** — extend the plan V2 block: add a third op
      creating a view `Recurring` (`layout: list`, `sort: manual`, `rank: a2`,
      filter `{"recurring":true}`); then

```sh
VIEWS=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js views)
printf '%s' "$VIEWS" | grep -qF 'Recurring' ||
  { echo "FAIL: todoer views did not list the view: $VIEWS" >&2; exit 1; }
ONLY=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list --view recurring)
printf '%s' "$ONLY" | grep -qF "$RTITLE" ||
  { echo "FAIL: list --view did not show the recurring task: $ONLY" >&2; exit 1; }
if printf '%s' "$ONLY" | grep -qF "$TITLE"; then
  echo "FAIL: list --view showed a one-off task: $ONLY" >&2; exit 1
fi
```

  (the `APPLIED` count becomes 3). Run against a fresh `todoer_e2e` backend
  twice, `sh -n`.
- [ ] **Step 2: HELP** — `views`, `list --view <name>` (filter and sort of a
      synced view; layout ignored), the status column in `list` and `--json`'s
      `status`, what `done`/`undo` do to the status, the one-time seeding of
      `Inbox`/`Doing`/`Done`. Keep `usage.spec.ts` green, adjusting its phrase
      checks if needed.
- [ ] **Step 3: README** — the same in the CLI section, briefly.
- [ ] **Step 4: Design** — add "Departures in plan V1" (this plan's six) after
      plan V2's.
- [ ] **Step 5: Gates** —
      `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test && pnpm lint`.
- [ ] **Step 6: Commit** `docs: describe views and statuses in the CLI, and
      prove them end to end`. Tick T005.
