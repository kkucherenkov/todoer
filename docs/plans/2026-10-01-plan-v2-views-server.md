# Plan V2: Views, statuses and filters on the server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the sync contract gains the `status` and `view` tables and three task
fields (`statusId`, `originTaskId`, `originOccurrence`); `@todoer/specs`
gains the filter schema check, the filter evaluator and the board-column rule,
each pinned by shared vectors; the server stores, validates, prunes and purges
the new rows.

**Architecture:** both tables ride the existing generic sync path: a table
name in `TABLES`, its writable columns, its references, and a row rule in
`row-rules.ts`. The only new logic on the server is validation: a view's
filter must pass `filterProblem` from `@todoer/specs`, the same function every
client calls before writing one. Evaluation (`matches`) and the board rule
(`displayStatus`) live in `@todoer/specs` for the clients; the server never
evaluates a filter.

**Tech Stack:** NestJS 11, Prisma 6.19, PostgreSQL 18, Vitest. No new
dependencies.

**Spec:** [`docs/specs/2026-10-01-views-design.md`](../specs/2026-10-01-views-design.md)
— read all of it before Task 1. Task spec:
[`specs/tasks/done/T-2026-10-01-views-server.md`](../../specs/tasks/done/T-2026-10-01-views-server.md).
Plan V1 (the CLI) follows this one and is written after it lands.

## Where this plan departs from the design doc

Task 7 records them in the design doc.

1. **`{ "project": null }` matches tasks without a project.** The design lists
   `project` with an id only, which cannot express an "Inbox" view (no
   project) except by naming every project in a `not`.
2. **The evaluator takes facts, not rows:**
   `matches(filter, task: FilterTask, today)`. The design's
   `matches(filter, task, labels, today)` left `labels` undefined; `FilterTask`
   carries the tag ids, the project id, the *displayed* status id, priority,
   the two dates and whether the task recurs. The caller resolves them (live
   tag links, the status a board shows, a recurring task's current occurrence
   date), so the evaluator never needs the replica.
3. **The board rule is a shared function too:** `displayStatus(statusId,
   statuses, occurrenceClosed)` in `@todoer/specs`, with vectors — the design's
   Q7, Q8 and Q9 display rules decide what every client shows, so they get the
   same treatment as the evaluator. "The first status" means the first
   **non-completing** status by `rank` (then id); only when every status is
   completing is it the first status outright. Otherwise a task whose
   `statusId` is null would land in a completing column that ranks first.
4. **Filter limits beyond depth:** at most 256 nodes; a day offset within
   ±36 600 days (100 years); `priority` lists values 0–4 and is non-empty.
   `{ "and": [] }` matches every task and `{ "or": [] }` none;
   `{ "due": {} }` matches every task that has a due date.
5. **`originTaskId` has no foreign key.** The link is informational (design,
   Risks): a foreign key would either block pruning the original's tombstone
   while a copy lives, or null the copy's field behind the clients' backs. The
   server checks ownership on write, like every reference. `statusId` does get
   a foreign key; a status tombstone is pruned only once no task references
   it, as for projects.
6. **The server checks that `originTaskId` and `originOccurrence` are set
   together** — one without the other names no occurrence.

## Global Constraints

- **Tables:** `status` (`name`, `rank`, `color`, `completing`), `view`
  (`name`, `layout`, `filter`, `sort`, `rank`), each with the four protocol
  columns (`id`, `version`, `fieldTs`, `deletedAt`) and `seq` from
  `change_seq`.
- **Task fields:** `statusId` (uuid, nullable, references `status`),
  `originTaskId` (uuid, nullable, references `task`, no foreign key),
  `originOccurrence` (date `YYYY-MM-DD`, nullable).
- **Enums:** layout `list` | `kanban` | `calendar`; sort `manual` |
  `priority` | `due` | `scheduled`.
- **Filter:** inner `and` / `or` (arrays), `not` (one node); leaves `tag`,
  `status` (uuid), `project` (uuid or null), `priority` (non-empty list of
  integers 0–4), `scheduled` / `due` (`{ from?, to? }`, each an integer day
  offset or `YYYY-MM-DD`, inclusive), `recurring` (boolean); exactly one key
  per node; depth ≤ 8 (a lone leaf is depth 1); ≤ 256 nodes; offsets within
  ±36 600.
- **Spec first:** `openapi.yaml` before the backend;
  `pnpm spec:validate && pnpm spec:codegen && pnpm --filter @todoer/specs build`;
  generated code in its own commit.
- **Trap 6:** delete `DROP DEFAULT` on `seq` and `DROP SEQUENCE "change_seq"`
  from the generated migration; add `SET DEFAULT nextval('change_seq')` for
  each new table's `seq` by hand.
- **Tests:** backend
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm --filter @todoer/backend test`;
  specs `pnpm --filter @todoer/specs test`.
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**; `pnpm format` first; never commit to `main`.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **A hostile or runaway filter** (10 000 leaves in one `or`, depth 50, a
   string where a node belongs) is refused with a reason, never stored, and
   never makes the request 500. Tests in Tasks 1 and 5.
2. **A task whose status was deleted, or that never had one,** shows in the
   first non-completing status; a closed current occurrence shows in the
   completing status. Vectors in Task 2.
3. **Deleting an account that has statuses and views** succeeds and leaves
   nothing behind (Task 6).
4. **Pruning a status tombstone a live task still references** keeps it; once
   no task references it, it goes and raises the watermark (Task 6).
5. **Day offsets across month ends, year ends and 29 February** land on the
   right calendar day (vectors in Task 1).

---

### Task 0: Commit the plan and the task spec (controller)

- [ ] Write `specs/tasks/active/T-2026-10-01-views-server.md` from the
      template (FR-001…FR-008, steps T001–T007 citing them).
- [ ] Commit `docs(plans): plan views, statuses and filters on the server`
      with this plan and the task spec.

---

### Task 1: The filter — schema check, evaluator, vectors

Implements FR-001, FR-002 (T001). Departures 1, 2, 4.

**Files:**

- Modify: `packages/specs/src/dates.ts`, `packages/specs/src/dates.spec.ts`
- Create: `packages/specs/src/filter.ts`, `packages/specs/src/filter.spec.ts`,
  `packages/specs/vectors/filters.json`
- Modify: `packages/specs/src/index.ts`

**Interfaces:**

- Produces: `addDays(date: string, days: number): string`;
  `type Filter`, `type DateRange`, `type FilterTask`;
  `filterProblem(filter: unknown): string | null`;
  `matches(filter: Filter, task: FilterTask, today: string): boolean`;
  `FILTER_MAX_DEPTH = 8`, `FILTER_MAX_NODES = 256`.

- [ ] **Step 1: `addDays` test** in `dates.spec.ts`:

```ts
describe('addDays', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-10-01', 0, '2026-10-01'],
    ['2026-10-01', -365, '2025-10-01'],
  ])('%s %+d → %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});
```

- [ ] **Step 2: Vectors** — `packages/specs/vectors/filters.json`. Use these
      ids: tag A `018f0000-0000-7000-8000-00000000000a`, tag B
      `018f0000-0000-7000-8000-00000000000b`, project P
      `018f0000-0000-7000-8000-0000000000aa`, status S
      `018f0000-0000-7000-8000-0000000000cc`. `base` is the task every case
      starts from; a case's `task` overrides fields of it.

```json
{
  "source": "The filter of docs/specs/2026-10-01-views-design.md (Q6, Q16-Q18) and plan V2's departures 1, 2 and 4.",
  "today": "2026-10-01",
  "base": {
    "tagIds": [],
    "projectId": null,
    "statusId": null,
    "priority": 0,
    "scheduledOn": null,
    "dueOn": null,
    "recurring": false
  },
  "cases": [
    { "name": "empty and matches everything", "filter": { "and": [] }, "task": {}, "matches": true },
    { "name": "empty or matches nothing", "filter": { "or": [] }, "task": {}, "matches": false },
    { "name": "tag present", "filter": { "tag": "018f0000-0000-7000-8000-00000000000a" }, "task": { "tagIds": ["018f0000-0000-7000-8000-00000000000a"] }, "matches": true },
    { "name": "tag absent", "filter": { "tag": "018f0000-0000-7000-8000-00000000000a" }, "task": { "tagIds": ["018f0000-0000-7000-8000-00000000000b"] }, "matches": false },
    { "name": "and of two tags needs both", "filter": { "and": [{ "tag": "018f0000-0000-7000-8000-00000000000a" }, { "tag": "018f0000-0000-7000-8000-00000000000b" }] }, "task": { "tagIds": ["018f0000-0000-7000-8000-00000000000a"] }, "matches": false },
    { "name": "or of two tags needs one", "filter": { "or": [{ "tag": "018f0000-0000-7000-8000-00000000000a" }, { "tag": "018f0000-0000-7000-8000-00000000000b" }] }, "task": { "tagIds": ["018f0000-0000-7000-8000-00000000000b"] }, "matches": true },
    { "name": "not inverts", "filter": { "not": { "tag": "018f0000-0000-7000-8000-00000000000a" } }, "task": {}, "matches": true },
    { "name": "project by id", "filter": { "project": "018f0000-0000-7000-8000-0000000000aa" }, "task": { "projectId": "018f0000-0000-7000-8000-0000000000aa" }, "matches": true },
    { "name": "project null is no project", "filter": { "project": null }, "task": {}, "matches": true },
    { "name": "project null refuses a task in a project", "filter": { "project": null }, "task": { "projectId": "018f0000-0000-7000-8000-0000000000aa" }, "matches": false },
    { "name": "status by displayed id", "filter": { "status": "018f0000-0000-7000-8000-0000000000cc" }, "task": { "statusId": "018f0000-0000-7000-8000-0000000000cc" }, "matches": true },
    { "name": "priority in list", "filter": { "priority": [3, 4] }, "task": { "priority": 4 }, "matches": true },
    { "name": "priority not in list", "filter": { "priority": [3, 4] }, "task": { "priority": 0 }, "matches": false },
    { "name": "due today", "filter": { "due": { "from": 0, "to": 0 } }, "task": { "dueOn": "2026-10-01" }, "matches": true },
    { "name": "due tomorrow is not today", "filter": { "due": { "from": 0, "to": 0 } }, "task": { "dueOn": "2026-10-02" }, "matches": false },
    { "name": "overdue is before today", "filter": { "due": { "to": -1 } }, "task": { "dueOn": "2026-09-30" }, "matches": true },
    { "name": "overdue excludes today", "filter": { "due": { "to": -1 } }, "task": { "dueOn": "2026-10-01" }, "matches": false },
    { "name": "next 7 days includes the seventh", "filter": { "scheduled": { "from": 0, "to": 6 } }, "task": { "scheduledOn": "2026-10-07" }, "matches": true },
    { "name": "next 7 days excludes the eighth", "filter": { "scheduled": { "from": 0, "to": 6 } }, "task": { "scheduledOn": "2026-10-08" }, "matches": false },
    { "name": "offset crosses a month end", "filter": { "due": { "from": 30, "to": 30 } }, "task": { "dueOn": "2026-10-31" }, "matches": true },
    { "name": "offset crosses a year end", "filter": { "due": { "from": 92, "to": 92 } }, "task": { "dueOn": "2027-01-01" }, "matches": true },
    { "name": "absolute bounds", "filter": { "due": { "from": "2026-09-01", "to": "2026-09-30" } }, "task": { "dueOn": "2026-09-15" }, "matches": true },
    { "name": "mixed bounds", "filter": { "due": { "from": "2026-09-01", "to": 0 } }, "task": { "dueOn": "2026-10-02" }, "matches": false },
    { "name": "a date range never matches a missing date", "filter": { "due": { "to": 0 } }, "task": {}, "matches": false },
    { "name": "an empty range is has-a-date", "filter": { "due": {} }, "task": { "dueOn": "1999-01-01" }, "matches": true },
    { "name": "an empty range refuses no date", "filter": { "scheduled": {} }, "task": {}, "matches": false },
    { "name": "recurring", "filter": { "recurring": true }, "task": { "recurring": true }, "matches": true },
    { "name": "not recurring", "filter": { "recurring": false }, "task": { "recurring": true }, "matches": false },
    { "name": "work this week", "filter": { "and": [{ "project": "018f0000-0000-7000-8000-0000000000aa" }, { "scheduled": { "from": 0, "to": 6 } }, { "not": { "tag": "018f0000-0000-7000-8000-00000000000b" } }] }, "task": { "projectId": "018f0000-0000-7000-8000-0000000000aa", "scheduledOn": "2026-10-03", "tagIds": ["018f0000-0000-7000-8000-00000000000a"] }, "matches": true }
  ],
  "invalid": [
    { "name": "not an object", "filter": "x" },
    { "name": "null", "filter": null },
    { "name": "an array", "filter": [] },
    { "name": "two keys", "filter": { "tag": "018f0000-0000-7000-8000-00000000000a", "recurring": true } },
    { "name": "no keys", "filter": {} },
    { "name": "unknown key", "filter": { "title": "x" } },
    { "name": "and not an array", "filter": { "and": { "recurring": true } } },
    { "name": "not of an array", "filter": { "not": [] } },
    { "name": "tag not a uuid", "filter": { "tag": "@phone" } },
    { "name": "tag null", "filter": { "tag": null } },
    { "name": "status null", "filter": { "status": null } },
    { "name": "project a name", "filter": { "project": "work" } },
    { "name": "priority empty", "filter": { "priority": [] } },
    { "name": "priority out of range", "filter": { "priority": [5] } },
    { "name": "priority not integers", "filter": { "priority": [1.5] } },
    { "name": "priority not a list", "filter": { "priority": 2 } },
    { "name": "range unknown key", "filter": { "due": { "before": 0 } } },
    { "name": "range bound not a date", "filter": { "due": { "from": "2026-02-30" } } },
    { "name": "range bound fractional", "filter": { "due": { "to": 0.5 } } },
    { "name": "range offset too far", "filter": { "due": { "to": 36601 } } },
    { "name": "range not an object", "filter": { "scheduled": 0 } },
    { "name": "recurring not boolean", "filter": { "recurring": "yes" } },
    { "name": "nested invalid leaf", "filter": { "and": [{ "or": [{ "tag": "x" }] }] } }
  ]
}
```

- [ ] **Step 3: Failing tests** — `filter.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FILTER_MAX_DEPTH,
  FILTER_MAX_NODES,
  filterProblem,
  matches,
  type Filter,
  type FilterTask,
} from './filter';

type Vectors = {
  today: string;
  base: FilterTask;
  cases: Array<{
    name: string;
    filter: Filter;
    task: Partial<FilterTask>;
    matches: boolean;
  }>;
  invalid: Array<{ name: string; filter: unknown }>;
};
const vectors = JSON.parse(
  readFileSync(new URL('../vectors/filters.json', import.meta.url), 'utf8'),
) as Vectors;

const TAG = '018f0000-0000-7000-8000-00000000000a';

/** A chain of `not`s around one leaf: `levels` = the tree's depth. */
function nested(levels: number): unknown {
  let node: unknown = { tag: TAG };
  for (let i = 1; i < levels; i += 1) node = { not: node };
  return node;
}

describe('matches', () => {
  it.each(vectors.cases)('$name', ({ filter, task, matches: expected }) => {
    expect(filterProblem(filter)).toBeNull();
    expect(matches(filter, { ...vectors.base, ...task }, vectors.today)).toBe(
      expected,
    );
  });
});

describe('filterProblem', () => {
  it.each(vectors.invalid)('refuses $name', ({ filter }) => {
    expect(filterProblem(filter)).toEqual(expect.any(String));
  });

  it('accepts the deepest tree and refuses one level more', () => {
    expect(filterProblem(nested(FILTER_MAX_DEPTH))).toBeNull();
    expect(filterProblem(nested(FILTER_MAX_DEPTH + 1))).toMatch(/deeper/);
  });

  it('accepts the most nodes and refuses one more', () => {
    const leaves = (n: number) => ({
      or: Array.from({ length: n }, () => ({ recurring: true })),
    });
    // The `or` node counts too.
    expect(filterProblem(leaves(FILTER_MAX_NODES - 1))).toBeNull();
    expect(filterProblem(leaves(FILTER_MAX_NODES))).toMatch(/nodes/);
  });

  it('refuses ten thousand leaves without walking them all', () => {
    const huge = {
      or: Array.from({ length: 10_000 }, () => ({ recurring: true })),
    };
    expect(filterProblem(huge)).toMatch(/nodes/);
  });

  it('names where the problem is', () => {
    expect(filterProblem({ and: [{ recurring: true }, { tag: 'x' }] })).toBe(
      'filter.and[1].tag: not a uuid',
    );
  });
});
```

- [ ] **Step 4:** `pnpm --filter @todoer/specs test` — FAIL (`./filter` and
      `addDays` do not exist).
- [ ] **Step 5: Implement** — `dates.ts` gains:

```ts
/** `date` moved by `days` calendar days. UTC arithmetic: a calendar date has
 *  no time zone, so no daylight-saving shift can move it by an hour. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

`filter.ts`:

```ts
import { addDays, isIsoDate } from './dates';

/** A day offset from the client's local today, or an absolute date. */
export type DateBound = number | string;
/** Inclusive; an absent bound is open. `{}` matches any date at all. */
export type DateRange = { from?: DateBound; to?: DateBound };

/**
 * A view's filter (views design, Q6): a boolean tree over predicates,
 * referencing rows by id and dates by offsets from today. Check one with
 * `filterProblem` before storing or evaluating it.
 */
export type Filter =
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter }
  | { tag: string }
  | { project: string | null }
  | { status: string }
  | { priority: number[] }
  | { scheduled: DateRange }
  | { due: DateRange }
  | { recurring: boolean };

/**
 * What the evaluator needs to know about one task, resolved by the caller:
 * the tags it is attached to, the status a board shows it in (see
 * `displayStatus`), and for a recurring task the dates of its current
 * occurrence.
 */
export type FilterTask = {
  tagIds: readonly string[];
  projectId: string | null;
  statusId: string | null;
  priority: number;
  scheduledOn: string | null;
  dueOn: string | null;
  recurring: boolean;
};

export const FILTER_MAX_DEPTH = 8;
export const FILTER_MAX_NODES = 256;
const MAX_OFFSET_DAYS = 36_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): boolean =>
  typeof value === 'string' && UUID.test(value);

function rangeProblem(value: unknown, path: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${path}: not an object`;
  }
  for (const [key, bound] of Object.entries(value)) {
    if (key !== 'from' && key !== 'to') return `${path}: unknown key ${key}`;
    const offset =
      typeof bound === 'number' &&
      Number.isInteger(bound) &&
      Math.abs(bound) <= MAX_OFFSET_DAYS;
    if (!offset && !isIsoDate(bound)) {
      return `${path}.${key}: not a day offset or a YYYY-MM-DD date`;
    }
  }
  return null;
}

/**
 * Why `filter` is not a valid filter, or `null`. The server calls this on
 * every view write and clients before writing one, so a stored filter is
 * always one `matches` can evaluate. The node budget is checked as the walk
 * goes, so an enormous tree is refused without being walked.
 */
export function filterProblem(filter: unknown): string | null {
  let nodes = 0;
  const check = (node: unknown, depth: number, path: string): string | null => {
    if (depth > FILTER_MAX_DEPTH) {
      return `${path}: deeper than ${FILTER_MAX_DEPTH} levels`;
    }
    nodes += 1;
    if (nodes > FILTER_MAX_NODES) {
      return `more than ${FILTER_MAX_NODES} nodes`;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return `${path}: not an object`;
    }
    const keys = Object.keys(node);
    if (keys.length !== 1) return `${path}: needs exactly one key`;
    const key = keys[0] as string;
    const value = (node as Record<string, unknown>)[key];
    const at = `${path}.${key}`;
    switch (key) {
      case 'and':
      case 'or': {
        if (!Array.isArray(value)) return `${at}: not an array`;
        for (const [i, child] of value.entries()) {
          const problem = check(child, depth + 1, `${at}[${i}]`);
          if (problem !== null) return problem;
        }
        return null;
      }
      case 'not':
        return check(value, depth + 1, at);
      case 'tag':
      case 'status':
        return isUuid(value) ? null : `${at}: not a uuid`;
      case 'project':
        return value === null || isUuid(value)
          ? null
          : `${at}: not a uuid or null`;
      case 'priority':
        return Array.isArray(value) &&
          value.length > 0 &&
          value.every((p) => Number.isInteger(p) && p >= 0 && p <= 4)
          ? null
          : `${at}: not a non-empty list of priorities 0-4`;
      case 'scheduled':
      case 'due':
        return rangeProblem(value, at);
      case 'recurring':
        return typeof value === 'boolean' ? null : `${at}: not a boolean`;
      default:
        return `${path}: unknown key ${key}`;
    }
  };
  return check(filter, 1, 'filter');
}

function inRange(
  date: string | null,
  range: DateRange,
  today: string,
): boolean {
  if (date === null) return false;
  const day = (bound: DateBound): string =>
    typeof bound === 'string' ? bound : addDays(today, bound);
  return (
    (range.from === undefined || date >= day(range.from)) &&
    (range.to === undefined || date <= day(range.to))
  );
}

/**
 * Whether `task` is in a view with `filter`, on the client's local `today`
 * (`YYYY-MM-DD`). `filter` must have passed `filterProblem`.
 */
export function matches(
  filter: Filter,
  task: FilterTask,
  today: string,
): boolean {
  if ('and' in filter) return filter.and.every((f) => matches(f, task, today));
  if ('or' in filter) return filter.or.some((f) => matches(f, task, today));
  if ('not' in filter) return !matches(filter.not, task, today);
  if ('tag' in filter) return task.tagIds.includes(filter.tag);
  if ('project' in filter) return task.projectId === filter.project;
  if ('status' in filter) return task.statusId === filter.status;
  if ('priority' in filter) return filter.priority.includes(task.priority);
  if ('scheduled' in filter) {
    return inRange(task.scheduledOn, filter.scheduled, today);
  }
  if ('due' in filter) return inRange(task.dueOn, filter.due, today);
  return task.recurring === filter.recurring;
}
```

`index.ts`: add `export * from './filter';`.

- [ ] **Step 6:** `pnpm --filter @todoer/specs test` — PASS;
      `pnpm --filter @todoer/specs typecheck` and `lint` clean.
- [ ] **Step 7: Mutations** (revert each from a backup): drop the node
      counter → the node tests go red; `<=` → `<` in `inRange`'s `to` → "next
      7 days includes the seventh" goes red; `project` compares only when
      the filter value is a string → "project null is no project" goes red.
- [ ] **Step 8: Commit** `feat(specs): check and evaluate view filters` — body:
      one evaluator with shared vectors for every client (design Q6), and the
      server's write check is the same function. Tick T001.

---

### Task 2: The board column rule

Implements FR-003 (T002). Departure 3.

**Files:**

- Create: `packages/specs/src/status.ts`, `packages/specs/src/status.spec.ts`,
  `packages/specs/vectors/statuses.json`
- Modify: `packages/specs/src/index.ts`

**Interfaces:**

- Produces: `type StatusRow = { id: string; rank: string; completing: boolean }`;
  `displayStatus(statusId: string | null, statuses: readonly StatusRow[], occurrenceClosed: boolean): string | null`.

- [ ] **Step 1: Vectors** — `statuses.json`. Ids: inbox `…-000000000001`,
      doing `…-000000000002`, done `…-000000000003`, review
      `…-000000000004`, done2 `…-000000000005`, all with prefix
      `018f0000-0000-7000-8000-` (write them in full in the file).

```json
{
  "source": "Board rules of docs/specs/2026-10-01-views-design.md (Q7-Q9) and plan V2 departure 3. statuses are live rows only; the caller drops tombstones.",
  "seed": [
    { "id": "018f0000-0000-7000-8000-000000000001", "rank": "a0", "completing": false },
    { "id": "018f0000-0000-7000-8000-000000000002", "rank": "a1", "completing": false },
    { "id": "018f0000-0000-7000-8000-000000000003", "rank": "a2", "completing": true }
  ],
  "cases": [
    { "name": "no status shows in the first", "statusId": null, "closed": false, "expected": "018f0000-0000-7000-8000-000000000001" },
    { "name": "own status", "statusId": "018f0000-0000-7000-8000-000000000002", "closed": false, "expected": "018f0000-0000-7000-8000-000000000002" },
    { "name": "a deleted status shows in the first", "statusId": "018f0000-0000-7000-8000-0000000000ff", "closed": false, "expected": "018f0000-0000-7000-8000-000000000001" },
    { "name": "completing but open shows in the first", "statusId": "018f0000-0000-7000-8000-000000000003", "closed": false, "expected": "018f0000-0000-7000-8000-000000000001" },
    { "name": "closed shows in the completing status", "statusId": "018f0000-0000-7000-8000-000000000002", "closed": true, "expected": "018f0000-0000-7000-8000-000000000003" },
    { "name": "closed with no status", "statusId": null, "closed": true, "expected": "018f0000-0000-7000-8000-000000000003" },
    { "name": "no statuses at all", "statusId": null, "closed": false, "statuses": [], "expected": null },
    { "name": "two completing: the lowest id wins", "statusId": null, "closed": true, "statuses": [
      { "id": "018f0000-0000-7000-8000-000000000001", "rank": "a0", "completing": false },
      { "id": "018f0000-0000-7000-8000-000000000005", "rank": "a3", "completing": true },
      { "id": "018f0000-0000-7000-8000-000000000003", "rank": "a4", "completing": true }
    ], "expected": "018f0000-0000-7000-8000-000000000003" },
    { "name": "a completing status that ranks first is skipped for open tasks", "statusId": null, "closed": false, "statuses": [
      { "id": "018f0000-0000-7000-8000-000000000003", "rank": "a0", "completing": true },
      { "id": "018f0000-0000-7000-8000-000000000004", "rank": "a1", "completing": false }
    ], "expected": "018f0000-0000-7000-8000-000000000004" },
    { "name": "equal ranks order by id", "statusId": null, "closed": false, "statuses": [
      { "id": "018f0000-0000-7000-8000-000000000004", "rank": "a0", "completing": false },
      { "id": "018f0000-0000-7000-8000-000000000002", "rank": "a0", "completing": false }
    ], "expected": "018f0000-0000-7000-8000-000000000002" },
    { "name": "only completing statuses", "statusId": null, "closed": false, "statuses": [
      { "id": "018f0000-0000-7000-8000-000000000003", "rank": "a0", "completing": true }
    ], "expected": "018f0000-0000-7000-8000-000000000003" },
    { "name": "closed with no completing status keeps its own", "statusId": "018f0000-0000-7000-8000-000000000002", "closed": true, "statuses": [
      { "id": "018f0000-0000-7000-8000-000000000001", "rank": "a0", "completing": false },
      { "id": "018f0000-0000-7000-8000-000000000002", "rank": "a1", "completing": false }
    ], "expected": "018f0000-0000-7000-8000-000000000002" }
  ]
}
```

- [ ] **Step 2: Failing test** — `status.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayStatus, type StatusRow } from './status';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/statuses.json', import.meta.url), 'utf8'),
) as {
  seed: StatusRow[];
  cases: Array<{
    name: string;
    statusId: string | null;
    closed: boolean;
    statuses?: StatusRow[];
    expected: string | null;
  }>;
};

describe('displayStatus', () => {
  it.each(vectors.cases)('$name', (c) => {
    expect(displayStatus(c.statusId, c.statuses ?? vectors.seed, c.closed)).toBe(
      c.expected,
    );
  });

  it('does not reorder the caller’s array', () => {
    const statuses = [...vectors.seed].reverse();
    const before = statuses.map((s) => s.id);
    displayStatus(null, statuses, false);
    expect(statuses.map((s) => s.id)).toEqual(before);
  });
});
```

- [ ] **Step 3:** run — FAIL (no `./status`).
- [ ] **Step 4: Implement** — `status.ts`:

```ts
/** A live row of the user's status table, as the board rule needs it. */
export type StatusRow = { id: string; rank: string; completing: boolean };

const byRankThenId = (a: StatusRow, b: StatusRow): number =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * The status a board shows a task in (views design, Q7-Q9). The occurrence
 * wins: a closed current occurrence puts the task in the completing status,
 * an open one never does. Otherwise the task's own status, or — when it has
 * none, its status is deleted, or its status is the completing one — the
 * first non-completing status by rank. With several completing statuses (two
 * seeded sets merged) the lowest id is the completing one. `statuses` are
 * live rows; `null` only when there are none.
 */
export function displayStatus(
  statusId: string | null,
  statuses: readonly StatusRow[],
  occurrenceClosed: boolean,
): string | null {
  const ordered = [...statuses].sort(byRankThenId);
  const completing = statuses
    .filter((s) => s.completing)
    .map((s) => s.id)
    .sort()[0];
  if (occurrenceClosed && completing !== undefined) return completing;
  const first = (ordered.find((s) => !s.completing) ?? ordered[0])?.id ?? null;
  const own = ordered.find((s) => s.id === statusId);
  return own === undefined || own.id === completing ? first : own.id;
}
```

`index.ts`: add `export * from './status';`.

- [ ] **Step 5:** PASS; typecheck, lint clean.
- [ ] **Step 6: Mutations:** `.sort()[0]` → `[0]` (first completing by array
      order) → "two completing" goes red; drop `own.id === completing` →
      "completing but open" goes red.
- [ ] **Step 7: Commit** `feat(specs): share the board column rule` — body:
      every client must put a task in the same column, and the occurrence wins
      (design Q7). Tick T002.

---

### Task 3: The contract

Implements FR-004 (T003).

**Files:** `packages/specs/openapi/openapi.yaml`, regenerated
`packages/specs/src/generated/*`.

- [ ] **Step 1:** In `OpCreate`, `OpSet` and `OpDelete`, extend the `table`
      enum to `[task, project, tag, task_tag, task_occurrence, status, view]`.
- [ ] **Step 2:** Append to `OpCreate`'s description:

```yaml
        `status` rows are the user's kanban columns: `name`, `rank`,
        `color`, `completing` (one per user; with several, the lowest id
        counts). `view` rows hold `name`, `layout` (list, kanban,
        calendar), `filter`, `sort` (manual, priority, due, scheduled) and
        `rank`; a filter must pass `filterProblem` from `@todoer/specs`, or
        the operation is rejected with its reason. A task's `statusId`
        references a status (null: the first one); `originTaskId` and
        `originOccurrence` mark the copy of a moved occurrence and are set
        together.
```

- [ ] **Step 3:** `pnpm spec:validate && pnpm spec:codegen && pnpm --filter @todoer/specs build`.
- [ ] **Step 4: Commit** the YAML as `docs(specs): add the status and view
      tables to the sync contract` (body: the validator rejects an unknown
      table name with 400, so the enum ships before the server accepts the
      tables), then the generated files as
      `chore(specs): regenerate the SDK for the status and view tables`.
      Tick T003 in the second commit.

---

### Task 4: Schema, migration and one database reset for the specs

Implements the storage of FR-005 (T004). Departure 5.

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`; new migration
- Create: `apps/backend/src/testing/reset-database.ts`
- Modify: the `beforeEach` of `apps/backend/src/auth/accounts.service.spec.ts`,
  `auth.controller.spec.ts`, `auth.service.spec.ts`,
  `apps/backend/src/sync/prune.service.spec.ts`, `sync.service.spec.ts`

**Interfaces:**

- Produces: Prisma models `Status`, `View`; `Task.statusId`,
  `Task.originTaskId`, `Task.originOccurrence`; delegates `prisma.status`,
  `prisma.view`; `resetDatabase(prisma: PrismaService): Promise<void>`.

- [ ] **Step 1: Schema** — add to `User`: `statuses Status[]` and
      `views View[]`. Add to `Task`, after `rank`:

```prisma
  /// The task's kanban column (views design, Q2). Null: the first status.
  statusId         String?   @db.Uuid
  /// The recurring task and occurrence this one-off copy was moved from
  /// (views design, Q13). Informational: no foreign key, so the original's
  /// tombstone can be pruned while the copy lives (plan V2, departure 5).
  originTaskId     String?   @db.Uuid
  originOccurrence DateTime? @db.Date
```

and to its relations `status Status? @relation(fields: [statusId], references: [id])`
and `@@index([statusId])`. New models:

```prisma
/// A kanban column of one user (views design, Q2, Q5). Synced like a tag.
model Status {
  id         String  @id @db.Uuid
  userId     String  @db.Uuid
  name       String
  rank       String
  color      String?
  completing Boolean @default(false)

  version   Int      @default(1)
  fieldTs   Json     @default("{}")
  /// Defaults to nextval('change_seq') — set by hand in the migration that
  /// created this table (trap 6 in `.claude/CLAUDE.md`).
  seq       BigInt
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  user  User   @relation(fields: [userId], references: [id])
  tasks Task[]

  @@index([userId, seq])
}

/// A named filter, layout and sort key (views design, Q1). `filter` passed
/// `filterProblem` from @todoer/specs when it was written.
model View {
  id     String @id @db.Uuid
  userId String @db.Uuid
  name   String
  layout String
  filter Json
  sort   String
  rank   String

  version   Int      @default(1)
  fieldTs   Json     @default("{}")
  /// Defaults to nextval('change_seq') — set by hand in the migration that
  /// created this table (trap 6 in `.claude/CLAUDE.md`).
  seq       BigInt
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@index([userId, seq])
}
```

- [ ] **Step 2: Migration** —
      `pnpm --filter @todoer/backend exec prisma migrate dev --create-only --name views_and_statuses`
      against `todoer_test`. Delete every `DROP DEFAULT` on a `seq` column and
      `DROP SEQUENCE "change_seq"`. Append:

```sql
-- Hand-written, like the earlier migrations': Prisma does not model a
-- default shared across tables (trap 6).
ALTER TABLE "Status" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
ALTER TABLE "View" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
```

  `prisma migrate deploy` on `todoer_test`; `prisma generate`. Check with
  `docker exec todoer-dev-postgres-1 psql -U todoer -d todoer_test -c '\d "View"'`
  that `seq` defaults to `nextval('change_seq'::regclass)`, and the same for
  `Task`'s `seq` (untouched).
- [ ] **Step 3: The shared reset** — `apps/backend/src/testing/reset-database.ts`:

```ts
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Empties every table the DB-backed specs touch, children before the rows
 * they reference. One list, so a new table is added once instead of in every
 * spec's `beforeEach` (five copies had drifted apart before this existed).
 * vitest.setup.ts guarantees the database name ends in `_test`.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.appliedOp.deleteMany({});
  await prisma.taskOccurrence.deleteMany({});
  await prisma.taskTag.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.status.deleteMany({});
  await prisma.view.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.resetCode.deleteMany({});
  await prisma.user.deleteMany({});
}
```

  Replace the five specs' runs of `deleteMany({})` calls with
  `await resetDatabase(prisma);`, keeping whatever each `beforeEach` does
  after them (creating users). Keep each removed comment that explains a
  spec's own setup; drop the ones that only explained the deletion order.
- [ ] **Step 4: Test** — in `sync.service.spec.ts`, a test that the new
      columns round-trip through Prisma: create a `status` row and a `task`
      with `statusId` pointing at it, `originTaskId` a fresh uuid and
      `originOccurrence: new Date('2026-10-05T00:00:00Z')` with
      `prisma.*.create` (Prisma requires `seq`; pass `1n` and `2n`); read the
      task back and expect the three fields. A second test reads
      `information_schema.columns` with `$queryRaw` for `column_default` of
      `seq` in `Status` and `View` and expects both to contain
      `nextval('change_seq'`. FAIL before the migration, PASS after.
- [ ] **Step 5:** backend tests and typecheck pass.
- [ ] **Step 6: Commit** `feat(backend): store statuses, views and task
      origins` — body: the storage for views design Q1, Q2, Q13; one reset
      list for the specs. Tick T004.

---

### Task 5: Sync the new tables

Implements FR-005, FR-006 (T005). Departures 5, 6.

**Files:** `apps/backend/src/sync/sync.service.ts`,
`apps/backend/src/sync/row-rules.ts`, `row-rules.spec.ts`,
`sync.service.spec.ts`.

**Interfaces:**

- Consumes: `filterProblem` from `@todoer/specs` (Task 1); the models of Task 4.

- [ ] **Step 1: Row-rule tests** — `row-rules.spec.ts`:

```ts
const view = {
  name: 'Today',
  layout: 'list',
  sort: 'due',
  rank: 'a0',
  filter: { due: { from: 0, to: 0 } },
};

describe('view rows', () => {
  it('accepts a valid view', () => {
    expect(rowRejection('view', view)).toBeNull();
  });
  it.each([
    [{ ...view, name: '' }, 'name must be a non-empty string'],
    [{ ...view, name: undefined }, 'name must be a non-empty string'],
    [{ ...view, layout: 'grid' }, 'layout must be one of list, kanban, calendar'],
    [{ ...view, sort: 'title' }, 'sort must be one of manual, priority, due, scheduled'],
    [{ ...view, rank: 3 }, 'rank must be a string'],
    [{ ...view, filter: { tag: 'x' } }, 'filter: filter.tag: not a uuid'],
    [{ ...view, filter: undefined }, 'filter: filter: not an object'],
  ])('rejects %o', (row, reason) => {
    expect(rowRejection('view', row)).toBe(reason);
  });
});

describe('status rows', () => {
  const status = { name: 'Doing', rank: 'a1', completing: false, color: null };
  it('accepts a valid status, with or without completing', () => {
    expect(rowRejection('status', status)).toBeNull();
    expect(rowRejection('status', { name: 'Doing', rank: 'a1' })).toBeNull();
  });
  it.each([
    [{ ...status, name: ' ' }, 'name must be a non-empty string'],
    [{ ...status, rank: null }, 'rank must be a string'],
    [{ ...status, completing: 'yes' }, 'completing must be a boolean'],
    [{ ...status, color: 7 }, 'color must be a string or null'],
  ])('rejects %o', (row, reason) => {
    expect(rowRejection('status', row)).toBe(reason);
  });
});

describe('task origin', () => {
  const ORIGIN = '018f0000-0000-7000-8000-000000000001';
  it('accepts both or neither', () => {
    expect(
      rowRejection('task', { originTaskId: ORIGIN, originOccurrence: '2026-10-05' }),
    ).toBeNull();
    expect(
      rowRejection('task', { originTaskId: null, originOccurrence: null }),
    ).toBeNull();
  });
  it('rejects one without the other, also on a recurring task', () => {
    const reason = 'originTaskId and originOccurrence are set together';
    expect(rowRejection('task', { originTaskId: ORIGIN })).toBe(reason);
    expect(
      rowRejection('task', { ...recurring, originOccurrence: '2026-10-05' }),
    ).toBe(reason);
  });
});
```

- [ ] **Step 2: Sync tests** — in `sync.service.spec.ts` add helpers in the
      file's style (`create(table, fields)` returning a create op with
      `uuidv7()` ids, `ts: new Date().toISOString()`) and these tests:
  - a `status` create and a `view` create (fields as in Step 1, filter
    `{ and: [{ status: <the status id> }, { due: { to: -1 } }] }`) are
    `applied`, and a pull from `since: 0` returns both rows with exactly the
    writable fields plus `id`, `version`, `fieldTs`, `deletedAt` — `filter`
    as the same object;
  - a `view` create with `filter: { or: Array.from({ length: 10_000 }, () => ({ recurring: true })) }`
    is `rejected` with reason `filter: more than 256 nodes`, and no `view`
    row exists;
  - `set filter` on an existing view to `{ tag: 'x' }` is `rejected`
    (`filter: filter.tag: not a uuid`); the row keeps its filter;
  - a task created with `statusId` of the user's status is `applied`; with
    `statusId` of another user's status it is `rejected` with
    `statusId does not reference a row you own`;
  - a task `set statusId` to a **tombstoned** status of the user is
    `applied` (offline writes against a deleted status, design Q8);
  - a task created with `originTaskId` of the user's recurring task and
    `originOccurrence: '2026-10-05'` is `applied` and pulls back with
    `originOccurrence: '2026-10-05'` (a date, not a timestamp); with
    `originOccurrence: '5 Oct'` it is `rejected` with
    `originOccurrence must be a date, YYYY-MM-DD`; with `originTaskId` of
    another user's task, `rejected` (`originTaskId does not reference a row
    you own`);
  - an unknown field on a view (`fields: { ...view, owner: 'x' }`) is
    `rejected` with `unknown field: owner`.
- [ ] **Step 3:** run — FAIL (`unknown table`, no rules).
- [ ] **Step 4: Implement** — `sync.service.ts`:
  - `TABLES`: append `'status', 'view'`; `DELEGATE`: `status: 'status'`,
    `view: 'view'`; `RELATION`: `status: 'Status'`, `view: 'View'`.
  - `REFERENCES.task`: `{ projectId: 'project', parentId: 'task', statusId: 'status', originTaskId: 'task' }`.
  - `WRITABLE_FIELDS.task`: add `'statusId', 'originTaskId', 'originOccurrence'`;
    add `status: new Set(['name', 'rank', 'color', 'completing'])` and
    `view: new Set(['name', 'layout', 'filter', 'sort', 'rank'])`.
  - `DATE_FIELDS.task`: add `'originOccurrence'`.
  - Extend the `REFERENCES` comment with one line: `originTaskId` is checked
    for ownership like every reference but has no foreign key (plan V2,
    departure 5).

  `row-rules.ts`:

```ts
import { filterProblem, parseRrule } from '@todoer/specs';

const STATES: ReadonlySet<unknown> = new Set(['open', 'done', 'skipped']);
const LAYOUTS: ReadonlySet<unknown> = new Set(['list', 'kanban', 'calendar']);
const SORTS: ReadonlySet<unknown> = new Set([
  'manual',
  'priority',
  'due',
  'scheduled',
]);

const isName = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';
const isSet = (value: unknown): boolean =>
  value !== null && value !== undefined;
```

  At the top of the `task` branch, before the rrule checks:

```ts
    if (isSet(row.originTaskId) !== isSet(row.originOccurrence)) {
      return 'originTaskId and originOccurrence are set together';
    }
```

  and two new branches before the final `return null`:

```ts
  if (table === 'status') {
    if (!isName(row.name)) return 'name must be a non-empty string';
    if (typeof row.rank !== 'string') return 'rank must be a string';
    if (row.completing !== undefined && typeof row.completing !== 'boolean') {
      return 'completing must be a boolean';
    }
    if (isSet(row.color) && typeof row.color !== 'string') {
      return 'color must be a string or null';
    }
    return null;
  }
  if (table === 'view') {
    if (!isName(row.name)) return 'name must be a non-empty string';
    if (!LAYOUTS.has(row.layout)) {
      return 'layout must be one of list, kanban, calendar';
    }
    if (!SORTS.has(row.sort)) {
      return 'sort must be one of manual, priority, due, scheduled';
    }
    if (typeof row.rank !== 'string') return 'rank must be a string';
    const problem = filterProblem(row.filter);
    return problem === null ? null : `filter: ${problem}`;
  }
```

  Update the module comment: the row rules now cover tasks (rrule, origin),
  task occurrences, statuses and views.
- [ ] **Step 5:** backend tests pass; typecheck and lint clean.
- [ ] **Step 6: Mutations:** remove `statusId: 'status'` from `REFERENCES` →
      the other-user status test goes red; remove the `view` branch of
      `rowRejection` → the 10 000-leaf test goes red (Prisma would store it);
      drop `'originOccurrence'` from `DATE_FIELDS` → the round-trip test goes
      red.
- [ ] **Step 7: Commit** `feat(backend): sync statuses and views, and
      validate filters` — body: the generic sync path carries both tables;
      the server stores only filters every client can evaluate (design Q6).
      Tick T005.

---

### Task 6: Prune and purge the new rows

Implements FR-007 (T006).

**Files:** `apps/backend/src/sync/prune.service.ts`, `prune.service.spec.ts`,
`apps/backend/src/auth/accounts.service.ts`, `accounts.service.spec.ts`.

- [ ] **Step 1: Prune tests** (`prune.service.spec.ts`, in the file's style:
      write through `sync`, back-date `deletedAt` with `prisma.*.update`):
  - a view tombstone older than the retention window is deleted, and the
    watermark rises to its seq;
  - a status tombstone that a **live** task references through `statusId` is
    kept; after that task is deleted and its tombstone ages out too, the next
    run deletes both and the watermark covers the higher seq;
  - a status tombstone younger than the window is kept.
- [ ] **Step 2: Purge test** (`accounts.service.spec.ts`, beside the existing
      deletion test): a user with a status, a view, and a task whose
      `statusId` points at the status deletes their account; `status.count`
      and `view.count` for that user are 0 and another user's status and view
      are untouched.
- [ ] **Step 3:** run — FAIL (the purge fails on the `Task_statusId_fkey`
      order or leaves rows; the prune leaves view/status tombstones).
- [ ] **Step 4: Implement** — `prune.service.ts` steps, after the two task
      steps and before `tag`:

```ts
        // A status a task still points at waits, like a project: the task
        // steps above have already removed the tasks that aged out.
        [tx.status as unknown as Prunable, { ...old, tasks: { none: {} } }],
        [tx.view as unknown as Prunable, old],
```

  and add `status` and `view` to the class comment's list of pruned tables.
  `accounts.service.ts` `deleteAccount`: after `tx.task.deleteMany({ where })`
  add `await tx.status.deleteMany({ where });` and
  `await tx.view.deleteMany({ where });`.
- [ ] **Step 5:** PASS; mutation: drop `tasks: { none: {} }` from the status
      step → the referenced-status test goes red (or the FK fails the run).
- [ ] **Step 6: Commit** `feat(backend): prune and purge statuses and views` —
      body: tombstones of the new tables age out under the same retention
      contract (ADR 0013), and account deletion leaves nothing. Tick T006.

---

### Task 7: End to end, and the documents

Implements FR-008 (T007).

**Files:** `scripts/walking-skeleton.sh`,
`docs/specs/2026-09-25-domain-and-sync-design.md`,
`docs/specs/2026-10-01-views-design.md`, `README.md` (only if it lists the
synced tables).

- [ ] **Step 1: The contract over HTTP** — in `walking-skeleton.sh`, after
      the recurrence block and before the CLI sign-in block, using the
      helper's `api` (sourced already):

```sh
# Views (plan V2): a status and a view go through POST /sync, so the
# contract's table enum and the filter check are exercised over HTTP.
SID=$(node -e 'console.log(crypto.randomUUID())')
VID=$(node -e 'console.log(crypto.randomUUID())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
op() { printf '{"opId":"%s","kind":"create","table":"%s","id":"%s","fields":%s,"ts":"%s"}' \
  "$(node -e 'console.log(crypto.randomUUID())')" "$1" "$2" "$3" "$NOW"; }
STATUS_OP=$(op status "$SID" '{"name":"Doing","rank":"a1","completing":false}')
VIEW_OP=$(op view "$VID" "{\"name\":\"Doing now\",\"layout\":\"kanban\",\"sort\":\"manual\",\"rank\":\"a0\",\"filter\":{\"status\":\"$SID\"}}")
BAD_OP=$(op view "$(node -e 'console.log(crypto.randomUUID())')" '{"name":"bad","layout":"list","sort":"due","rank":"a1","filter":{"tag":"x"}}')
api /sync "{\"since\":0,\"ops\":[$STATUS_OP,$VIEW_OP,$BAD_OP]}" "$TOKEN"
[ "$STATUS" = 200 ] || { echo "FAIL: /sync with a status and a view returned $STATUS: $BODY_OUT" >&2; exit 1; }
APPLIED=$(printf '%s' "$BODY_OUT" | grep -o '"status":"applied"' | wc -l)
[ "$APPLIED" -eq 2 ] || { echo "FAIL: expected the status and the view applied: $BODY_OUT" >&2; exit 1; }
printf '%s' "$BODY_OUT" | grep -qF 'filter.tag: not a uuid' ||
  { echo "FAIL: the invalid filter was not rejected with its reason: $BODY_OUT" >&2; exit 1; }
```

  Run it against a live backend on a fresh database as Task 9 of plan D did
  (`todoer_e2e`), twice in a row; `sh -n` the script.
- [ ] **Step 2: Docs.**
  - Domain design: the entity diagram and table list gain `status` and
    `view` and the three task fields, with one line each pointing at the views
    design; wherever it lists the synced tables (grep `task_occurrence`),
    add the two.
  - Views design: `## Departures in the plan` with this plan's six
    departures, one short paragraph each.
  - README: only if it enumerates synced tables.
  - Grep `docs/` (excluding `docs/plans`) and `README.md` for statements now
    false (e.g. "five synced tables").
- [ ] **Step 3: Gates** —
      `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm -w exec turbo run build typecheck test && pnpm lint`.
- [ ] **Step 4: Commit** `docs: describe the status and view tables, and prove
      them end to end` (split the script and the docs if cleaner). Tick T007.
