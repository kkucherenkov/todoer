# Plan C1: Recurrence in the CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a caller can create a recurring task, see each task once in `list`
with a short reference and — for a recurring one — the date it is due, and
mark an occurrence done, skipped or open again, online or offline.

**Architecture:** four small pure modules in `apps/cli/src` — `expand.ts`
(RFC 5545 subset → dates), `occurrence.ts` (which occurrence is current),
`ref.ts` (id suffix → task), and a derived-id branch in `overlay.ts` — and
`run.ts` wires them into `add --rrule/--from`, `list`, and three new commands
that each queue one `create` of `task_occurrence` through the same submit path
`add` already uses. The server is untouched; `@todoer/specs` gains two test
vectors.

**Tech Stack:** TypeScript, Node ≥ 24.15, `node:sqlite` (existing store),
Vitest 5. No new dependencies.

**Spec:** [`docs/specs/2026-09-26-plan-c-recurrence-design.md`](../specs/2026-09-26-plan-c-recurrence-design.md)
— the C1 half. Read Q3, Q6, Q9, Q10, Q11 and "Notes for C1" before Task 1.
Background: ADR 0002, 0009, 0010, 0015. Task spec:
[`specs/tasks/active/T-2026-09-28-cli-recurrence.md`](../../specs/tasks/active/T-2026-09-28-cli-recurrence.md).

## Where this plan departs from the design doc

Task 6 writes each into the design doc's "Departures in plan C1".

1. **`undo` defaults to the latest done or skipped occurrence, not the
   current one.** Q11 says all three commands act on the current occurrence,
   but after `done` the current occurrence is the next, still open one, so a
   plain `undo` would reopen nothing.
2. **The next occurrence skips ones already closed.** Q11's "first occurrence
   after today" would keep showing tomorrow after the caller marked it done in
   advance; the plan takes the first *open* one after today, looking at most
   100 occurrences and ten years ahead.
3. **A subtask uses its parent's rule and dates.** The design defers subtask
   completion because the CLI cannot create subtasks. Other clients can, and
   without this a subtask of a recurring task would look like a one-off in
   `list`, and `done` would write a null occurrence — the defect ADR 0009
   describes. The cost is one parent lookup.
4. **Two expander details follow python-dateutil.** A WEEKLY rule's first week
   offers no candidates before `dtstart`, so BYSETPOS does not count them; a
   repeated BYMONTH value yields one occurrence. RFC 5545 is silent on the
   first and the second is a duplicate the parser lets through. Two vectors
   pin both.
5. **`list` gains two columns.** A line is `<ref>  <priority>  <title>`, plus
   `  <YYYY-MM-DD>` for a recurring task; each `--json` row gains `ref` and
   `occurrence`.
6. **The CLI's tests run with `TZ=UTC`**, set in `apps/cli/vitest.config.mjs`:
   "today" is the local date (ADR 0010), and the fixed test clock
   (`2026-09-26T10:00Z`) would be another day in UTC+14.

## Global Constraints

- **Dates** are `YYYY-MM-DD` strings; "today" is the caller's local calendar
  date (`localDate(deps.now())`).
- **References:** `shortRef(id)` = the last 6 characters of the id; a ref
  argument is the full id or a suffix of at least 4 characters of
  `[0-9a-f-]`, matched case-insensitively.
- **States:** `done`, `skipped`, `open`; `done`/`skip`/`undo` write
  `state` = `done`/`skipped`/`open`; `completedAt` = the command's time for
  `done`, `null` otherwise. Done/skipped is read from `state` alone.
- **Every mark is a `create`** of `task_occurrence` with
  `id: taskOccurrenceId(taskId, occurrence)` and
  `fields: { taskId, occurrence, state, completedAt }` — never `set`, never
  `delete`; the server merges (plan C2).
- **Exit codes** are unchanged: 2 for anything wrong with the invocation
  (nothing queued), and the `add` rules (0, 1, 4, 5) for every write.
- **Walking skeleton is POSIX `sh`** (trap 4): no `pipefail`, no `date -d`.
- **Tests:** `pnpm --filter @todoer/cli test`. After touching
  `packages/specs`, run `pnpm --filter @todoer/specs build` first. The
  walking skeleton needs a running backend (see README, "Running it").
- **Commits:** Conventional Commits with a scope, body says why, **no
  `Co-Authored-By` trailer**. Never commit to `main`. `pnpm format` before
  each commit.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.

## Review Focus

1. **Undo right after done.** `done <ref>` then `undo <ref>` on a daily task
   must reopen today, not touch tomorrow. Test in Task 5.
2. **Offline marks show at once.** `done` without a server exits 5, and `list`
   run offline already shows the next date — the pending create must merge
   over a stored row, not be ignored because the row exists. Tests in Task 2
   and Task 5.
3. **Missed days collapse.** A daily task anchored five days back with nothing
   done lists once, at today. Test in Task 3 and Task 5.
4. **Options are argv elements, not substrings.** `add "fix --rrule parsing"`
   (one quoted argument) keeps the text as the title. Test in Task 4.
5. **An ended rule.** A COUNT rule whose occurrences are all done is not
   listed, and `done` without `--on` exits 2 with a reason instead of writing
   something. Tests in Task 3 and Task 5.

---

### Task 0: Branch and documents

**Files:** add `docs/plans/2026-09-28-plan-c1-cli-recurrence.md`,
`specs/tasks/active/T-2026-09-28-cli-recurrence.md`.

- [ ] **Step 1: Branch** (skip if `git branch --show-current` prints
      `feat/cli-recurrence`): `git switch main && git pull --ff-only && git
      switch -c feat/cli-recurrence`
- [ ] **Step 2: Commit**

```bash
git add docs/plans/2026-09-28-plan-c1-cli-recurrence.md \
  specs/tasks/active/T-2026-09-28-cli-recurrence.md
git commit -m "docs: plan the CLI half of plan C" \
  -m "The server stores task occurrences since C2 but no client writes one.
C1 gives the CLI an expander, recurring adds, task references and
done/skip/undo."
```

---

### Task 1: The expander

Implements FR-001 (T001). Departure 4.

**Files:**

- Create: `apps/cli/src/expand.ts`, `apps/cli/src/expand.spec.ts`,
  `apps/cli/vitest.config.mjs`
- Modify: `packages/specs/vectors/rrule.json` (two cases appended)

**Interfaces:**

- Consumes: `Rrule`, `Weekday`, `WEEKDAYS`, `parseRrule` from `@todoer/specs`.
- Produces: `expand(rule: Rrule, dtstart: string, from: string, to: string,
  limit?: number): string[]` — occurrences in `[from, to]` inclusive, sorted,
  at most `limit`.

The code below was checked before planning against all 20 vectors and 3000
random rules compared with python-dateutil 2.9.0: no mismatches.

- [ ] **Step 1: Add the two vectors**

Append to the `cases` array of `packages/specs/vectors/rrule.json` (values
from python-dateutil, not from this code):

```json
    {"name": "BYSETPOS in a first week that starts before dtstart", "rrule": "FREQ=WEEKLY;INTERVAL=3;BYDAY=FR,SU,MO;BYSETPOS=2;WKST=SU", "dtstart": "2025-10-06", "window": {"from": "2025-09-19", "to": "2025-11-30"}, "expected": ["2025-10-10", "2025-10-27", "2025-11-17"]},
    {"name": "a repeated BYMONTH value yields one occurrence", "rrule": "FREQ=YEARLY;BYMONTH=6,6", "dtstart": "2025-06-26", "window": {"from": "2025-01-01", "to": "2027-12-31"}, "expected": ["2025-06-26", "2026-06-26", "2027-06-26"]}
```

Then `pnpm exec prettier --write packages/specs/vectors && pnpm --filter
@todoer/specs test && pnpm --filter @todoer/specs build` (the specs package's
own test parses every vector's rule).

- [ ] **Step 2: Pin the CLI tests' time zone**

`apps/cli/vitest.config.mjs` (`.mjs`, not `.ts`: ESLint lints `.ts` files
only inside a tsconfig, and this file sits outside `src`):

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // "Today" is the local date (ADR 0010); the fixed test clock is
    // 2026-09-26T10:00Z, which is another day in UTC+14 or UTC-11.
    env: { TZ: 'UTC' },
  },
});
```

- [ ] **Step 3: Write the failing test**

`apps/cli/src/expand.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseRrule, type Rrule } from '@todoer/specs';
import { expand } from './expand.js';

type Vector = {
  name: string;
  rrule: string;
  dtstart: string;
  window: { from: string; to: string };
  expected: string[];
};

const vectors = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@todoer/specs/vectors/rrule.json'),
    'utf8',
  ),
) as { cases: Vector[] };

function rule(text: string): Rrule {
  const parsed = parseRrule(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rule;
}

describe('expand', () => {
  it.each(vectors.cases)('matches the vector "$name"', (v) => {
    expect(expand(rule(v.rrule), v.dtstart, v.window.from, v.window.to)).toEqual(
      v.expected,
    );
  });

  it('terminates on a rule that never matches', () => {
    expect(
      expand(rule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=31'), '2026-01-01', '2026-01-01', '2126-01-01'),
    ).toEqual([]);
  });

  it('stops after limit occurrences', () => {
    expect(expand(rule('FREQ=DAILY'), '2026-09-01', '2026-09-10', '2026-12-31', 2)).toEqual([
      '2026-09-10',
      '2026-09-11',
    ]);
  });

  it('returns nothing for a window that ends before dtstart', () => {
    expect(expand(rule('FREQ=WEEKLY'), '2026-10-05', '2026-09-01', '2026-10-04')).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @todoer/cli exec vitest run src/expand.spec.ts`
Expected: FAIL — `Failed to resolve import "./expand.js"`.

- [ ] **Step 5: Write `apps/cli/src/expand.ts`**

```ts
import { WEEKDAYS, type Rrule, type Weekday } from '@todoer/specs';

const DAY_MS = 86_400_000;

/** Days since 1970-01-01, UTC. A date is a whole number of days (ADR 0010). */
function toDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`) / DAY_MS;
}

function toIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function parts(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday, the order of WEEKDAYS. */
function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

/** Month day `n` of a month with `dim` days: negative counts from the end. */
function monthDay(n: number, dim: number): number {
  return n > 0 ? n : dim + n + 1;
}

type Scope = { first: number; last: number };

/**
 * Whether `day` matches a BYDAY entry. An ordinal counts within `scope` —
 * the month, or the whole year for YEARLY without BYMONTH (RFC 5545
 * §3.3.10) — from the end when negative.
 */
function matchesByDay(
  day: number,
  byDay: NonNullable<Rrule['byDay']>,
  scope: Scope,
): boolean {
  const wd = weekday(day);
  return byDay.some(({ n, day: name }) => {
    if (weekdayIndex(name) !== wd) return false;
    if (n === null) return true;
    return n > 0
      ? Math.floor((day - scope.first) / 7) + 1 === n
      : -(Math.floor((scope.last - day) / 7) + 1) === n;
  });
}

/** One month's candidate days, for MONTHLY and YEARLY. */
function monthCandidates(
  y: number,
  m: number,
  rule: Rrule,
  startDom: number,
  yearScope: Scope | null,
): number[] {
  const dim = daysInMonth(y, m);
  const doms =
    rule.byMonthDay !== null
      ? rule.byMonthDay.map((n) => monthDay(n, dim))
      : rule.byDay !== null
        ? Array.from({ length: dim }, (_, i) => i + 1)
        : [startDom];
  const scope = yearScope ?? { first: dayOf(y, m, 1), last: dayOf(y, m, dim) };
  return [...new Set(doms)]
    .filter((d) => d >= 1 && d <= dim)
    .sort((a, b) => a - b)
    .map((d) => dayOf(y, m, d))
    .filter(
      (day) => rule.byDay === null || matchesByDay(day, rule.byDay, scope),
    );
}

/** Period `k` of the rule: its first day, and its candidate days, sorted. */
function period(
  rule: Rrule,
  start: number,
  k: number,
): { first: number; days: number[] } {
  const s = parts(start);
  const inMonths = (day: number): boolean =>
    rule.byMonth === null || rule.byMonth.includes(parts(day).m);

  if (rule.freq === 'DAILY') {
    const day = start + k * rule.interval;
    const { y, m, d } = parts(day);
    const ok =
      inMonths(day) &&
      (rule.byMonthDay === null ||
        rule.byMonthDay.some((n) => monthDay(n, daysInMonth(y, m)) === d)) &&
      (rule.byDay === null ||
        rule.byDay.some(
          ({ day: name }) => weekdayIndex(name) === weekday(day),
        ));
    return { first: day, days: ok ? [day] : [] };
  }
  if (rule.freq === 'WEEKLY') {
    const first =
      start -
      ((weekday(start) - weekdayIndex(rule.wkst) + 7) % 7) +
      7 * rule.interval * k;
    const wanted =
      rule.byDay === null
        ? [weekday(start)]
        : rule.byDay.map(({ day }) => weekdayIndex(day));
    // Days before dtstart are not candidates at all, so BYSETPOS never counts
    // them — python-dateutil's reading, which the vectors follow; RFC 5545 is
    // silent. MONTHLY and YEARLY do count them, and drop them afterwards.
    const days = Array.from({ length: 7 }, (_, i) => first + i).filter(
      (day) => day >= start && wanted.includes(weekday(day)) && inMonths(day),
    );
    return { first, days };
  }
  if (rule.freq === 'MONTHLY') {
    const index = s.y * 12 + (s.m - 1) + k * rule.interval;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const days =
      rule.byMonth === null || rule.byMonth.includes(m)
        ? monthCandidates(y, m, rule, s.d, null)
        : [];
    return { first: dayOf(y, m, 1), days };
  }
  const y = s.y + k * rule.interval;
  const months =
    rule.byMonth !== null
      ? [...new Set(rule.byMonth)].sort((a, b) => a - b)
      : rule.byMonthDay !== null || rule.byDay !== null
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        : [s.m];
  const yearScope =
    rule.byMonth === null
      ? { first: dayOf(y, 1, 1), last: dayOf(y, 12, 31) }
      : null;
  const days = months.flatMap((m) =>
    monthCandidates(y, m, rule, s.d, yearScope),
  );
  return { first: dayOf(y, 1, 1), days };
}

/** BYSETPOS: the positions kept from one period's sorted set, 1-based, or
 *  from the end when negative. */
function atPositions(days: number[], positions: number[]): number[] {
  const kept = new Set<number>();
  for (const p of positions) {
    const day = days[p > 0 ? p - 1 : days.length + p];
    if (day !== undefined) kept.add(day);
  }
  return [...kept].sort((a, b) => a - b);
}

/**
 * Every occurrence of `rule` anchored at `dtstart` that falls in
 * [`from`, `to`], both inclusive, as `YYYY-MM-DD` (domain design §4), at
 * most `limit` of them.
 *
 * COUNT counts from dtstart, not from the window, and a dtstart the rule does
 * not produce is not an occurrence — both as `vectors/rrule.json` pins them.
 * Terminates for any rule, including one that never matches (BYMONTH=2;
 * BYMONTHDAY=31): periods only move forward, and the loop stops at the first
 * period that starts after the window or UNTIL.
 */
// ponytail: walks every period from dtstart, so a daily rule anchored decades
// back costs ~10k iterations per call. Skip ahead to the window when a rule
// has no COUNT if `list` ever feels it.
export function expand(
  rule: Rrule,
  dtstart: string,
  from: string,
  to: string,
  limit = Infinity,
): string[] {
  const start = toDay(dtstart);
  const lo = toDay(from);
  const hi = Math.min(
    toDay(to),
    rule.until === null ? Infinity : toDay(rule.until),
  );
  const out: string[] = [];
  let count = 0;
  for (let k = 0; ; k++) {
    const { first, days } = period(rule, start, k);
    if (first > hi) return out;
    const kept =
      rule.bySetPos === null ? days : atPositions(days, rule.bySetPos);
    for (const day of kept) {
      if (day < start) continue;
      if (day > hi) return out;
      count++;
      if (rule.count !== null && count > rule.count) return out;
      if (day >= lo) {
        out.push(toIso(day));
        if (out.length >= limit) return out;
      }
    }
  }
}
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint`
Expected: PASS, 20 vector cases among them.

Mutation checks (revert each): remove `day >= start &&` from the WEEKLY
filter — the "BYSETPOS in a first week" vector must fail; change
`[...new Set(rule.byMonth)]` to `[...rule.byMonth]` — the "repeated BYMONTH"
vector must fail; change `if (rule.count !== null && count > rule.count)` to
`>=` — the WKST vectors must fail.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/specs/vectors apps/cli/src/expand.ts apps/cli/src/expand.spec.ts apps/cli/vitest.config.mjs
git commit -m "feat(cli): expand recurrence rules into dates" \
  -m "An offline client must answer 'what is due' without the server, so
the CLI expands the RFC 5545 subset itself. The shared vectors decide
correctness; two more pin details where python-dateutil and a literal
reading of the RFC could part ways."
```

Tick T001 in the task spec.

---

### Task 2: Task references and the derived-id overlay

Implements FR-005 (the resolver), FR-008 (T002).

**Files:**

- Create: `apps/cli/src/ref.ts`, `apps/cli/src/ref.spec.ts`
- Modify: `apps/cli/src/overlay.ts`, `apps/cli/src/overlay.spec.ts`

**Interfaces:**

- Produces: `shortRef(id: string): string`;
  `resolveRef(tasks: Row[], ref: string): Row` (throws `UsageError`);
  `overlay` merges a pending `create` of an existing row for `task_occurrence`
  and `task_tag`.

- [ ] **Step 1: Write the failing tests**

`apps/cli/src/ref.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { UsageError } from './protocol.js';
import { resolveRef, shortRef } from './ref.js';

const a = { id: '0192a1b2-0000-7000-8000-00000000a111', title: 'first' };
const b = { id: '0192a1b2-0000-7000-8000-00000000b111', title: 'second' };
const tasks = [a, b];

describe('shortRef', () => {
  it('is the last six characters of the id', () => {
    expect(shortRef(a.id)).toBe('00a111');
  });
});

describe('resolveRef', () => {
  it('finds a task by its full id, case-insensitively', () => {
    expect(resolveRef(tasks, a.id.toUpperCase())).toBe(a);
  });

  it('finds a task by a unique suffix', () => {
    expect(resolveRef(tasks, 'a111')).toBe(a);
    expect(resolveRef(tasks, '0b111')).toBe(b);
  });

  it('refuses an ambiguous suffix and names the candidates', () => {
    expect(() => resolveRef(tasks, '0111')).toThrow(UsageError);
    expect(() => resolveRef(tasks, '0111')).toThrow(/00a111 first; 00b111 second/);
  });

  it('refuses a suffix that matches nothing', () => {
    expect(() => resolveRef(tasks, 'ffff')).toThrow('no task matches ffff');
  });

  it.each(['111', 'id-2', 'zzzz', ''])('refuses %j as a reference', (ref) => {
    expect(() => resolveRef(tasks, ref)).toThrow(/at least 4 hex digits/);
  });
});
```

Append to `apps/cli/src/overlay.spec.ts` inside `describe('overlay', …)`:

```ts
  // Plan C design, Q8: a create of an existing derived-id row merges on the
  // server, so the local view must merge too — an offline `done` of an
  // occurrence the replica already holds would otherwise not show.
  it('merges a pending create over an existing task occurrence', () => {
    const stored = [
      { id: 'occ', taskId: 't', occurrence: '2026-09-26', state: 'done', deletedAt: null },
    ];
    const undo = op({
      kind: 'create',
      table: 'task_occurrence',
      id: 'occ',
      fields: { taskId: 't', occurrence: '2026-09-26', state: 'open', completedAt: null },
    });
    expect(overlay('task_occurrence', stored, [undo])).toEqual([
      { ...stored[0], state: 'open', completedAt: null },
    ]);
  });

  it('still ignores a pending create of an existing task', () => {
    const again = op({ kind: 'create', fields: { title: 'replaced?' } });
    expect(overlay('task', server, [again])).toEqual(server);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/ref.spec.ts src/overlay.spec.ts`
Expected: FAIL — `./ref.js` does not resolve; the merge test gets the stored
row unchanged.

- [ ] **Step 3: Write `apps/cli/src/ref.ts`**

```ts
import { UsageError } from './protocol.js';
import type { Row } from './store.js';

/**
 * How `list` names a task: the last six characters of its id. Suffix, not
 * prefix — a UUIDv7 starts with a millisecond timestamp, so tasks created
 * minutes apart share their first characters (plan C design, Q10).
 */
export function shortRef(id: string): string {
  return id.slice(-6);
}

const REF = /^[0-9a-f-]{4,}$/i;

/**
 * The task a caller means: the full id, or the only id ending in `ref`.
 * Every miss is a usage error (exit 2) that says how to fix it, and an
 * ambiguous suffix lists the candidates rather than guessing — completing
 * the wrong task is silent damage.
 */
export function resolveRef(tasks: Row[], ref: string): Row {
  if (!REF.test(ref)) {
    throw new UsageError(
      `${JSON.stringify(ref)} is not a task id or an id suffix of at least 4 hex digits`,
    );
  }
  const wanted = ref.toLowerCase();
  const id = (task: Row): string => String(task.id).toLowerCase();
  const exact = tasks.find((task) => id(task) === wanted);
  if (exact !== undefined) return exact;
  const matches = tasks.filter((task) => id(task).endsWith(wanted));
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  if (matches.length === 0) throw new UsageError(`no task matches ${ref}`);
  const names = matches
    .map((task) => `${shortRef(String(task.id))} ${String(task.title)}`)
    .join('; ');
  throw new UsageError(
    `${ref} matches ${String(matches.length)} tasks: ${names} — give more of the id`,
  );
}
```

- [ ] **Step 4: Merge derived-id creates in `overlay.ts`**

Add above `overlay`:

```ts
/**
 * Tables whose ids are derived from a natural key (plan C design, Q2). The
 * server merges a create of an existing row field by field (Q8), so the
 * local view merges it too; for every other table a create of an existing id
 * is a duplicate and changes nothing.
 */
const DERIVED_ID_TABLES: ReadonlySet<string> = new Set([
  'task_occurrence',
  'task_tag',
]);
```

and replace the `create` branch in the loop:

```ts
    if (op.kind === 'create') {
      if (current === undefined) {
        view.set(op.id, { ...op.fields, id: op.id, deletedAt: null });
      } else if (DERIVED_ID_TABLES.has(table)) {
        view.set(op.id, { ...current, ...op.fields });
      }
    } else if (op.kind === 'set') {
```

- [ ] **Step 5: Run the CLI suite, typecheck, lint**

Run: `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint`
Expected: PASS.

Mutation checks (revert each): drop `.toLowerCase()` from `wanted` — the
full-id test must fail; remove the `else if (DERIVED_ID_TABLES…)` branch —
the merge test must fail.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/cli/src/ref.ts apps/cli/src/ref.spec.ts apps/cli/src/overlay.ts apps/cli/src/overlay.spec.ts
git commit -m "feat(cli): name tasks by id suffix and merge pending occurrence marks" \
  -m "done, skip and undo need a way to name a task that is short and stable
across syncs; a suffix is both, a prefix of a UUIDv7 is neither. A pending
mark of an occurrence the replica already holds must show at once, as the
server will merge it."
```

Tick T002.

---

### Task 3: Which occurrence is current

Implements FR-004, FR-006 (the defaults), FR-009, FR-010 (T003). Departures
1–3.

**Files:**

- Create: `apps/cli/src/occurrence.ts`, `apps/cli/src/occurrence.spec.ts`

**Interfaces:**

- Consumes: `expand` (Task 1); `parseRrule`, `Rrule` from `@todoer/specs`.
- Produces:
  - `localDate(now: Date): string`
  - `type Recurrence = { rule: Rrule; dtstart: string }`
  - `recurrenceOf(task: Row, parent: Row | undefined): Recurrence | null`
  - `type StateOf = (occurrence: string | null) => unknown`
  - `currentOccurrence(recurrence: Recurrence | null, stateOf: StateOf, today: string): { occurrence: string | null } | null`
  - `isOccurrence(recurrence: Recurrence, date: string): boolean`
  - `latestClosed(occurrences: Row[], taskId: string): { occurrence: string | null } | null`

- [ ] **Step 1: Write the failing test**

`apps/cli/src/occurrence.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  currentOccurrence,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  type Recurrence,
  type StateOf,
} from './occurrence.js';

function recurring(rrule: string, dtstart: string): Recurrence {
  const recurrence = recurrenceOf({ id: 't', rrule, dtstart }, undefined);
  if (recurrence === null) throw new Error('expected a recurrence');
  return recurrence;
}

const nothing: StateOf = () => undefined;
const closedOn =
  (...dates: string[]): StateOf =>
  (occurrence) =>
    occurrence !== null && dates.includes(occurrence) ? 'done' : undefined;

describe('localDate', () => {
  it('is the local calendar date', () => {
    expect(localDate(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('recurrenceOf', () => {
  it('is null for a task without a rule', () => {
    expect(recurrenceOf({ id: 't', rrule: null }, undefined)).toBeNull();
  });

  it("uses a subtask's parent rule (ADR 0009)", () => {
    const parent = { id: 'p', rrule: 'FREQ=DAILY', dtstart: '2026-09-01' };
    expect(recurrenceOf({ id: 's', parentId: 'p' }, parent)?.dtstart).toBe('2026-09-01');
  });

  it('refuses a rule it cannot expand', () => {
    expect(() =>
      recurrenceOf({ id: 't', rrule: 'FREQ=HOURLY', dtstart: '2026-09-01' }, undefined),
    ).toThrow(/cannot expand/);
  });
});

describe('currentOccurrence', () => {
  const daily = recurring('FREQ=DAILY', '2026-09-01');

  // Review Focus 3.
  it('collapses missed days into today', () => {
    expect(currentOccurrence(daily, nothing, '2026-09-28')).toEqual({ occurrence: '2026-09-28' });
  });

  it('moves on once today is closed', () => {
    expect(currentOccurrence(daily, closedOn('2026-09-28'), '2026-09-28')).toEqual({
      occurrence: '2026-09-29',
    });
  });

  it('skips a future occurrence already closed in advance', () => {
    expect(
      currentOccurrence(daily, closedOn('2026-09-28', '2026-09-29'), '2026-09-28'),
    ).toEqual({ occurrence: '2026-09-30' });
  });

  it('is the first occurrence when today is before dtstart', () => {
    expect(
      currentOccurrence(recurring('FREQ=WEEKLY;BYDAY=MO', '2026-10-05'), nothing, '2026-09-28'),
    ).toEqual({ occurrence: '2026-10-05' });
  });

  // Review Focus 5.
  it('is null when a rule has ended and its last occurrence is closed', () => {
    const twice = recurring('FREQ=DAILY;COUNT=2', '2026-09-01');
    expect(currentOccurrence(twice, closedOn('2026-09-02'), '2026-09-28')).toBeNull();
    expect(currentOccurrence(twice, nothing, '2026-09-28')).toEqual({ occurrence: '2026-09-02' });
  });

  it('treats a one-off task as current until it is done or skipped', () => {
    expect(currentOccurrence(null, nothing, '2026-09-28')).toEqual({ occurrence: null });
    expect(currentOccurrence(null, () => 'open', '2026-09-28')).toEqual({ occurrence: null });
    expect(currentOccurrence(null, () => 'done', '2026-09-28')).toBeNull();
    expect(currentOccurrence(null, () => 'skipped', '2026-09-28')).toBeNull();
  });
});

describe('isOccurrence', () => {
  it('is true only for a date the rule produces', () => {
    const mondays = recurring('FREQ=WEEKLY;BYDAY=MO', '2026-09-28');
    expect(isOccurrence(mondays, '2026-10-05')).toBe(true);
    expect(isOccurrence(mondays, '2026-10-06')).toBe(false);
  });
});

describe('latestClosed', () => {
  it("is the task's latest done or skipped occurrence, by date", () => {
    const rows = [
      { taskId: 't', occurrence: '2026-09-02', state: 'done' },
      { taskId: 't', occurrence: '2026-09-05', state: 'open' },
      { taskId: 't', occurrence: '2026-09-03', state: 'skipped' },
      { taskId: 'u', occurrence: '2026-09-09', state: 'done' },
    ];
    expect(latestClosed(rows, 't')).toEqual({ occurrence: '2026-09-03' });
  });

  it('is null occurrence for a done one-off task, and null when nothing is closed', () => {
    expect(latestClosed([{ taskId: 't', occurrence: null, state: 'done' }], 't')).toEqual({
      occurrence: null,
    });
    expect(latestClosed([{ taskId: 't', occurrence: null, state: 'open' }], 't')).toBeNull();
  });

  // "Notes for C1": completedAt says nothing on its own.
  it('reads state, not completedAt', () => {
    expect(
      latestClosed([{ taskId: 't', occurrence: null, state: 'open', completedAt: '2026-09-28T08:00:00Z' }], 't'),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @todoer/cli exec vitest run src/occurrence.spec.ts`
Expected: FAIL — `./occurrence.js` does not resolve.

- [ ] **Step 3: Write `apps/cli/src/occurrence.ts`**

```ts
import { parseRrule, type Rrule } from '@todoer/specs';
import { expand } from './expand.js';
import type { Row } from './store.js';

const DAY_MS = 86_400_000;
/** How far ahead the next open occurrence is looked for. */
// ponytail: ten years; a rule sparser than that shows as ended.
const HORIZON_DAYS = 3660;
/** How many upcoming occurrences are checked for one that is still open. */
const LOOKAHEAD = 100;
const CLOSED: ReadonlySet<unknown> = new Set(['done', 'skipped']);

/** The caller's calendar date, `YYYY-MM-DD` — local, not UTC (ADR 0010). */
export function localDate(now: Date): string {
  const pad = (n: number, width: number): string =>
    String(n).padStart(width, '0');
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export type Recurrence = { rule: Rrule; dtstart: string };

/**
 * A task's rule and anchor — its own, or its parent's for a subtask, which
 * lives on the parent's occurrence axis (ADR 0009). `null` for a one-off
 * task. The server refuses a rule it cannot parse (plan C2), so one arriving
 * here is a bug worth failing loudly on, not a task to show wrongly.
 */
export function recurrenceOf(
  task: Row,
  parent: Row | undefined,
): Recurrence | null {
  const isSubtask = task.parentId !== null && task.parentId !== undefined;
  const owner = isSubtask && parent !== undefined ? parent : task;
  const { rrule, dtstart } = owner;
  if (rrule === null || rrule === undefined) return null;
  if (typeof rrule !== 'string' || typeof dtstart !== 'string') {
    throw new Error(
      `task ${String(owner.id)} has a rule without a readable dtstart`,
    );
  }
  const parsed = parseRrule(rrule);
  if (!parsed.ok) {
    throw new Error(
      `task ${String(owner.id)} has a rule this client cannot expand: ${parsed.error}`,
    );
  }
  return { rule: parsed.rule, dtstart };
}

/** A task occurrence's `state` for one date (`null`: a one-off task), or
 *  `undefined` when there is no row. */
export type StateOf = (occurrence: string | null) => unknown;

/**
 * The occurrence `list` shows and `done`/`skip` act on (plan C design, Q11):
 * the latest one on or before today while it is open, otherwise the first
 * open one after today (plan C1, departure 2). `null` when there is none — a
 * one-off task done or skipped, or a rule that has run out.
 */
export function currentOccurrence(
  recurrence: Recurrence | null,
  stateOf: StateOf,
  today: string,
): { occurrence: string | null } | null {
  if (recurrence === null) {
    return CLOSED.has(stateOf(null)) ? null : { occurrence: null };
  }
  const { rule, dtstart } = recurrence;
  const latest = expand(rule, dtstart, dtstart, today).at(-1);
  if (latest !== undefined && !CLOSED.has(stateOf(latest))) {
    return { occurrence: latest };
  }
  const next = expand(
    rule,
    dtstart,
    addDays(today, 1),
    addDays(today, HORIZON_DAYS),
    LOOKAHEAD,
  ).find((occurrence) => !CLOSED.has(stateOf(occurrence)));
  return next === undefined ? null : { occurrence: next };
}

/** Whether the rule produces `date` — what `--on` must name. */
export function isOccurrence(recurrence: Recurrence, date: string): boolean {
  return (
    expand(recurrence.rule, recurrence.dtstart, date, date).length === 1
  );
}

/**
 * What a plain `undo` reopens: the task's latest done or skipped occurrence
 * by date (plan C1, departure 1). Read from `state` alone — a `completedAt`
 * can outlive the state that set it under per-field LWW ("Notes for C1").
 */
export function latestClosed(
  occurrences: Row[],
  taskId: string,
): { occurrence: string | null } | null {
  const closed = occurrences
    .filter((row) => row.taskId === taskId && CLOSED.has(row.state))
    .map((row) => (typeof row.occurrence === 'string' ? row.occurrence : null))
    .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const last = closed.at(-1);
  return last === undefined ? null : { occurrence: last };
}
```

- [ ] **Step 4: Run the CLI suite, typecheck, lint**

Run: `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint`
Expected: PASS.

Mutation checks (revert each): in `currentOccurrence` replace the `.find(…)`
with `[0]` — "skips a future occurrence already closed" must fail; make
`recurrenceOf` always use `task` — the subtask test must fail; add
`'open'` to `CLOSED` — the one-off test must fail.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/cli/src/occurrence.ts apps/cli/src/occurrence.spec.ts
git commit -m "feat(cli): decide which occurrence of a task is current" \
  -m "list shows each task once and done acts on one date, so the client
needs one rule for which date that is: today's while open, else the next open
one. undo needs the opposite: the latest closed one."
```

Tick T003.

---

### Task 4: `add --rrule/--from`, and one submit path for every write

Implements FR-002, FR-007's exit-code half (T004).

**Files:**

- Modify: `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts`

**Interfaces:**

- Consumes: `localDate` (Task 3); `parseRrule`, `isIsoDate` from
  `@todoer/specs`.
- Produces (module-private in `run.ts`, used by Task 5):
  - `takeOption(args: string[], name: string): { value: string | undefined; rest: string[] }`
  - `submit(store: Store, send: Transport, op: OpCreate, command: string): Promise<boolean>`
    — enqueue, flush, read the own outcome; returns `synced`; throws
    `RefusalError`/`ConflictError` like `add` did.

- [ ] **Step 1: Write the failing tests**

Append to `describe('run', …)` in `run.spec.ts`:

```ts
  describe('add --rrule', () => {
    function queuedFields(d: Deps): Record<string, unknown> {
      const [op] = d.store.pending();
      if (op?.kind !== 'create') throw new Error('expected a queued create');
      return op.fields;
    }

    it('queues the rule with --from as dtstart', async () => {
      const d = deps(unreachable);
      await run(['add', 'stand-up', '--rrule', 'FREQ=WEEKLY;BYDAY=MO', '--from', '2026-09-28'], d);
      expect(queuedFields(d)).toMatchObject({
        title: 'stand-up',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        dtstart: '2026-09-28',
      });
    });

    it('anchors the rule today when --from is absent', async () => {
      const d = deps(unreachable);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      expect(queuedFields(d)).toMatchObject({ dtstart: '2026-09-26' });
    });

    // Review Focus 4.
    it('keeps an option-looking word inside a quoted title', async () => {
      const d = deps(unreachable);
      await run(['add', 'fix --rrule parsing'], d);
      expect(queuedFields(d)).toMatchObject({ title: 'fix --rrule parsing' });
      expect(queuedFields(d)).not.toHaveProperty('rrule');
    });

    it.each([
      [['--rrule', 'FREQ=DAILY;BYHOUR=9'], /--rrule: BYHOUR is not supported/],
      [['--rrule', 'FREQ=DAILY', '--from', '2026-02-30'], /--from must be a date/],
      [['--from', '2026-09-28'], /--from needs --rrule/],
      [['--rrule'], /--rrule needs a value/],
      [['--rrule', 'FREQ=DAILY', '--rrule', 'FREQ=WEEKLY'], /--rrule given twice/],
    ])('refuses %j and queues nothing', async (flags, reason) => {
      const d = deps(unreachable);
      const attempt = run(['add', 'x', ...flags], d);
      await expect(attempt).rejects.toThrow(UsageError);
      await expect(run(['add', 'x', ...flags], d)).rejects.toThrow(reason);
      expect(d.store.pending()).toEqual([]);
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/run.spec.ts -t "add --rrule"`
Expected: FAIL — the flags end up in the title; no `rrule` field.

- [ ] **Step 3: Implement**

In `run.ts` add the imports:

```ts
import { isIsoDate, parseRrule, type OpCreate } from '@todoer/specs';
import { localDate } from './occurrence.js';
```

(remove the old `import type { OpCreate } …` line). Add, below `UNREACHED`:

```ts
/**
 * Pulls `name <value>` out of argv. An option is a whole argument, never a
 * substring: `add "fix --rrule parsing"` arrives as one argument and stays
 * the title (plan C1, Review Focus 4).
 */
function takeOption(
  args: string[],
  name: string,
): { value: string | undefined; rest: string[] } {
  const at = args.indexOf(name);
  if (at === -1) return { value: undefined, rest: args };
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${name} needs a value`);
  }
  if (args.indexOf(name, at + 2) !== -1) {
    throw new UsageError(`${name} given twice`);
  }
  return { value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

/** The recurrence fields `add` sends, checked before anything is queued
 *  (plan C design, Q9). */
function planRecurrence(
  rrule: string | undefined,
  from: string | undefined,
  today: string,
): Record<string, string> {
  if (rrule === undefined) {
    if (from !== undefined) throw new UsageError('--from needs --rrule');
    return {};
  }
  const parsed = parseRrule(rrule);
  if (!parsed.ok) throw new UsageError(`--rrule: ${parsed.error}`);
  const dtstart = from ?? today;
  if (!isIsoDate(dtstart)) {
    throw new UsageError('--from must be a date, YYYY-MM-DD');
  }
  return { rrule, dtstart };
}
```

Replace the whole `if (command === 'add') { … }` branch with:

```ts
  if (command === 'add') {
    const rrule = takeOption(rest, '--rrule');
    const from = takeOption(rrule.rest, '--from');
    const recurrence = planRecurrence(
      rrule.value,
      from.value,
      localDate(deps.now()),
    );
    // Refuses an empty title and reports what it is not storing — see planAdd.
    const { title, priority, notice } = planAdd(from.rest.join(' '));
    if (notice !== null) stderr.push(notice);
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task',
      id: deps.newId(),
      fields: { title, priority, rank: 'a0', ...recurrence },
      ts: deps.now().toISOString(),
    };
    synced = await submit(store, deps.send, op, 'add');
    data = tasks(store).find((row) => row.id === op.id) ?? null;
    human = [title];
```

Move the old branch's body (enqueue → flushOwn → ownOutcome → entry check)
into a new function below `run`, unchanged apart from the parameters:

```ts
/**
 * Queues one operation the running command minted and sends it: stored
 * before it is sent, so every attempt carries its id (ADR 0015 §4). Returns
 * whether the server has it; throws when the server refused it or holds a
 * newer version. The one write path for add, done, skip and undo.
 */
async function submit(
  store: Store,
  send: Transport,
  op: OpCreate,
  command: string,
): Promise<boolean> {
  store.enqueue(op);
  const flushed = await flushOwn(store, send, op.opId, command);
  // Evaluated unconditionally, never short-circuited on `flushed.synced`:
  // a batch-refused own op is removed from the outbox (I1) even when the
  // follow-up pull that reports it is itself unreached, and that
  // rejection must still throw rather than be reported as "queued".
  let own = ownOutcome(flushed.results, op.opId);
  if (own === 'unreported' && flushed.synced) {
    // A parallel invocation may have sent it between the enqueue and this
    // flush's read of the outbox; its entry says what became of it.
    const entry = store.entry(op.opId);
    if (entry === undefined) own = 'settled';
    else if (entry.status === 'failed') {
      store.remove(op.opId);
      throw new RefusalError(
        entry.reason ?? 'the server refused this operation',
      );
    }
  }
  return flushed.synced && own === 'settled';
}
```

and give `flushOwn` the command name for its message:

```ts
async function flushOwn(
  store: Store,
  send: Transport,
  opId: string,
  command: string,
) {
  …
      throw new RefusalError(
        `${error.message} — this command's operation ${opId} is queued and will be sent once the request is accepted — do not run ${command} again for it`,
      );
```

- [ ] **Step 4: Run the CLI suite, typecheck, lint**

Run: `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint`
Expected: PASS — including the existing "keeps the add queued when the token
is refused" (its message still reads "do not run add again").

Mutation check: in `takeOption` replace `args.indexOf(name)` with
`args.findIndex((a) => a.includes(name))` — Review Focus 4 must fail.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/cli/src/run.ts apps/cli/src/run.spec.ts
git commit -m "feat(cli): add recurring tasks with --rrule and --from" \
  -m "Agents write an RRULE more reliably than they guess which English a
parser accepts (plan C design, Q9), so recurrence enters as raw flags,
checked by the shared parser before anything is queued. The submit path moves
out of add because done, skip and undo need exactly the same exit rules."
```

Tick T004.

---

### Task 5: `list` with references and dates; `done`, `skip`, `undo`

Implements FR-003, FR-006, FR-007, FR-009, FR-010 at the command level
(T005). Departure 5.

**Files:**

- Modify: `apps/cli/src/run.ts`, `apps/cli/src/run.spec.ts`

**Interfaces:**

- Consumes: `expand` indirectly; `currentOccurrence`, `isOccurrence`,
  `latestClosed`, `localDate`, `recurrenceOf`, `Recurrence`, `StateOf`
  (Task 3); `resolveRef`, `shortRef` (Task 2); `takeOption`, `submit`
  (Task 4); `taskOccurrenceId`, `isIsoDate` from `@todoer/specs`.
- Produces: commands `done|skip|undo <ref> [--on YYYY-MM-DD] [--json]`;
  `list` lines `<ref>  <priority>  <title>[  <date>]`, `--json` rows with
  `ref` and `occurrence`.

- [ ] **Step 1: Update the fake server and the two plain-text list tests**

In `run.spec.ts`, `fakeServer` must merge a create of an existing
`task_occurrence` (plan C2 does). Replace its `results` computation with:

```ts
    const results = request.ops.map((op) => {
      const existing = rows.get(op.id);
      if (op.kind === 'create' && existing === undefined) {
        rows.set(op.id, {
          table: op.table,
          id: op.id,
          seq: ++seq,
          row: { ...op.fields, id: op.id, deletedAt: null },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      if (op.kind === 'create' && op.table === 'task_occurrence' && existing !== undefined) {
        rows.set(op.id, { ...existing, seq: ++seq, row: { ...existing.row, ...op.fields } });
        return { opId: op.opId, status: 'applied' as const };
      }
      return { opId: op.opId, status: 'duplicate' as const };
    });
```

Change the two plain-text assertions to the new line format:
`expect(out.stdout).toEqual(['id-2  1  offline task']);` and
`expect((await run(['list'], d)).stdout).toEqual(['id-2  2  call the bank']);`

Add a second deps helper next to `deps`, with ids a reference can name:

```ts
/** Like deps, with ids shaped like UUIDs so a suffix can name them:
 *  the first task is …000000000002 (op ids take the odd numbers). */
function hexDeps(send: Transport): Deps {
  const d = deps(send);
  let n = 0;
  d.newId = () => `0192a1b2-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  return d;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `describe('run', …)`:

```ts
  describe('recurrence and marks', () => {
    const TASK = '0192a1b2-0000-7000-8000-000000000002';

    async function lines(d: Deps): Promise<string[]> {
      return (await run(['list'], d)).stdout;
    }

    // Scenario 1.
    it('lists a recurring task at today with its reference', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      expect(await lines(d)).toEqual(['000002  0  water the plants  2026-09-26']);
    });

    // Scenario 2 and Review Focus 1.
    it('moves on after done, and undo reopens the same day', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);

      const done = await run(['done', '0002', '--json'], d);
      expect(done.exit).toBe(0);
      expect(envelope(done.stdout)).toMatchObject({
        data: {
          taskId: TASK,
          occurrence: '2026-09-26',
          state: 'done',
          completedAt: '2026-09-26T10:00:00.000Z',
        },
      });
      expect(await lines(d)).toEqual(['000002  0  water the plants  2026-09-27']);

      await run(['undo', '0002'], d);
      expect(await lines(d)).toEqual(['000002  0  water the plants  2026-09-26']);
    });

    it('queues a create of the derived task occurrence', async () => {
      const d = hexDeps(unreachable);
      await run(['add', 'x', '--rrule', 'FREQ=DAILY'], d);
      await run(['skip', '0002'], d);
      expect(d.store.pending().at(-1)).toMatchObject({
        kind: 'create',
        table: 'task_occurrence',
        id: taskOccurrenceId(TASK, '2026-09-26'),
        fields: { taskId: TASK, occurrence: '2026-09-26', state: 'skipped', completedAt: null },
      });
    });

    // Scenario 3.
    it('hides a one-off task once done and shows it again after undo', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'file taxes'], d);
      await run(['done', '000002'], d);
      expect(await lines(d)).toEqual([]);
      await run(['undo', '000002'], d);
      expect(await lines(d)).toEqual(['000002  0  file taxes']);
    });

    // Scenario 4 and Review Focus 2.
    it('marks offline, exits 5, and list already shows it', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      d.send = unreachable;
      expect((await run(['done', '0002'], d)).exit).toBe(5);
      expect(await lines(d)).toEqual(['000002  0  water the plants  2026-09-27']);
      await run(['undo', '0002'], d);
      expect(await lines(d)).toEqual(['000002  0  water the plants  2026-09-26']);
    });

    // Scenario 5 and Review Focus 3.
    it('lists a daily task missed for days once, at today', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'stretch', '--rrule', 'FREQ=DAILY', '--from', '2026-09-20'], d);
      expect(await lines(d)).toEqual(['000002  0  stretch  2026-09-26']);
    });

    it('marks a named occurrence with --on', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'stand-up', '--rrule', 'FREQ=WEEKLY;BYDAY=MO', '--from', '2026-09-28'], d);
      await run(['done', '0002', '--on', '2026-10-05'], d);
      expect(await lines(d)).toEqual(['000002  0  stand-up  2026-09-28']);
      await run(['done', '0002'], d);
      expect(await lines(d)).toEqual(['000002  0  stand-up  2026-10-12']);
    });

    // Review Focus 5.
    it('refuses done without --on once the rule has run out', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'twice', '--rrule', 'FREQ=DAILY;COUNT=1', '--from', '2026-09-20'], d);
      await run(['done', '0002'], d);
      expect(await lines(d)).toEqual([]);
      await expect(run(['done', '0002'], d)).rejects.toThrow(/no open occurrence left/);
    });

    it.each([
      [['done', '0002', '--on', '2026-09-27'], /2026-09-27 is not an occurrence/],
      [['done', '0002', '--on', 'soon'], /--on must be a date/],
      [['done'], /needs exactly one task id/],
      [['done', '0002', '0002'], /needs exactly one task id/],
      [['done', 'ffff'], /no task matches ffff/],
    ])('refuses %j with exit 2 and queues nothing', async (argv, reason) => {
      const d = hexDeps(unreachable);
      await run(['add', 'weekly', '--rrule', 'FREQ=WEEKLY;BYDAY=MO', '--from', '2026-09-28'], d);
      const before = d.store.pending().length;
      await expect(run(argv, d)).rejects.toThrow(UsageError);
      await expect(run(argv, d)).rejects.toThrow(reason);
      expect(d.store.pending()).toHaveLength(before);
    });

    it('refuses --on for a one-off task, and undo with nothing to undo', async () => {
      const d = hexDeps(unreachable);
      await run(['add', 'once'], d);
      await expect(run(['done', '0002', '--on', '2026-09-26'], d)).rejects.toThrow(
        /--on is only for recurring tasks/,
      );
      await run(['add', 'daily', '--rrule', 'FREQ=DAILY'], d);
      await expect(run(['undo', '0004'], d)).rejects.toThrow(/nothing to undo/);
    });

    // FR-009: a task occurrence whose task this replica does not hold.
    it('ignores a task occurrence whose task is absent', async () => {
      const d = hexDeps(fakeServer().send);
      d.store.mergeChanges([
        {
          table: 'task_occurrence',
          id: 'orphan',
          seq: 1,
          row: { id: 'orphan', taskId: 'gone', occurrence: null, state: 'done', deletedAt: null },
        },
      ]);
      await run(['add', 'file taxes'], d);
      expect(await lines(d)).toEqual(['000002  0  file taxes']);
    });

    // FR-010, ADR 0009: a subtask lives on its parent's occurrence axis.
    it("lists a subtask at its parent's occurrence and marks it there", async () => {
      const d = hexDeps(unreachable);
      d.store.mergeChanges([
        {
          table: 'task',
          id: 'parent-0000-00aaaa',
          seq: 1,
          row: { id: 'parent-0000-00aaaa', title: 'clean the kitchen', priority: 0, rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2026-09-21', parentId: null, deletedAt: null },
        },
        {
          table: 'task',
          id: 'child-00000-00bbbb',
          seq: 2,
          row: { id: 'child-00000-00bbbb', title: 'dishes', priority: 0, rrule: null, dtstart: null, parentId: 'parent-0000-00aaaa', deletedAt: null },
        },
      ]);
      expect(await lines(d)).toEqual([
        '00aaaa  0  clean the kitchen  2026-09-21',
        '00bbbb  0  dishes  2026-09-21',
      ]);
      await run(['done', 'bbbb'], d);
      expect(d.store.pending().at(-1)).toMatchObject({
        id: taskOccurrenceId('child-00000-00bbbb', '2026-09-21'),
        fields: { taskId: 'child-00000-00bbbb', occurrence: '2026-09-21' },
      });
    });
  });
```

Add `import { taskOccurrenceId } from '@todoer/specs';` at the top of
`run.spec.ts`.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @todoer/cli exec vitest run src/run.spec.ts`
Expected: FAIL — `unknown command: done`; list lines without references.

- [ ] **Step 4: Implement**

Extend the imports of `run.ts`:

```ts
import {
  isIsoDate,
  parseRrule,
  taskOccurrenceId,
  type OpCreate,
} from '@todoer/specs';
import {
  currentOccurrence,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  type Recurrence,
  type StateOf,
} from './occurrence.js';
import { resolveRef, shortRef } from './ref.js';
```

Add below `planRecurrence`:

```ts
/** What each marking command writes into `state` (plan C design, Q4). */
const MARK = { done: 'done', skip: 'skipped', undo: 'open' } as const;
type Mark = keyof typeof MARK;

function isMark(command: string | undefined): command is Mark {
  return command === 'done' || command === 'skip' || command === 'undo';
}

/** A listed task: the row, its reference, and the date it is due (`null`
 *  for a one-off task). */
type Due = Row & { ref: string; occurrence: string | null };
```

Replace the `list` branch and add the marking branch right after it:

```ts
  } else if (command === 'list') {
    ({ synced } = await flush(store, deps.send));
    const rows = due(store, localDate(deps.now()));
    data = rows;
    human = rows.map((row) =>
      [
        row.ref,
        String(row.priority),
        String(row.title),
        ...(row.occurrence === null ? [] : [row.occurrence]),
      ].join('  '),
    );
  } else if (isMark(command)) {
    const on = takeOption(rest, '--on');
    const [ref, ...extra] = on.rest;
    if (ref === undefined || extra.length > 0) {
      throw new UsageError(`${command} needs exactly one task id or id suffix`);
    }
    // Resolved against what this client can see, before anything is sent:
    // like every write, a mark works offline.
    const all = tasks(store);
    const task = resolveRef(liveTasks(all), ref);
    const taskId = String(task.id);
    const marks = occurrences(store);
    const occurrence = pickOccurrence(
      command,
      recurrenceOf(task, parentOf(all, task)),
      on.value,
      localDate(deps.now()),
      marks,
      taskId,
    );
    const now = deps.now().toISOString();
    const op: OpCreate = {
      opId: deps.newId(),
      kind: 'create',
      table: 'task_occurrence',
      id: taskOccurrenceId(taskId, occurrence),
      fields: {
        taskId,
        occurrence,
        state: MARK[command],
        completedAt: command === 'done' ? now : null,
      },
      ts: now,
    };
    synced = await submit(store, deps.send, op, command);
    data = occurrences(store).find((row) => row.id === op.id) ?? null;
    human = [
      [command, String(task.title), ...(occurrence === null ? [] : [occurrence])].join('  '),
    ];
  } else if (command === 'outbox' && rest[0] === 'drop') {
```

Add below `tasks()` at the end of the file:

```ts
function occurrences(store: Store): Row[] {
  return overlay('task_occurrence', store.rows('task_occurrence'), store.pending());
}

function parentOf(all: Row[], task: Row): Row | undefined {
  return typeof task.parentId === 'string'
    ? all.find((row) => row.id === task.parentId)
    : undefined;
}

/**
 * One task's occurrence states, from `state` alone ("Notes for C1"). Only
 * rows naming this task are read, so a task occurrence whose task is
 * tombstoned or absent never affects anything (FR-009).
 */
// ponytail: a linear scan per lookup; index by task id if lists grow long.
function stateOf(marks: Row[], taskId: string): StateOf {
  return (occurrence) =>
    marks.find(
      (row) => row.taskId === taskId && (row.occurrence ?? null) === occurrence,
    )?.state;
}

/** Each live task once, at its current occurrence (plan C design, Q11). */
function due(store: Store, today: string): Due[] {
  const all = tasks(store);
  const marks = occurrences(store);
  return liveTasks(all).flatMap((task) => {
    const taskId = String(task.id);
    const current = currentOccurrence(
      recurrenceOf(task, parentOf(all, task)),
      stateOf(marks, taskId),
      today,
    );
    return current === null
      ? []
      : [{ ...task, ref: shortRef(taskId), occurrence: current.occurrence }];
  });
}

/**
 * The date a mark applies to. `--on` names one the rule produces; otherwise
 * `done`/`skip` take the current occurrence and `undo` the latest closed one
 * (plan C1, departure 1). Every refusal is a usage error: nothing is queued.
 */
function pickOccurrence(
  command: Mark,
  recurrence: Recurrence | null,
  on: string | undefined,
  today: string,
  marks: Row[],
  taskId: string,
): string | null {
  if (recurrence === null) {
    if (on !== undefined) {
      throw new UsageError('--on is only for recurring tasks');
    }
    if (command === 'undo' && latestClosed(marks, taskId) === null) {
      throw new UsageError('nothing to undo: this task is not done or skipped');
    }
    return null;
  }
  if (on !== undefined) {
    if (!isIsoDate(on)) throw new UsageError('--on must be a date, YYYY-MM-DD');
    if (!isOccurrence(recurrence, on)) {
      throw new UsageError(`${on} is not an occurrence of this task`);
    }
    return on;
  }
  if (command === 'undo') {
    const last = latestClosed(marks, taskId);
    if (last === null) {
      throw new UsageError(
        'nothing to undo: no occurrence of this task is done or skipped',
      );
    }
    return last.occurrence;
  }
  const current = currentOccurrence(recurrence, stateOf(marks, taskId), today);
  if (current === null) {
    throw new UsageError(
      'this task has no open occurrence left — name one with --on',
    );
  }
  return current.occurrence;
}
```

Update the doc comment above `run` to mention the new commands ("add, done,
skip and undo each queue one operation through `submit`").

- [ ] **Step 5: Run the CLI suite, typecheck, lint**

Run: `pnpm --filter @todoer/cli test && pnpm --filter @todoer/cli typecheck && pnpm --filter @todoer/cli lint`
Expected: PASS.

Mutation checks (revert each): make `undo` use `currentOccurrence` like
`done` — "undo reopens the same day" must fail; drop `row.taskId === taskId &&`
in `stateOf` — "ignores a task occurrence whose task is absent" must fail;
pass `undefined` instead of `parentOf(all, task)` in `due` — the subtask test
must fail.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/cli/src/run.ts apps/cli/src/run.spec.ts
git commit -m "feat(cli): list what is due and mark occurrences done, skipped or open" \
  -m "The server has stored task occurrences since C2 and no client wrote
one; a task could be created and never finished. Each mark is one create of
the derived task occurrence, so offline marks, retries and two devices all
converge through the server's merge."
```

Tick T005.

---

### Task 6: HELP, README, walking skeleton, design departures

Implements FR-011 (T006). No unit test for prose; the walking skeleton is the
end-to-end check, and a reviewer reads every changed sentence against the
code.

**Files:**

- Modify: `apps/cli/src/usage.ts`, `apps/cli/src/usage.spec.ts`,
  `README.md`, `scripts/walking-skeleton.sh`,
  `docs/specs/2026-09-26-plan-c-recurrence-design.md`

- [ ] **Step 1: HELP**

In `usage.ts`, replace the `usage:` block with:

```text
usage:
  todoer add "<text>" [--rrule <RRULE> [--from YYYY-MM-DD]] [--json]
                                          create a task; with --rrule it recurs
                                          from --from (default: today)
  todoer list [--json]                    what is open now: each task once, a
                                          recurring one at its current date
  todoer done <ref> [--on YYYY-MM-DD] [--json]   mark done
  todoer skip <ref> [--on YYYY-MM-DD] [--json]   mark skipped
  todoer undo <ref> [--on YYYY-MM-DD] [--json]   reopen (default: the latest
                                          done or skipped occurrence)
  todoer outbox [--json]                  list operations the server has not accepted
  todoer outbox drop <op-id>... [--json]  forget failed operations
  todoer --help
```

and add, before `quick-add markers:`:

```text
references:
  list starts each line with the last 6 characters of the task's id. done,
  skip and undo take the full id or any unique ending of it, at least 4 hex
  digits — an ending, not a beginning: ids start with a timestamp.

recurrence:
  --rrule takes an RFC 5545 rule, restricted to FREQ (DAILY, WEEKLY,
  MONTHLY, YEARLY), INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, COUNT,
  UNTIL (YYYYMMDD) and WKST; upper case. No times of day. A recurring task
  is listed at the latest date on or before today that is still open, else
  at the next open one; missed dates before it are not listed. done and
  skip act on that date, or on --on's.
```

In the exit-code text for 4, replace "No command sends an operation that can
return one yet: add sends a create, and a create never conflicts" with "No
command sends an operation that can return one yet: add, done, skip and undo
each send a create, and a create never conflicts". Replace "add is safe to
run once" (the paragraph after the exit codes) with "Every write is safe to
run once".

Append to `usage.spec.ts`:

```ts
  it('documents references, recurrence and the marking commands', () => {
    expect(HELP).toMatch(/todoer done <ref>/);
    expect(HELP).toMatch(/todoer undo <ref>/);
    expect(HELP).toMatch(/--rrule <RRULE>/);
    expect(HELP).toMatch(/last 6 characters/);
  });
```

- [ ] **Step 2: README**

In "What works today", change the CLI bullet's first line to
"**`todoer add` / `list` / `done` / `skip` / `undo` / `outbox`**" and add one
sentence: "Recurring tasks are created with `--rrule` and listed at their
current date; `done`, `skip` and `undo` take the short reference `list`
prints." In the "Not built yet" paragraph, remove "recurrence," (keep
`#project`/`@tag` and the web/Flutter clients).

- [ ] **Step 3: Walking skeleton**

In `scripts/walking-skeleton.sh`, replace everything from
`if printf '%s' "$OUT" | grep -qF "$TITLE"; then` to the end with:

```sh
printf '%s' "$OUT" | grep -qF "$TITLE" || {
  echo 'FAIL: the task did not reach the second client' >&2
  printf '%s\n' "$OUT" >&2
  exit 1
}

# Recurrence (plan C1): a daily task marked done in one replica shows at
# another date in the second, through the server alone. `date +%Y-%m-%d` is
# the same local date the CLI calls today.
RTITLE="recurring $(date +%s)"
TODAY=$(date +%Y-%m-%d)
ADDED=$(HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js add "$RTITLE" --rrule FREQ=DAILY --json)
RID=$(printf '%s' "$ADDED" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$RID" ] || { echo "FAIL: add --json printed no id: $ADDED" >&2; exit 1; }
HOME="$WRITER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js done "$RID" >/dev/null
LINE=$(HOME="$READER" TODOER_TOKEN="$TOKEN" node apps/cli/dist/index.js list | grep -F "$RTITLE" || true)
case $LINE in
  '') echo 'FAIL: the recurring task did not reach the second client' >&2; exit 1 ;;
  *"$TODAY"*) echo "FAIL: the second client still shows today's date: $LINE" >&2; exit 1 ;;
esac

echo 'walking skeleton passed'
```

(`|| true` because a failing command substitution in an assignment trips
`set -e`; the empty-line case reports it instead.)

Run it: start the backend as README "Running it" says (migrations applied to
the dev database: `DATABASE_URL=…/todoer pnpm --filter @todoer/backend exec
prisma migrate deploy`), build the CLI (`pnpm --filter @todoer/cli build`),
then `sh scripts/walking-skeleton.sh`. Expected: `walking skeleton passed`.
Also run it with `dash scripts/walking-skeleton.sh` if `dash` is installed.

- [ ] **Step 4: Design departures**

In `docs/specs/2026-09-26-plan-c-recurrence-design.md` add, after
"Departures in plan C2", a section `## Departures in plan C1` with one bullet
per departure at the top of this plan, linking to
`../plans/2026-09-28-plan-c1-cli-recurrence.md#where-this-plan-departs-from-the-design-doc`.
Close the open thread on missed occurrences: "`--on` is the only way to reach
a missed occurrence in C1; a listing of them is left to a later client."
In "Deferred", replace the "Subtask completion in the CLI" bullet with a
sentence saying C1 reads a subtask on its parent's axis (departure 3); the
CLI still cannot create one.

- [ ] **Step 5: Stale-claim sweep, full gates, commit**

```bash
ugrep -rn -i -e 'recurrence' -e 'not built' -e 'add sends a create' README.md apps/cli/src/usage.ts docs/adr/0015-the-cli-is-a-client-for-automation.md
pnpm -w exec turbo run build typecheck test
pnpm lint
```

Resolve every hit that is now untrue. Then:

```bash
pnpm format
git add apps/cli/src/usage.ts apps/cli/src/usage.spec.ts README.md scripts/walking-skeleton.sh docs/specs/2026-09-26-plan-c-recurrence-design.md
git commit -m "docs: document recurrence in the CLI and prove it end to end" \
  -m "HELP and the README still said the CLI could only add and list, and
nothing ran a recurring task through two real replicas. The walking skeleton
now marks a daily task done in one and checks the other moved on."
```

Tick T006. Closing the task (move to `done/`, changelog, PR) follows the
final review.
