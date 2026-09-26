# Plan C2: Task Occurrences, Deterministic Ids and Rule Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the server can record that a task was done or skipped on an
occurrence, converges when two offline devices disagree about it, refuses a
recurrence rule no client can expand, and keeps pruning working once those
rows are never deleted.

**Architecture:** `@todoer/specs` starts shipping three small runtime modules
(date check, rule parser, UUIDv5 id derivation) and two test-vector files. The
backend gains one synced table, `TaskOccurrence`, and moves `TaskTag` to the
same pattern: the id is UUIDv5 of the natural key, the server recomputes it,
a `create` of an existing id merges field by field under the existing LWW, and
the row is toggled with `set`, never deleted. Its children cascade when a
tombstoned task or tag is pruned. Every applied task row is checked against
the rule parser, `dtstart` and the two-level rule of ADR 0009.

**Tech Stack:** NestJS 11, Prisma 6.19, PostgreSQL 18, Vitest 5, tsup,
`node:crypto`. No new runtime dependencies; `@todoer/specs` gains `vitest` and
`@types/node` as dev dependencies, both already used by the other two
workspaces.

**Spec:** [`docs/specs/2026-09-26-plan-c-recurrence-design.md`](../specs/2026-09-26-plan-c-recurrence-design.md)
— the C2 half. Read "Locked decisions" in full and the routine choice on Q5
before Task 1. Background: ADR 0002, 0004, 0005, 0006, 0009, 0010, 0013, and
sections 2–4 of
[`docs/specs/2026-09-25-domain-and-sync-design.md`](../specs/2026-09-25-domain-and-sync-design.md).
The task spec is
[`specs/tasks/active/T-2026-09-26-task-occurrence.md`](../../specs/tasks/active/T-2026-09-26-task-occurrence.md).

## Where this plan departs from the design doc

Task 8 writes each of these back into the design doc.

1. **A `create` that wins on no field answers `superseded`, not `applied`.**
   The design says the merge "answers `applied`". When every field in the
   create is older than what the row holds, nothing changed; `superseded` is
   the honest outcome, and it is the one a `set` in the same position already
   returns. Clients treat both as settled.
2. **`value` is `Float`, not `decimal`.** Prisma returns `Decimal` as an object
   that `JSON.stringify` turns into a string, so a decimal column would reach
   clients as `"2.5"`. A habit quantity does not need exact decimal
   arithmetic.
3. **TaskTag's flag is `attached Boolean @default(true)`.** The design left
   `attached` vs `detached_at` open; a boolean mirrors `state` and needs no
   clock.
4. **A snapshot omits children of a tombstoned parent.** The design says
   clients treat them as gone. A snapshot omits tombstones, so without this it
   would deliver task occurrences and TaskTag rows whose task or tag the
   client is never told about.
5. **Date columns are fixed first.** Verified while planning: Prisma rejects a
   bare `YYYY-MM-DD` for a `@db.Date` column (`PrismaClientValidationError`,
   "premature end of input. Expected ISO-8601 DateTime"), so `scheduledOn`,
   `dueOn` and `dtstart` cannot be written through `/sync` today, and a read
   returns `2026-09-28T00:00:00.000Z`. `occurrence` is a date and the id
   derivation hashes it, so this has to work before anything else.
6. **The parser is strict about case.** RFC 5545 is case-insensitive;
   `parseRrule` accepts upper case only. One spelling per rule keeps two
   stored strings for the same rule from looking different.
7. **`state` is a `String`, checked in code, not a Postgres enum.** Same as
   `AppliedOp.status`; a Postgres enum needs its own migration for every new
   value.
8. **TaskTag's `@@unique([taskId, tagId])` becomes two plain indexes.** The
   derived id is the uniqueness rule (Q7); the indexes keep the cascade and
   the lookups by task or tag cheap.

## Global Constraints

- **Spec first.** `packages/specs/openapi/openapi.yaml` changes before the
  backend does; `pnpm spec:validate && pnpm spec:codegen`; generated artefacts
  land in their own commit.
- **Id namespace:** `40e49f07-6ce6-46fc-b2de-65dd46253bf2`. Frozen.
- **Id names:** task occurrence `<task_id>:<YYYY-MM-DD>` or `<task_id>:` for a
  null occurrence; TaskTag `<task_id>:<tag_id>`; ids lower-cased before
  hashing.
- **Deterministic-id tables:** `task_occurrence`, `task_tag`. Nothing else.
- **States:** `open`, `done`, `skipped`. `open` is what undo writes.
- **Dates on the wire:** `YYYY-MM-DD`, nothing else, both directions.
- **The server never expands a rule.** It parses it; it never checks that an
  occurrence belongs to it.
- **Trap 6:** every generated migration contains `DROP DEFAULT` on the `seq`
  columns and `DROP SEQUENCE "change_seq"`. Delete them; add the
  `nextval('change_seq')` default for the new table by hand.
- **Tests need a database whose name ends in `_test`.** Every test command
  below uses
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test`.
  Create it once if missing:
  `docker exec todoer-dev-postgres-1 createdb -U todoer todoer_test`, then
  `DATABASE_URL=… pnpm --filter @todoer/backend exec prisma migrate deploy`.
- **Commits:** Conventional Commits with a scope (`feat(backend): …`), body
  says why. **No `Co-Authored-By` trailer** (repository rule from
  2026-09-26; `git log` still shows it on older commits — do not copy it).
  Never commit to `main`; one PR whose title is itself a conventional commit.
- **Gates:** `PR title (conventional commit)`, `Shell tests`,
  `Workspace tests`, `Lint`.
- **Formatting:** `pnpm lint` runs Prettier over `.ts` and `.json`; run
  `pnpm format` before each commit. Markdown is not formatted.

## Review Focus

1. **Arrival order must not decide.** Device X marks Tuesday done at 10:00,
   device Y skips it at 11:00; Y's op reaches the server first. Expected:
   `skipped`, and X's create answers `superseded`. Test in Task 5.
2. **The id derivation is permanent.** Upper-case task ids, a null
   occurrence, and the exact separator must hash the way `vectors/ids.json`
   says, on both the server and the specs package. Expected: the vectors pass
   and the server accepts an upper-case `taskId` whose id was derived from the
   lower-case form. Tests in Task 1 and Task 5.
3. **Existing TaskTag behaviour changes under the tests.** Today a tombstoned
   tag with a live TaskTag is kept; after Task 7 it is pruned with it. The two
   prune tests that pin the old rule must be rewritten, not deleted, and must
   also assert that nothing was logged as an error — a rolled-back pruning
   transaction looks exactly like a correctly guarded one. Test in Task 7.
4. **Undo then redo.** `set state open` then a second `create` of the same
   occurrence with `state: done`. Expected: one row, `done`, version 3.
   Test in Task 5.
5. **Rules checked on the resulting row, not the op.** `set dtstart null` on
   a recurring task and `set parentId` on a recurring task carry no `rrule` in
   the op but produce an invalid task. Expected: both rejected. Test in
   Task 6.

---

### Task 0: Branch, task file, and the design documents

**Files:**

- Add (on disk, untracked):
  `docs/specs/2026-09-26-plan-c-recurrence-design.md`,
  `docs/plans/2026-09-26-plan-c2-task-occurrence.md`,
  `specs/tasks/active/T-2026-09-26-task-occurrence.md`

**Interfaces:**

- Produces: the branch `feat/task-occurrence` every later task commits to.

The task spec is the contract: each task below names its requirements
(`FR-NNN`) and step (`TNNN`). Tick the step there when a task finishes. When a
requirement turns out wrong, change the task spec first, then this plan.

- [ ] **Step 1: Branch** (already done if `git branch --show-current` prints
      `feat/task-occurrence`)

```bash
git switch main && git pull --ff-only
git switch -c feat/task-occurrence
```

- [ ] **Step 2: Commit the documents**

```bash
git add docs/specs/2026-09-26-plan-c-recurrence-design.md \
  docs/plans/2026-09-26-plan-c2-task-occurrence.md \
  specs/tasks/active/T-2026-09-26-task-occurrence.md
git commit -m "docs: design plan C and plan its server half" \
  -m "Plan C replaces the completion and exception logs with one task
occurrence row keyed by a deterministic id, because a natural-key unique
constraint collides with tombstones. C2 is the server half; the CLI builds
against it in C1."
```

---

### Task 1: Runtime code and test vectors in `@todoer/specs`

Implements FR-001, FR-002, FR-003 (T001).

**Files:**

- Create: `packages/specs/src/dates.ts`, `packages/specs/src/ids.ts`,
  `packages/specs/src/rrule.ts`, `packages/specs/src/index.ts`
- Create: `packages/specs/src/dates.spec.ts`,
  `packages/specs/src/ids.spec.ts`, `packages/specs/src/rrule.spec.ts`
- Create: `packages/specs/vectors/rrule.json`,
  `packages/specs/vectors/ids.json`
- Modify: `packages/specs/package.json`

**Interfaces:**

- Produces (exported from `@todoer/specs`):
  - `isIsoDate(value: unknown): value is string`
  - `ID_NAMESPACE: string`, `uuidv5(name: string, namespace?: string): string`
  - `taskOccurrenceId(taskId: string, occurrence: string | null): string`
  - `taskTagId(taskId: string, tagId: string): string`
  - `parseRrule(text: string): RruleParse` where
    `RruleParse = { ok: true; rule: Rrule } | { ok: false; error: string }`
  - types `Rrule`, `Weekday`, `Freq`, const `WEEKDAYS`
  - files `@todoer/specs/vectors/rrule.json`, `@todoer/specs/vectors/ids.json`
    (C1's expander reads `rrule.json`)

The package so far builds only `src/generated/`. It keeps doing that, through
a new `src/index.ts` that re-exports the generated code next to the three new
modules. Imports inside `src/` are extension-less: this package's tsconfig
uses `moduleResolution: Bundler` and tsup bundles the output.

- [ ] **Step 1: Wire the package for tests and the new entry point**

In `packages/specs/package.json`:

```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./vectors/*.json": "./vectors/*.json"
  },
  "scripts": {
    "validate": "redocly lint openapi/openapi.yaml",
    "codegen": "openapi-ts",
    "build": "pnpm codegen && tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
```

and add to `devDependencies`: `"@types/node": "^24"`, `"vitest": "^5.0.2"`.
Then `pnpm install`.

Create `packages/specs/src/index.ts`:

```ts
export * from './generated/index';
export * from './dates';
export * from './ids';
export * from './rrule';
```

- [ ] **Step 2: Add the vector files**

`packages/specs/vectors/rrule.json` (expected values computed with
python-dateutil 2.9.0, not by any code in this repository; the two WKST cases
are RFC 5545's own examples):

```json
{
  "source": "Expected values computed with python-dateutil 2.9.0 (an independent RFC 5545 implementation); the two WKST cases are the RFC 5545 section 3.8.5.3 examples. Window bounds are inclusive; COUNT counts from dtstart, not from the window.",
  "cases": [
    {"name": "last working day of the month", "rrule": "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", "dtstart": "2026-01-01", "window": {"from": "2026-01-01", "to": "2026-06-30"}, "expected": ["2026-01-30", "2026-02-27", "2026-03-31", "2026-04-30", "2026-05-29", "2026-06-30"]},
    {"name": "29 February, yearly", "rrule": "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", "dtstart": "2024-02-29", "window": {"from": "2024-01-01", "to": "2033-12-31"}, "expected": ["2024-02-29", "2028-02-29", "2032-02-29"]},
    {"name": "fifth Sunday of the month", "rrule": "FREQ=MONTHLY;BYDAY=5SU", "dtstart": "2026-01-01", "window": {"from": "2026-01-01", "to": "2026-12-31"}, "expected": ["2026-03-29", "2026-05-31", "2026-08-30", "2026-11-29"]},
    {"name": "UNTIL falls exactly on an occurrence", "rrule": "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261019", "dtstart": "2026-09-28", "window": {"from": "2026-09-01", "to": "2026-12-31"}, "expected": ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]},
    {"name": "INTERVAL spanning a year boundary", "rrule": "FREQ=WEEKLY;INTERVAL=2;BYDAY=TH", "dtstart": "2026-12-17", "window": {"from": "2026-12-01", "to": "2027-02-28"}, "expected": ["2026-12-17", "2026-12-31", "2027-01-14", "2027-01-28", "2027-02-11", "2027-02-25"]},
    {"name": "monthly on the 31st skips short months", "rrule": "FREQ=MONTHLY;BYMONTHDAY=31", "dtstart": "2026-01-31", "window": {"from": "2026-01-01", "to": "2026-12-31"}, "expected": ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31"]},
    {"name": "dtstart on the 31st, no BYMONTHDAY", "rrule": "FREQ=MONTHLY", "dtstart": "2026-01-31", "window": {"from": "2026-01-01", "to": "2026-08-31"}, "expected": ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31"]},
    {"name": "last day of the month", "rrule": "FREQ=MONTHLY;BYMONTHDAY=-1", "dtstart": "2026-01-31", "window": {"from": "2026-01-01", "to": "2026-06-30"}, "expected": ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]},
    {"name": "WKST=MO with INTERVAL=2", "rrule": "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO", "dtstart": "1997-08-05", "window": {"from": "1997-08-01", "to": "1997-09-30"}, "expected": ["1997-08-05", "1997-08-10", "1997-08-19", "1997-08-24"]},
    {"name": "WKST=SU with INTERVAL=2", "rrule": "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU", "dtstart": "1997-08-05", "window": {"from": "1997-08-01", "to": "1997-09-30"}, "expected": ["1997-08-05", "1997-08-17", "1997-08-19", "1997-08-31"]},
    {"name": "COUNT counts from dtstart, not from the window", "rrule": "FREQ=DAILY;COUNT=5", "dtstart": "2026-09-01", "window": {"from": "2026-09-03", "to": "2026-09-30"}, "expected": ["2026-09-03", "2026-09-04", "2026-09-05"]},
    {"name": "every third day", "rrule": "FREQ=DAILY;INTERVAL=3", "dtstart": "2026-09-28", "window": {"from": "2026-09-28", "to": "2026-10-20"}, "expected": ["2026-09-28", "2026-10-01", "2026-10-04", "2026-10-07", "2026-10-10", "2026-10-13", "2026-10-16", "2026-10-19"]},
    {"name": "yearly defaults to dtstart's month and day", "rrule": "FREQ=YEARLY", "dtstart": "2026-03-15", "window": {"from": "2026-01-01", "to": "2029-12-31"}, "expected": ["2026-03-15", "2027-03-15", "2028-03-15", "2029-03-15"]},
    {"name": "weekly without BYDAY uses dtstart's weekday", "rrule": "FREQ=WEEKLY", "dtstart": "2026-09-30", "window": {"from": "2026-09-28", "to": "2026-10-31"}, "expected": ["2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"]},
    {"name": "dtstart not matching BYDAY is not an occurrence", "rrule": "FREQ=WEEKLY;BYDAY=MO,FR", "dtstart": "2026-09-30", "window": {"from": "2026-09-28", "to": "2026-10-12"}, "expected": ["2026-10-02", "2026-10-05", "2026-10-09", "2026-10-12"]},
    {"name": "second-to-last Friday, yearly in November", "rrule": "FREQ=YEARLY;BYMONTH=11;BYDAY=-2FR", "dtstart": "2026-01-01", "window": {"from": "2026-01-01", "to": "2028-12-31"}, "expected": ["2026-11-20", "2027-11-19", "2028-11-17"]},
    {"name": "first Monday of each quarter", "rrule": "FREQ=MONTHLY;INTERVAL=3;BYDAY=1MO", "dtstart": "2026-01-01", "window": {"from": "2026-01-01", "to": "2026-12-31"}, "expected": ["2026-01-05", "2026-04-06", "2026-07-06", "2026-10-05"]},
    {"name": "window before dtstart is empty", "rrule": "FREQ=DAILY", "dtstart": "2026-09-28", "window": {"from": "2026-09-01", "to": "2026-09-27"}, "expected": []}
  ]
}
```

`packages/specs/vectors/ids.json` (expected values from Python's
`uuid.uuid5`):

```json
{
  "source": "Expected values computed with Python's uuid.uuid5, independently of @todoer/specs.",
  "namespace": "40e49f07-6ce6-46fc-b2de-65dd46253bf2",
  "rfcExample": {
    "namespace": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "name": "www.example.com",
    "expected": "2ed6657d-e927-568b-95e1-2665a8aea6a2"
  },
  "cases": [
    {
      "kind": "task_occurrence",
      "taskId": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      "occurrence": "2026-09-28",
      "name": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:2026-09-28",
      "expected": "77df7b96-7881-5f57-add4-ed6c7f92c95c"
    },
    {
      "kind": "task_occurrence",
      "taskId": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      "occurrence": null,
      "name": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:",
      "expected": "e62951e8-e981-5189-8da8-8e366465d357"
    },
    {
      "kind": "task_tag",
      "taskId": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      "tagId": "0192a1b2-c3d4-7e5f-8a9b-ffffffffffff",
      "name": "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b:0192a1b2-c3d4-7e5f-8a9b-ffffffffffff",
      "expected": "55e1d899-660e-5497-a8d3-266b523c7d89"
    }
  ]
}
```

Run `pnpm exec prettier --write packages/specs/vectors` — Prettier expands
the one-line cases, which is expected; the content must not change.

- [ ] **Step 3: Write the failing tests**

`packages/specs/src/dates.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isIsoDate } from './dates';

describe('isIsoDate', () => {
  it.each(['2026-09-28', '2024-02-29', '1997-08-05'])('accepts %s', (d) => {
    expect(isIsoDate(d)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-9-28',
    '2026-09-28T00:00:00Z',
    '20260928',
    '',
    null,
    20260928,
  ])('refuses %s', (d) => {
    expect(isIsoDate(d)).toBe(false);
  });
});
```

`packages/specs/src/ids.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ID_NAMESPACE, taskOccurrenceId, taskTagId, uuidv5 } from './ids';

type IdCase =
  | { kind: 'task_occurrence'; taskId: string; occurrence: string | null; expected: string }
  | { kind: 'task_tag'; taskId: string; tagId: string; expected: string };

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/ids.json', import.meta.url), 'utf8'),
) as {
  namespace: string;
  rfcExample: { namespace: string; name: string; expected: string };
  cases: IdCase[];
};

describe('deterministic ids', () => {
  it('is RFC 9562 UUIDv5', () => {
    const { namespace, name, expected } = vectors.rfcExample;
    expect(uuidv5(name, namespace)).toBe(expected);
  });

  it('uses the frozen namespace', () => {
    expect(ID_NAMESPACE).toBe(vectors.namespace);
  });

  it.each(vectors.cases)('derives $kind $expected', (c) => {
    const id =
      c.kind === 'task_tag'
        ? taskTagId(c.taskId, c.tagId)
        : taskOccurrenceId(c.taskId, c.occurrence);
    expect(id).toBe(c.expected);
  });

  it('lower-cases ids before hashing', () => {
    const c = vectors.cases[0] as Extract<IdCase, { kind: 'task_occurrence' }>;
    expect(taskOccurrenceId(c.taskId.toUpperCase(), c.occurrence)).toBe(c.expected);
  });
});
```

`packages/specs/src/rrule.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRrule } from './rrule';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/rrule.json', import.meta.url), 'utf8'),
) as { cases: Array<{ name: string; rrule: string }> };

describe('parseRrule', () => {
  it.each(vectors.cases)('parses the vector "$name"', ({ rrule }) => {
    expect(parseRrule(rrule)).toMatchObject({ ok: true });
  });

  it('reads ordinals, defaults and UNTIL', () => {
    expect(parseRrule('FREQ=MONTHLY;BYDAY=-1FR,MO;UNTIL=20261231')).toEqual({
      ok: true,
      rule: {
        freq: 'MONTHLY',
        interval: 1,
        byDay: [
          { n: -1, day: 'FR' },
          { n: null, day: 'MO' },
        ],
        byMonthDay: null,
        byMonth: null,
        bySetPos: null,
        count: null,
        until: '2026-12-31',
        wkst: 'MO',
      },
    });
  });

  it.each([
    ['', 'malformed part'],
    ['FREQ=DAILY;', 'malformed part'],
    ['INTERVAL=2', 'FREQ is required'],
    ['FREQ=HOURLY', 'FREQ=HOURLY is not supported'],
    ['FREQ=DAILY;BYHOUR=9', 'never times'],
    ['FREQ=DAILY;BYMINUTE=0', 'never times'],
    ['freq=daily', 'freq is not supported'],
    ['FREQ=DAILY;RDATE=20261001', 'RDATE is not supported'],
    ['FREQ=DAILY;FREQ=WEEKLY', 'appears twice'],
    ['FREQ=DAILY;INTERVAL=0', 'positive integer'],
    ['FREQ=DAILY;COUNT=3;UNTIL=20261231', 'COUNT and UNTIL'],
    ['FREQ=DAILY;UNTIL=20261231T000000Z', 'UNTIL must be a date'],
    ['FREQ=DAILY;UNTIL=20260230', 'UNTIL must be a date'],
    ['FREQ=WEEKLY;BYMONTHDAY=1', 'FREQ=WEEKLY'],
    ['FREQ=WEEKLY;BYDAY=1MO', 'ordinal'],
    ['FREQ=MONTHLY;BYDAY=0MO', 'out of range'],
    ['FREQ=MONTHLY;BYDAY=MON', 'not a weekday'],
    ['FREQ=MONTHLY;BYMONTHDAY=0', 'out of range'],
    ['FREQ=MONTHLY;BYMONTHDAY=1.5', 'out of range'],
    ['FREQ=YEARLY;BYMONTH=13', 'out of range'],
    ['FREQ=YEARLY;BYMONTH=+2', 'out of range'],
    ['FREQ=DAILY;BYSETPOS=1', 'another BY part'],
    ['FREQ=DAILY;WKST=XX', 'not a weekday'],
  ])('refuses %j', (text, reason) => {
    const parsed = parseRrule(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain(reason);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm --filter @todoer/specs test`
Expected: FAIL — `Failed to resolve import "./dates"` (and `./ids`,
`./rrule`).

- [ ] **Step 5: Write the modules**

`packages/specs/src/dates.ts`:

```ts
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a real calendar date written `YYYY-MM-DD` — the only form a date
 * takes on the wire (ADR 0010). `2026-02-30` matches the pattern and is
 * refused: the round trip through `Date` moves it to March.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
```

`packages/specs/src/ids.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * The namespace every deterministic id is derived in. Frozen protocol: a
 * different value orphans every task occurrence and TaskTag row on every
 * replica (plan C design, Q7).
 */
export const ID_NAMESPACE = '40e49f07-6ce6-46fc-b2de-65dd46253bf2';

/**
 * RFC 9562 UUIDv5: SHA-1 over the namespace's 16 bytes and the name's UTF-8.
 *
 * ponytail: node:crypto, so Node only. The web client needs a SHA-1 that runs
 * in a browser (crypto.subtle is async); swap the hash when it arrives.
 */
export function uuidv5(name: string, namespace: string = ID_NAMESPACE): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** A task occurrence's id: `<task_id>:<YYYY-MM-DD>`, or `<task_id>:` when null. */
export function taskOccurrenceId(
  taskId: string,
  occurrence: string | null,
): string {
  return uuidv5(`${taskId.toLowerCase()}:${occurrence ?? ''}`);
}

/** A TaskTag row's id: `<task_id>:<tag_id>`. */
export function taskTagId(taskId: string, tagId: string): string {
  return uuidv5(`${taskId.toLowerCase()}:${tagId.toLowerCase()}`);
}
```

`packages/specs/src/rrule.ts`:

```ts
import { isIsoDate } from './dates';

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** A parsed rule. `null` means the part was absent, not empty. */
export type Rrule = {
  freq: Freq;
  interval: number;
  byDay: Array<{ n: number | null; day: Weekday }> | null;
  byMonthDay: number[] | null;
  byMonth: number[] | null;
  bySetPos: number[] | null;
  count: number | null;
  /** `YYYY-MM-DD`, inclusive. */
  until: string | null;
  wkst: Weekday;
};

export type RruleParse =
  | { ok: true; rule: Rrule }
  | { ok: false; error: string };

const FREQS: ReadonlySet<string> = new Set([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
]);
const KEYS: ReadonlySet<string> = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'COUNT',
  'UNTIL',
  'WKST',
]);
const TIME_KEYS: ReadonlySet<string> = new Set([
  'BYHOUR',
  'BYMINUTE',
  'BYSECOND',
]);
const BYDAY_ITEM = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/** A positive integer, as INTERVAL and COUNT need. */
function positive(key: string, value: string): number | string {
  return /^[1-9]\d{0,5}$/.test(value)
    ? Number(value)
    : `${key} must be a positive integer`;
}

/**
 * A comma list of integers in 1..max, or ±1..max when `signed`. Zero is never
 * valid: RFC 5545 counts from 1 at the start and from -1 at the end.
 */
function ints(
  key: string,
  value: string,
  max: number,
  signed: boolean,
): number[] | string {
  const out: number[] = [];
  for (const item of value.split(',')) {
    const n = /^[+-]?\d{1,3}$/.test(item) ? Number(item) : NaN;
    const ok = signed
      ? n !== 0 && Math.abs(n) <= max
      : n >= 1 && n <= max && !item.startsWith('+');
    if (!ok) return `${key}: "${item}" is out of range`;
    out.push(n);
  }
  return out;
}

/**
 * Parses the RFC 5545 subset todoer supports (domain design §4). Strict on
 * purpose: keys are upper case, each appears once, and anything outside the
 * subset is an error rather than ignored — a rule one client ignores part of
 * expands differently on another. This is the one copy of "which rules are
 * legal"; the server and every TypeScript client call it (plan C design,
 * Q14).
 */
export function parseRrule(text: string): RruleParse {
  const fail = (error: string): RruleParse => ({ ok: false, error });
  const parts = new Map<string, string>();
  for (const part of text.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0 || eq === part.length - 1) {
      return fail(`malformed part: "${part}"`);
    }
    const key = part.slice(0, eq);
    if (TIME_KEYS.has(key)) {
      return fail(
        `${key} is not supported: v1 has dates, never times (ADR 0010)`,
      );
    }
    if (!KEYS.has(key)) return fail(`${key} is not supported`);
    if (parts.has(key)) return fail(`${key} appears twice`);
    parts.set(key, part.slice(eq + 1));
  }

  const freq = parts.get('FREQ');
  if (freq === undefined) return fail('FREQ is required');
  if (!FREQS.has(freq)) return fail(`FREQ=${freq} is not supported`);
  const rule: Rrule = {
    freq: freq as Freq,
    interval: 1,
    byDay: null,
    byMonthDay: null,
    byMonth: null,
    bySetPos: null,
    count: null,
    until: null,
    wkst: 'MO',
  };

  for (const [key, value] of parts) {
    if (key === 'INTERVAL' || key === 'COUNT') {
      const n = positive(key, value);
      if (typeof n === 'string') return fail(n);
      if (key === 'INTERVAL') rule.interval = n;
      else rule.count = n;
    } else if (key === 'BYMONTHDAY' || key === 'BYSETPOS') {
      const list = ints(key, value, key === 'BYMONTHDAY' ? 31 : 366, true);
      if (typeof list === 'string') return fail(list);
      if (key === 'BYMONTHDAY') rule.byMonthDay = list;
      else rule.bySetPos = list;
    } else if (key === 'BYMONTH') {
      const list = ints(key, value, 12, false);
      if (typeof list === 'string') return fail(list);
      rule.byMonth = list;
    } else if (key === 'BYDAY') {
      const days: Array<{ n: number | null; day: Weekday }> = [];
      for (const item of value.split(',')) {
        const m = BYDAY_ITEM.exec(item);
        const day = m?.[2];
        if (m === null || day === undefined || !isWeekday(day)) {
          return fail(`BYDAY: "${item}" is not a weekday`);
        }
        const n = m[1] === undefined ? null : Number(m[1]);
        if (n !== null && (n === 0 || Math.abs(n) > 53)) {
          return fail(`BYDAY: "${item}" is out of range`);
        }
        if (n !== null && freq !== 'MONTHLY' && freq !== 'YEARLY') {
          return fail(
            `BYDAY: "${item}" has an ordinal, which needs FREQ=MONTHLY or YEARLY`,
          );
        }
        days.push({ n, day });
      }
      rule.byDay = days;
    } else if (key === 'UNTIL') {
      const date = /^\d{8}$/.test(value)
        ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
        : null;
      if (date === null || !isIsoDate(date)) {
        return fail('UNTIL must be a date, YYYYMMDD');
      }
      rule.until = date;
    } else if (key === 'WKST') {
      if (!isWeekday(value)) return fail(`WKST: "${value}" is not a weekday`);
      rule.wkst = value;
    }
  }

  if (rule.count !== null && rule.until !== null) {
    return fail('COUNT and UNTIL cannot both be set');
  }
  if (rule.byMonthDay !== null && rule.freq === 'WEEKLY') {
    return fail('BYMONTHDAY cannot be used with FREQ=WEEKLY');
  }
  if (
    rule.bySetPos !== null &&
    rule.byDay === null &&
    rule.byMonthDay === null &&
    rule.byMonth === null
  ) {
    return fail('BYSETPOS needs another BY part to select from');
  }
  return { ok: true, rule };
}
```

- [ ] **Step 6: Run the tests, the build and the linters**

Run: `pnpm --filter @todoer/specs test && pnpm --filter @todoer/specs build && pnpm --filter @todoer/specs typecheck && pnpm --filter @todoer/specs lint`
Expected: every test passes; `dist/index.d.ts` exports `parseRrule`,
`taskOccurrenceId`, `isIsoDate` (`ugrep -c parseRrule packages/specs/dist/index.d.ts` ≥ 1).

Mutation check (do not commit): change `| 0x50` to `| 0x40` in `ids.ts`;
the RFC-example test must fail. Change `ints(key, value, 12, false)` to
`true`; the `BYMONTH=+2` case must fail. Revert both.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add packages/specs pnpm-lock.yaml
git commit -m "feat(specs): ship the rrule parser, id derivation and test vectors" \
  -m "Which rules are legal and how a deterministic id is derived are
contract: the server and every TypeScript client must agree on both, so they
live next to the OpenAPI document rather than in one app. The vectors'
expected values come from independent implementations, so a shared mistake
cannot hide in them."
```

Tick T001 in the task spec.

---

### Task 2: `task_occurrence` in the contract

Implements FR-005 on the wire (T002).

**Files:**

- Modify: `packages/specs/openapi/openapi.yaml` (`OpCreate`, `OpSet`,
  `OpDelete`)
- Regenerate: `packages/specs/src/generated/`

**Interfaces:**

- Produces: `task_occurrence` is a legal `table` in every operation.
  `OpDelete` keeps it in its enum on purpose: the server refuses such a
  delete per operation (Task 5); leaving it out of the enum would make
  `express-openapi-validator` answer the whole batch `400`, which blocks the
  client's outbox behind one bad op.

- [ ] **Step 1: Change the three enums and document the rules**

In each of `OpCreate`, `OpSet`, `OpDelete`:

```yaml
        table:
          type: string
          enum: [task, project, tag, task_tag, task_occurrence]
```

Add a `description` to `OpCreate` (directly under `type: object`):

```yaml
      description: |
        Creates a row. Every id is a client-generated UUIDv7 (ADR 0005),
        except in `task_occurrence` and `task_tag`, whose id is derived:
        UUIDv5 in namespace 40e49f07-6ce6-46fc-b2de-65dd46253bf2 over
        `<taskId>:<occurrence>` (`<taskId>:` when occurrence is null) or
        `<taskId>:<tagId>`, ids lower-cased. The server recomputes it and
        rejects a mismatch. A create of an existing derived id merges its
        fields under per-field last-write-wins; rows of these two tables are
        never deleted, they are toggled with `set` (`state`, `attached`).
        Dates are `YYYY-MM-DD` strings. `@todoer/specs` exports the
        derivation (`taskOccurrenceId`, `taskTagId`) and the rrule parser.
```

- [ ] **Step 2: Validate and regenerate**

Run: `pnpm spec:validate && pnpm spec:codegen`
Expected: no lint errors; `git diff --stat packages/specs/src/generated`
shows `types.gen.ts` changed, with `'task_occurrence'` in the `table` unions.

- [ ] **Step 3: Commit, spec and generated code separately**

```bash
git add packages/specs/openapi/openapi.yaml
git commit -m "feat(specs): add task_occurrence to the sync contract" \
  -m "Plan C stores done and skipped occurrences in one synced table with a
derived id. The contract names the derivation because every client must
compute the same id offline."
git add packages/specs/src/generated
git commit -m "chore(specs): regenerate the client for task_occurrence"
```

Tick T002.

---

### Task 3: Dates travel as `YYYY-MM-DD`

Implements FR-004 (T003). Departure 5.

**Files:**

- Modify: `apps/backend/src/sync/sync.service.ts`
- Test: `apps/backend/src/sync/sync.service.spec.ts`

**Interfaces:**

- Consumes: `isIsoDate` from `@todoer/specs` (Task 1).
- Produces (module-private in `sync.service.ts`, used by Tasks 4–6):
  - `DATE_FIELDS: Partial<Record<TableName, ReadonlySet<string>>>`
  - `writtenFields(op: Op): Array<[string, unknown]>`
  - `dateRejection(table: TableName, op: Op): string | null`
  - `toStorage(table: TableName, data: Record<string, unknown>): Record<string, unknown>`
  - `toChangeRow` formats date columns back to `YYYY-MM-DD`.
  - In `applyOne`: `const badValue = … dateRejection(table, op) …`, checked
    right after the UUID branch. Task 5 extends that expression.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('SyncService', …)` in `sync.service.spec.ts`:

```ts
  // ADR 0010 / plan C2 departure 5: Prisma refuses a bare date for @db.Date,
  // so before this every date field written through /sync was rejected.
  it('stores a YYYY-MM-DD date and returns it in the same form', async () => {
    const op = createTask('pay rent');
    op.fields = { ...op.fields, dueOn: '2026-09-28', dtstart: '2026-09-01' };

    const res = await service.sync(USER, { since: 0, ops: [op] });

    expect(res.results[0]?.status).toBe('applied');
    const row = res.changes.find((c) => c.id === op.id)?.row;
    expect(row?.dueOn).toBe('2026-09-28');
    expect(row?.dtstart).toBe('2026-09-01');
  });

  it.each(['2026-02-30', '2026-9-28', '2026-09-28T00:00:00Z', 20260928])(
    'rejects %j in a date field, naming the field',
    async (value) => {
      const op = createTask('bad date');
      await service.sync(USER, { since: 0, ops: [op] });

      const res = await service.sync(USER, {
        since: 0,
        ops: [
          {
            opId: uuidv7(),
            kind: 'set' as const,
            table: 'task' as const,
            id: op.id,
            field: 'scheduledOn',
            value,
            ts: new Date().toISOString(),
          },
        ],
      });

      expect(res.results[0]).toMatchObject({
        status: 'rejected',
        reason: 'scheduledOn must be a date, YYYY-MM-DD',
      });
    },
  );

  it('clears a date with null', async () => {
    const op = createTask('undated');
    op.fields = { ...op.fields, dueOn: '2026-09-28' };
    await service.sync(USER, { since: 0, ops: [op] });

    const res = await service.sync(USER, {
      since: 0,
      ops: [
        {
          opId: uuidv7(),
          kind: 'set' as const,
          table: 'task' as const,
          id: op.id,
          field: 'dueOn',
          value: null,
          ts: new Date().toISOString(),
        },
      ],
    });

    expect(res.results[0]?.status).toBe('applied');
    expect(res.changes.find((c) => c.id === op.id)?.row.dueOn).toBeNull();
  });
```

First widen the existing `createTask` helper so tests can add fields to it:
change its `fields: { title, rank: 'a0' },` to
`fields: { title, rank: 'a0' } as Record<string, unknown>,`. Without it `tsc`
refuses `op.fields = { ...op.fields, dueOn: … }` as an excess property.

- [ ] **Step 2: Run to verify they fail**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts -t "date"`
Expected: FAIL — the first test gets `status: 'rejected'`
(`could not be applied`), the second gets `could not be applied` instead of
the named reason.

- [ ] **Step 3: Implement**

In `sync.service.ts`, add the import:

```ts
import { isIsoDate } from '@todoer/specs';
```

After `WRITABLE_FIELDS`, add:

```ts
/**
 * Columns that hold a calendar date (ADR 0010). On the wire a date is
 * `YYYY-MM-DD`; Prisma's `@db.Date` takes only a full ISO date-time or a
 * `Date`, so a bare date reached it as a validation error ("could not be
 * applied") and a read came back as midnight UTC with a time on it. Both
 * directions convert here.
 */
const DATE_FIELDS: Partial<Record<TableName, ReadonlySet<string>>> = {
  task: new Set(['scheduledOn', 'dueOn', 'dtstart']),
};

/**
 * The `[field, value]` pairs an op writes. A malformed `fields`/`field` yields
 * nothing: applyOp rejects those, with a better reason than any caller here.
 */
function writtenFields(op: Op): Array<[string, unknown]> {
  if (op.kind === 'create') {
    return typeof op.fields === 'object' &&
      op.fields !== null &&
      !Array.isArray(op.fields)
      ? Object.entries(op.fields)
      : [];
  }
  if (op.kind === 'set') {
    return typeof op.field === 'string' ? [[op.field, op.value]] : [];
  }
  return [];
}

/** Why a date field in this op cannot be stored, or `null`. */
function dateRejection(table: TableName, op: Op): string | null {
  const dates = DATE_FIELDS[table];
  if (dates === undefined) return null;
  for (const [field, value] of writtenFields(op)) {
    if (dates.has(field) && value !== null && !isIsoDate(value)) {
      return `${field} must be a date, YYYY-MM-DD`;
    }
  }
  return null;
}

/** The row as Prisma must receive it: date strings become `Date`s. */
function toStorage(
  table: TableName,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const dates = DATE_FIELDS[table];
  if (dates === undefined) return data;
  const out = { ...data };
  for (const field of dates) {
    const value = out[field];
    if (typeof value === 'string') {
      out[field] = new Date(`${value}T00:00:00.000Z`);
    }
  }
  return out;
}
```

Replace the body of `referenceRejection`'s `written` computation with the
helper (delete the `let written…` block and its if/else):

```ts
  for (const [field, value] of writtenFields(op)) {
```

Change `toChangeRow` so a date column leaves as a date:

```ts
function toChangeRow(
  table: TableName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const dates = DATE_FIELDS[table];
  const out: Record<string, unknown> = {};
  for (const key of [...READABLE_PROTOCOL_FIELDS, ...WRITABLE_FIELDS[table]]) {
    if (!(key in row)) continue;
    const value = row[key];
    out[key] =
      value instanceof Date && dates?.has(key)
        ? value.toISOString().slice(0, 10)
        : value;
  }
  return out;
}
```

In `applyOne`, compute the check next to `badField`:

```ts
        const badField = table !== null ? unpermittedField(table, op) : null;
        const badValue =
          table !== null && badField === null ? dateRejection(table, op) : null;
```

and add a branch right after the `!UUID.test(op.id)` branch:

```ts
        } else if (badValue !== null) {
          outcome = { status: 'rejected', reason: badValue };
        } else {
```

In the applied write, pass the data through `toStorage`:

```ts
          const data = toStorage(table, {
            ...rest,
            version,
            fieldTs,
            deletedAt,
            userId,
            seq: nextval,
          });
```

`table` is non-null there (`delegate` was resolved from it); if `tsc` cannot
see it, hoist `table` into the same invariant check as `delegate`.

- [ ] **Step 4: Run the backend suite**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend test`
Expected: PASS, including every earlier test.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/backend/src/sync
git commit -m "fix(backend): accept and return dates as YYYY-MM-DD" \
  -m "Prisma's @db.Date takes only a full date-time, so every date written
through /sync was rejected as 'could not be applied' and reads came back with
a midnight UTC time. ADR 0010 says a date is a date; task occurrences are
keyed by one, so this must work first."
```

Tick T003.

---

### Task 4: Schema, migration and table wiring

Implements FR-005, FR-009 (the column), FR-012 (the cascade) (T004).

**Files:**

- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_task_occurrence/migration.sql`
- Modify: `apps/backend/src/sync/sync.service.ts`
- Modify: `apps/backend/src/sync/sync.service.spec.ts`,
  `apps/backend/src/sync/prune.service.spec.ts`,
  `apps/backend/src/auth/auth.service.spec.ts` (cleanup order)

**Interfaces:**

- Consumes: `DATE_FIELDS`, `taskOccurrenceId` (Tasks 1, 3).
- Produces: table name `task_occurrence`, delegate `taskOccurrence`, relation
  `"TaskOccurrence"`; writable fields `taskId`, `occurrence`, `state`,
  `completedAt`, `value`; TaskTag writable `attached`. Test helper
  `createOccurrence` in `sync.service.spec.ts` (Tasks 5–7 use it).

- [ ] **Step 1: Write the failing test**

In `sync.service.spec.ts` add the import
`import { taskOccurrenceId } from '@todoer/specs';`, add
`await prisma.taskOccurrence.deleteMany({});` as the first line after
`appliedOp.deleteMany` in `beforeEach` (do the same in
`prune.service.spec.ts` and `auth.service.spec.ts`), and add the helper after
`deleteTask`:

```ts
function createOccurrence(
  taskId: string,
  occurrence: string | null,
  fields: Record<string, unknown>,
  ts = new Date().toISOString(),
) {
  return {
    opId: uuidv7(),
    kind: 'create' as const,
    table: 'task_occurrence' as const,
    id: taskOccurrenceId(taskId, occurrence),
    fields: { taskId, occurrence, ...fields },
    ts,
  };
}
```

Append the tests:

```ts
  it('stores a task occurrence and returns it with its date', async () => {
    const task = createTask('water the plants');
    const done = createOccurrence(task.id, '2026-09-28', {
      state: 'done',
      completedAt: '2026-09-28T08:00:00.000Z',
    });

    const res = await service.sync(USER, { since: 0, ops: [task, done] });

    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    expect(res.changes.find((c) => c.id === done.id)).toMatchObject({
      table: 'task_occurrence',
      row: {
        taskId: task.id,
        occurrence: '2026-09-28',
        state: 'done',
        value: null,
      },
    });
  });

  it('refuses a task occurrence on a task the user does not own', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    await prisma.user.create({
      data: { id: OTHER, email: 'q@r.s', passwordHash: 'x' },
    });
    const theirs = createTask('not yours');
    await service.sync(OTHER, { since: 0, ops: [theirs] });

    const res = await service.sync(USER, {
      since: 0,
      ops: [createOccurrence(theirs.id, '2026-09-28', { state: 'done' })],
    });

    expect(res.results[0]).toMatchObject({
      status: 'rejected',
      reason: 'taskId does not reference a row you own',
    });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend exec vitest run src/sync/sync.service.spec.ts -t "task occurrence"`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading
'deleteMany')` in `beforeEach`: the Prisma client has no `taskOccurrence` yet
(Vitest strips types, so this is a runtime error, not a `tsc` one).

- [ ] **Step 3: Change the schema**

In `schema.prisma`, add to `User`: `taskOccurrences TaskOccurrence[]`; add
to `Task`: `occurrences TaskOccurrence[]`. Replace the relations and the
unique block of `TaskTag`, and add `attached`:

```prisma
model TaskTag {
  id     String @id @db.Uuid
  userId String @db.Uuid
  taskId String @db.Uuid
  tagId  String @db.Uuid
  /// Detach sets this to false; a TaskTag row is never deleted. Its id is
  /// UUIDv5 of `<taskId>:<tagId>` (plan C design, Q5 and Q7), which is also
  /// what keeps a pair to one row — no unique index needed.
  attached Boolean @default(true)

  version   Int      @default(1)
  fieldTs   Json     @default("{}")
  /// (keep the existing seq doc comment unchanged)
  seq       BigInt
  deletedAt DateTime?
  createdAt DateTime @default(now())

  /// Cascade: when pruning deletes a tombstoned task or tag, its TaskTag rows
  /// go with it (plan C design, Q13).
  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@index([userId, seq])
  @@index([taskId])
  @@index([tagId])
}
```

Add the new model after `TaskTag`:

```prisma
/// One row per (task, occurrence): whether that occurrence was done or
/// skipped. Replaces ADR 0002's two logs (plan C design, Q4). Its id is
/// UUIDv5 of `<taskId>:<occurrence>` and it is never deleted — undo sets
/// `state` back to `open` — so `deletedAt` is always null; it stays because
/// every synced table carries the four protocol columns.
model TaskOccurrence {
  id          String    @id @db.Uuid
  userId      String    @db.Uuid
  taskId      String    @db.Uuid
  /// Null for a non-recurring task. A subtask uses its parent's occurrence
  /// date (ADR 0009).
  occurrence  DateTime? @db.Date
  /// open | done | skipped — checked by the sync service, not by Postgres.
  state       String    @default("open")
  completedAt DateTime?
  /// Reserved for v2 quantified habits.
  value       Float?

  version   Int      @default(1)
  fieldTs   Json     @default("{}")
  /// Defaults to nextval('change_seq') — set by hand in this table's
  /// migration, invisible to this schema. See trap 6 in `.claude/CLAUDE.md`.
  seq       BigInt
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])
  /// Cascade: pruning a tombstoned task takes its occurrences (Q13).
  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([userId, seq])
  @@index([taskId])
}
```

- [ ] **Step 4: Generate the migration, then fix it by hand**

```bash
cd apps/backend
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test \
  pnpm exec prisma migrate dev --create-only --name task_occurrence
```

Open the new `migration.sql` and:

1. delete every `ALTER TABLE … ALTER COLUMN "seq" DROP DEFAULT;` line and the
   `DROP SEQUENCE "change_seq";` line (trap 6);
2. append:

```sql
-- Hand-written, like the init migration's: Prisma does not model a default
-- shared across tables. Without it inserts into TaskOccurrence fail on a
-- null seq only when the service stops assigning seq itself — which is
-- exactly when nobody would notice.
ALTER TABLE "TaskOccurrence" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
```

What must remain: drop of the two TaskTag foreign keys and of
`TaskTag_taskId_tagId_key`; `ADD COLUMN "attached" BOOLEAN NOT NULL DEFAULT
true`; `CREATE TABLE "TaskOccurrence"`; the new indexes; the foreign keys
re-added with `ON DELETE CASCADE` (TaskTag → Task, TaskTag → Tag,
TaskOccurrence → Task) and `ON DELETE RESTRICT` for TaskOccurrence → User.

Apply and check:

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm exec prisma migrate deploy
docker exec todoer-dev-postgres-1 psql -U todoer -d todoer_test -c '\d "TaskOccurrence"'
```

Expected: `seq | bigint | not null | nextval('change_seq'::regclass)`, and
`\d "Task"` still shows its own `nextval` default. Then `pnpm exec prisma
generate` (the `postinstall` normally does it; trap 1).

- [ ] **Step 5: Wire the table into the sync service**

In `sync.service.ts`:

```ts
const TABLES = ['task', 'project', 'tag', 'task_tag', 'task_occurrence'] as const;

const DELEGATE = {
  task: 'task',
  project: 'project',
  tag: 'tag',
  task_tag: 'taskTag',
  task_occurrence: 'taskOccurrence',
} as const;

const RELATION = {
  task: 'Task',
  project: 'Project',
  tag: 'Tag',
  task_tag: 'TaskTag',
  task_occurrence: 'TaskOccurrence',
} as const;
```

In `REFERENCES` add `task_occurrence: { taskId: 'task' },`. In
`WRITABLE_FIELDS` change `task_tag` and add the new table:

```ts
  task_tag: new Set(['taskId', 'tagId', 'attached']),
  task_occurrence: new Set([
    'taskId',
    'occurrence',
    'state',
    'completedAt',
    'value',
  ]),
```

In `DATE_FIELDS` add `task_occurrence: new Set(['occurrence']),`. Fix the
comments that say "four tables" in `sync.service.ts` (`RELATION`'s doc,
`changesSince`'s first paragraph) to "every synced table".

- [ ] **Step 6: Run the backend suite**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend test && pnpm --filter @todoer/backend typecheck`
Expected: PASS. Existing prune tests on TaskTag still pass: the prune guards
(`tags: { none: {} }`, `tasks: { none: {} }`) are still in place until
Task 7.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/backend
git commit -m "feat(backend): add the task_occurrence table and TaskTag.attached" \
  -m "One row per task and occurrence replaces the completion and exception
logs (plan C design, Q4). Child rows cascade from their task or tag because
they are toggled, never tombstoned, and would otherwise block pruning
forever (Q13)."
```

Tick T004.

---

### Task 5: Deterministic ids, create-merge, no delete

Implements FR-006, FR-007, FR-008, FR-009 (T005). Departure 1.

**Files:**

- Create: `apps/backend/src/sync/derived-id.ts`,
  `apps/backend/src/sync/derived-id.spec.ts`
- Modify: `apps/backend/src/sync/apply-op.ts`,
  `apps/backend/src/sync/apply-op.spec.ts`
- Modify: `apps/backend/src/sync/sync.service.ts`,
  `apps/backend/src/sync/sync.service.spec.ts`
- Modify: `apps/backend/src/sync/prune.service.spec.ts` (three existing tests
  create TaskTag rows with random ids or delete them)

**Interfaces:**

- Consumes: `taskOccurrenceId`, `taskTagId` (Task 1); `createOccurrence`
  helper (Task 4).
- Produces:
  - `isDerivedIdTable(table: string): boolean`
  - `derivedIdRejection(table: string, op: Op): string | null`
  - `applyOp(op, current, now, options?: { mergeCreate?: boolean }): Outcome`

- [ ] **Step 1: Write the failing pure tests**

`apps/backend/src/sync/derived-id.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { taskOccurrenceId, taskTagId } from '@todoer/specs';
import { derivedIdRejection, isDerivedIdTable } from './derived-id.js';

const TASK = '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const TAG = '0192a1b2-c3d4-7e5f-8a9b-ffffffffffff';
const TS = '2026-09-28T08:00:00.000Z';

function create(table: string, id: string, fields: Record<string, unknown>) {
  return { opId: TASK, kind: 'create' as const, table, id, fields, ts: TS };
}

describe('derived ids', () => {
  it('names exactly the two toggle tables', () => {
    expect(['task_occurrence', 'task_tag'].every(isDerivedIdTable)).toBe(true);
    expect(['task', 'project', 'tag'].some(isDerivedIdTable)).toBe(false);
  });

  it('accepts a create whose id is derived from its fields', () => {
    const id = taskOccurrenceId(TASK, '2026-09-28');
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', id, { taskId: TASK, occurrence: '2026-09-28' }),
      ),
    ).toBeNull();
    expect(
      derivedIdRejection(
        'task_tag',
        create('task_tag', taskTagId(TASK, TAG), { taskId: TASK, tagId: TAG }),
      ),
    ).toBeNull();
  });

  it('treats a missing occurrence as null', () => {
    const id = taskOccurrenceId(TASK, null);
    expect(
      derivedIdRejection('task_occurrence', create('task_occurrence', id, { taskId: TASK })),
    ).toBeNull();
  });

  it('accepts an upper-case taskId whose id came from the lower-case form', () => {
    const id = taskOccurrenceId(TASK, '2026-09-28');
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', id.toUpperCase(), {
          taskId: TASK.toUpperCase(),
          occurrence: '2026-09-28',
        }),
      ),
    ).toBeNull();
  });

  it('rejects a create whose id is not the derivation', () => {
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', TAG, { taskId: TASK, occurrence: '2026-09-28' }),
      ),
    ).toBe('id does not match the id derived from taskId, occurrence');
  });

  it('rejects a create without the key fields it is derived from', () => {
    expect(
      derivedIdRejection('task_tag', create('task_tag', TAG, { taskId: TASK })),
    ).toBe('id does not match the id derived from taskId, tagId');
  });

  it('refuses to change an identity field', () => {
    const op = {
      opId: TASK,
      kind: 'set' as const,
      table: 'task_occurrence',
      id: TAG,
      field: 'occurrence',
      value: '2026-09-29',
      ts: TS,
    };
    expect(derivedIdRejection('task_occurrence', op)).toBe(
      'occurrence is part of this row’s identity and cannot change',
    );
  });

  it('refuses delete and names the toggle to use instead', () => {
    const op = { opId: TASK, kind: 'delete' as const, table: 'task_tag', id: TAG, baseVersion: 1 };
    expect(derivedIdRejection('task_tag', op)).toBe(
      'rows of task_tag are never deleted; set attached instead',
    );
    expect(derivedIdRejection('task_occurrence', { ...op, table: 'task_occurrence' })).toBe(
      'rows of task_occurrence are never deleted; set state instead',
    );
  });

  it('has nothing to say about other tables', () => {
    expect(derivedIdRejection('task', create('task', TAG, { title: 'x' }))).toBeNull();
  });
});
```

Append to `apply-op.spec.ts` (inside its top-level `describe`; reuse its
existing `now`/row helpers if present, otherwise these literals):

```ts
  describe('create of an existing row with mergeCreate', () => {
    const NOW = new Date('2026-09-28T12:00:00.000Z');
    const current = {
      id: 'occ',
      version: 1,
      fieldTs: { state: '2026-09-28T10:00:00.000Z', taskId: '2026-09-28T10:00:00.000Z' },
      deletedAt: null,
      taskId: 't',
      state: 'done',
    };
    const create = (ts: string, fields: Record<string, unknown>) => ({
      opId: 'op',
      kind: 'create' as const,
      table: 'task_occurrence',
      id: 'occ',
      fields,
      ts,
    });

    it('still rejects a duplicate id without mergeCreate', () => {
      expect(applyOp(create('2026-09-28T11:00:00.000Z', { state: 'skipped' }), current, NOW)).toEqual({
        status: 'rejected',
        reason: 'a row with this id already exists',
      });
    });

    it('applies the fields that are newer, per field', () => {
      const out = applyOp(
        create('2026-09-28T11:00:00.000Z', { state: 'skipped', value: 2 }),
        current,
        NOW,
        { mergeCreate: true },
      );
      expect(out).toMatchObject({
        status: 'applied',
        row: {
          state: 'skipped',
          value: 2,
          version: 2,
          fieldTs: { state: '2026-09-28T11:00:00.000Z', value: '2026-09-28T11:00:00.000Z' },
        },
      });
    });

    it('answers superseded when no field is newer', () => {
      expect(
        applyOp(create('2026-09-28T09:00:00.000Z', { state: 'skipped' }), current, NOW, {
          mergeCreate: true,
        }),
      ).toEqual({ status: 'superseded' });
    });

    it('still validates the create before merging', () => {
      expect(
        applyOp(create('not a time', { state: 'skipped' }), current, NOW, { mergeCreate: true }),
      ).toMatchObject({ status: 'rejected' });
      expect(
        applyOp(create('2026-09-28T11:00:00.000Z', { version: 9 }), current, NOW, {
          mergeCreate: true,
        }),
      ).toMatchObject({ status: 'rejected' });
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @todoer/backend exec vitest run src/sync/derived-id.spec.ts src/sync/apply-op.spec.ts`
Expected: FAIL — `derived-id.js` does not exist; the merge tests get
`a row with this id already exists`.

- [ ] **Step 3: Write `derived-id.ts`**

```ts
import { taskOccurrenceId, taskTagId } from '@todoer/specs';
import type { Op } from './apply-op.js';

type Derivation = {
  /** The fields the id is derived from; they can never change. */
  keys: readonly string[];
  /** The field a client toggles instead of deleting the row. */
  toggle: string;
  /** The id these fields derive, or null if they cannot derive one. */
  derive(fields: Record<string, unknown>): string | null;
};

/**
 * Tables whose id is UUIDv5 of a natural key (plan C design, Q2 and Q7). Two
 * clients recording the same fact offline mint the same id, so the server
 * sees one row instead of two that a unique index would have to refuse. The
 * server recomputes the id on every create: POST /sync is the only write
 * path, so a client that derived it wrongly is stopped here or nowhere.
 */
const DERIVED: Readonly<Record<string, Derivation>> = {
  task_occurrence: {
    keys: ['taskId', 'occurrence'],
    toggle: 'state',
    derive: ({ taskId, occurrence = null }) =>
      typeof taskId === 'string' &&
      (occurrence === null || typeof occurrence === 'string')
        ? taskOccurrenceId(taskId, occurrence)
        : null,
  },
  task_tag: {
    keys: ['taskId', 'tagId'],
    toggle: 'attached',
    derive: ({ taskId, tagId }) =>
      typeof taskId === 'string' && typeof tagId === 'string'
        ? taskTagId(taskId, tagId)
        : null,
  },
};

export function isDerivedIdTable(table: string): boolean {
  return Object.hasOwn(DERIVED, table);
}

/**
 * Why this op cannot be applied to a derived-id table, or `null`. A malformed
 * `fields` is left to applyOp. Dates are already checked (dateRejection runs
 * first), so `occurrence` is canonical by the time it is hashed.
 */
export function derivedIdRejection(table: string, op: Op): string | null {
  const derivation = DERIVED[table];
  if (derivation === undefined) return null;
  if (op.kind === 'delete') {
    return `rows of ${table} are never deleted; set ${derivation.toggle} instead`;
  }
  if (op.kind === 'set') {
    return derivation.keys.includes(op.field)
      ? `${op.field} is part of this row’s identity and cannot change`
      : null;
  }
  if (typeof op.fields !== 'object' || op.fields === null || Array.isArray(op.fields)) {
    return null;
  }
  const derived = derivation.derive(op.fields);
  // `typeof` first: this runs before the UUID check, and a throw here would
  // escape applyOne's per-op rejection as a 500.
  return derived !== null &&
    typeof op.id === 'string' &&
    derived === op.id.toLowerCase()
    ? null
    : `id does not match the id derived from ${derivation.keys.join(', ')}`;
}
```

- [ ] **Step 4: Teach `applyOp` to merge**

In `apply-op.ts`, change the signature and the create branch:

```ts
export function applyOp(
  op: Op,
  current: Row | null,
  now: Date,
  options: { mergeCreate?: boolean } = {},
): Outcome {
  if (op.kind === 'create') {
    if (current !== null && options.mergeCreate !== true) {
      return {
        status: 'rejected',
        reason: 'a row with this id already exists',
      };
    }
    // … the existing fields / protocol-field / self-parent / ts checks,
    // unchanged …
    const ts = clamp(op.ts, now);
    if (current !== null) return mergeFields(current, op.fields, ts);
    const fieldTs: Record<string, string> = {};
    // … unchanged from here …
```

and add below `clamp`:

```ts
/**
 * A create of a row that already exists, for a table whose ids are derived
 * from a natural key: two clients recorded the same fact. Each field is
 * applied as a `set` would be — only where it is newer than what the row
 * holds — so the later action wins whichever create arrives first (plan C
 * design, Q8). `superseded` when no field won, as for a `set` that lost.
 */
function mergeFields(
  current: Row,
  fields: Record<string, unknown>,
  ts: string,
): Outcome {
  if (current.deletedAt !== null) {
    return { status: 'rejected', reason: 'row is deleted (tombstoned)' };
  }
  const row: Row = { ...current, fieldTs: { ...current.fieldTs } };
  let won = false;
  for (const [key, value] of Object.entries(fields)) {
    const seen = current.fieldTs[key];
    if (seen !== undefined && ts <= seen) continue;
    row[key] = value;
    row.fieldTs[key] = ts;
    won = true;
  }
  if (!won) return { status: 'superseded' };
  return { status: 'applied', row: { ...row, version: current.version + 1 } };
}
```

Update the module doc's list of what a create may do: "a create that
collides" → "a create that collides (rejected, or merged for a derived-id
table)".

- [ ] **Step 5: Wire it into `applyOne`**

In `sync.service.ts` import
`import { derivedIdRejection, isDerivedIdTable } from './derived-id.js';`
and extend `badValue`:

```ts
        const badValue =
          table !== null && badField === null
            ? (dateRejection(table, op) ?? derivedIdRejection(table, op))
            : null;
```

and call `applyOp` with the option:

```ts
            outcome = applyOp(op, current, now, {
              mergeCreate: isDerivedIdTable(table),
            });
```

- [ ] **Step 6: Write the failing service tests**

Append to `sync.service.spec.ts` (add `taskTagId` to the `@todoer/specs`
import):

```ts
  // Review Focus 4 / scenario 1.
  it('completes, undoes and completes again into one row', async () => {
    const task = createTask('stretch');
    const t0 = Date.now();
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const done = createOccurrence(task.id, '2026-09-28', { state: 'done' }, at(0));
    await service.sync(USER, { since: 0, ops: [task, done] });

    const undo = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task_occurrence' as const,
      id: done.id,
      field: 'state',
      value: 'open',
      ts: at(1),
    };
    const again = createOccurrence(task.id, '2026-09-28', { state: 'done' }, at(2));
    const res = await service.sync(USER, { since: 0, ops: [undo, again] });

    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const rows = await prisma.taskOccurrence.findMany({ where: { taskId: task.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'done', version: 3 });
  });

  // Review Focus 1 / scenario 2: the later action wins, not the first to arrive.
  it('lets the later of two offline creates win whatever arrives first', async () => {
    const task = createTask('water the plants');
    await service.sync(USER, { since: 0, ops: [task] });
    const t0 = Date.now() - 60_000;
    const doneAt10 = createOccurrence(task.id, '2026-09-28', { state: 'done' }, new Date(t0).toISOString());
    const skippedAt11 = createOccurrence(
      task.id,
      '2026-09-28',
      { state: 'skipped' },
      new Date(t0 + 30_000).toISOString(),
    );

    const first = await service.sync(USER, { since: 0, ops: [skippedAt11] });
    const second = await service.sync(USER, { since: 0, ops: [doneAt10] });

    expect(first.results[0]?.status).toBe('applied');
    expect(second.results[0]?.status).toBe('superseded');
    const row = await prisma.taskOccurrence.findUniqueOrThrow({ where: { id: skippedAt11.id } });
    expect(row.state).toBe('skipped');
  });

  it('keeps one row for a non-recurring completion sent twice', async () => {
    const task = createTask('file taxes');
    await service.sync(USER, {
      since: 0,
      ops: [
        task,
        createOccurrence(task.id, null, { state: 'done' }),
        createOccurrence(task.id, null, { state: 'done' }),
      ],
    });

    expect(await prisma.taskOccurrence.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('rejects a task occurrence whose id is not derived from its fields', async () => {
    const task = createTask('x');
    const bad = { ...createOccurrence(task.id, '2026-09-28', { state: 'done' }), id: uuidv7() };

    const res = await service.sync(USER, { since: 0, ops: [task, bad] });

    expect(res.results[1]).toMatchObject({
      status: 'rejected',
      reason: 'id does not match the id derived from taskId, occurrence',
    });
  });

  it('refuses to delete a task occurrence or move it to another date', async () => {
    const task = createTask('x');
    const done = createOccurrence(task.id, '2026-09-28', { state: 'done' });
    await service.sync(USER, { since: 0, ops: [task, done] });

    const res = await service.sync(USER, {
      since: 0,
      ops: [
        { opId: uuidv7(), kind: 'delete' as const, table: 'task_occurrence' as const, id: done.id, baseVersion: 1 },
        {
          opId: uuidv7(),
          kind: 'set' as const,
          table: 'task_occurrence' as const,
          id: done.id,
          field: 'occurrence',
          value: '2026-09-29',
          ts: new Date().toISOString(),
        },
      ],
    });

    expect(res.results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(await prisma.taskOccurrence.count({ where: { id: done.id } })).toBe(1);
  });

  // FR-009: the collision this plan found in TaskTag, fixed.
  it('detaches and re-attaches a tag', async () => {
    const task = createTask('x');
    const tag = uuidv7();
    const link = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task_tag' as const,
      id: taskTagId(task.id, tag),
      fields: { taskId: task.id, tagId: tag },
      ts: new Date(Date.now() - 2000).toISOString(),
    };
    await service.sync(USER, {
      since: 0,
      ops: [
        task,
        { opId: uuidv7(), kind: 'create' as const, table: 'tag' as const, id: tag, fields: { name: 'home' }, ts: new Date().toISOString() },
        link,
      ],
    });
    const detach = {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task_tag' as const,
      id: link.id,
      field: 'attached',
      value: false,
      ts: new Date(Date.now() - 1000).toISOString(),
    };
    const reattach = { ...link, opId: uuidv7(), fields: { ...link.fields, attached: true }, ts: new Date().toISOString() };

    const res = await service.sync(USER, { since: 0, ops: [detach, reattach] });

    expect(res.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const row = await prisma.taskTag.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.attached).toBe(true);
  });
```

- [ ] **Step 7: Fix the three prune tests that used random TaskTag ids**

In `prune.service.spec.ts` add `import { taskTagId } from '@todoer/specs';`.

- In `keeps a tombstoned tag a live TaskTag still references` and
  `keeps a tombstoned task a live TaskTag still references`: replace
  `const taskTag = uuidv7();` with `const taskTag = taskTagId(task, tag);`
  (declare it after `task` and `tag`). Task 7 rewrites both tests; this step
  only keeps them meaning what they meant.
- In `prunes old unreferenced tombstones of every table, not just task`: the
  TaskTag tombstone can no longer be made through the protocol. Replace
  `const taskTag = uuidv7();` with `const taskTag = taskTagId(task, tag);`,
  delete the `remove('task_tag', taskTag),` op, and stage the legacy
  tombstone right after the `sync.sync` call:

```ts
    // A TaskTag tombstone can only exist from before TaskTag became a toggle
    // (plan C2); stage one directly, with a fresh seq like a real delete.
    await prisma.$executeRaw`
      UPDATE "TaskTag" SET "deletedAt" = now(), "seq" = nextval('change_seq'),
        "version" = "version" + 1
       WHERE "id" = ${taskTag}::uuid
    `;
```

- [ ] **Step 8: Run the backend suite**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend test && pnpm --filter @todoer/backend typecheck && pnpm --filter @todoer/backend lint`
Expected: PASS.

Mutation checks (do not commit, revert each): in `mergeFields` delete the
`continue` — "lets the later of two offline creates win" and "answers
superseded" must fail. Delete `if (!won) return { status: 'superseded' };` —
"answers superseded" must fail. Make `derivedIdRejection` return `null`
first thing — "rejects a task occurrence whose id" must fail.

- [ ] **Step 9: Commit**

```bash
pnpm format
git add apps/backend/src/sync
git commit -m "feat(backend): derive toggle-row ids and merge duplicate creates" \
  -m "Task occurrences and TaskTag rows are keyed by what they record, so two
offline devices address one row and per-field LWW decides between them. The
server recomputes the id because /sync is the only write path, refuses
delete because a tombstone would collide with the next create, and answers
superseded when a create is older on every field."
```

Tick T005.

---

### Task 6: Row rules for recurrence and state

Implements FR-010, FR-011 (T006). Independent of Task 5 apart from the file
it edits.

**Files:**

- Create: `apps/backend/src/sync/row-rules.ts`,
  `apps/backend/src/sync/row-rules.spec.ts`
- Modify: `apps/backend/src/sync/sync.service.ts`,
  `apps/backend/src/sync/sync.service.spec.ts`

**Interfaces:**

- Consumes: `parseRrule` (Task 1).
- Produces: `rowRejection(table: string, row: Record<string, unknown>): string | null`,
  called on every `applied` outcome before it is written.

The rules are checked on the **resulting** row, not on the op: `set dtstart
null` and `set parentId` carry no `rrule` but can still produce a recurring
task without an anchor or a recurring subtask.

- [ ] **Step 1: Write the failing pure tests**

`apps/backend/src/sync/row-rules.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rowRejection } from './row-rules.js';

const recurring = { rrule: 'FREQ=WEEKLY;BYDAY=MO', dtstart: '2026-09-28', parentId: null };

describe('rowRejection', () => {
  it('accepts a valid recurring task and a plain one', () => {
    expect(rowRejection('task', recurring)).toBeNull();
    expect(rowRejection('task', { title: 'x' })).toBeNull();
    expect(rowRejection('task', { rrule: null, dtstart: null })).toBeNull();
  });

  it('accepts a dtstart stored as a Date', () => {
    expect(rowRejection('task', { ...recurring, dtstart: new Date('2026-09-28') })).toBeNull();
  });

  it('rejects a rule outside the subset, with the parser’s reason', () => {
    expect(rowRejection('task', { ...recurring, rrule: 'FREQ=DAILY;BYHOUR=9' })).toBe(
      'rrule: BYHOUR is not supported: v1 has dates, never times (ADR 0010)',
    );
    expect(rowRejection('task', { ...recurring, rrule: 42 })).toBe('rrule must be a string');
  });

  it('rejects a rule without dtstart', () => {
    expect(rowRejection('task', { ...recurring, dtstart: null })).toBe('rrule requires dtstart');
    expect(rowRejection('task', { rrule: 'FREQ=DAILY' })).toBe('rrule requires dtstart');
  });

  it('rejects a rule on a subtask', () => {
    expect(rowRejection('task', { ...recurring, parentId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' })).toBe(
      'a subtask cannot carry an rrule (ADR 0009)',
    );
  });

  it('checks a task occurrence’s state', () => {
    expect(rowRejection('task_occurrence', { state: 'done' })).toBeNull();
    expect(rowRejection('task_occurrence', {})).toBeNull();
    expect(rowRejection('task_occurrence', { state: 'finished' })).toBe(
      'state must be one of open, done, skipped',
    );
  });

  it('has nothing to say about other tables', () => {
    expect(rowRejection('project', { rrule: 'nonsense' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @todoer/backend exec vitest run src/sync/row-rules.spec.ts`
Expected: FAIL — `row-rules.js` does not exist.

- [ ] **Step 3: Write `row-rules.ts`**

```ts
import { parseRrule } from '@todoer/specs';

const STATES: ReadonlySet<unknown> = new Set(['open', 'done', 'skipped']);

/**
 * Why a row, as it would be after an applied operation, may not be stored —
 * or `null`. Checked on the resulting row rather than on the op, because
 * `set dtstart null` or `set parentId` breaks a recurring task without
 * mentioning `rrule` at all.
 *
 * The server parses a rule but never expands it (plan C design, Q6, Q14): it
 * does not check that an occurrence belongs to the rule, which a concurrent
 * rule change would make a false rejection.
 */
export function rowRejection(
  table: string,
  row: Record<string, unknown>,
): string | null {
  if (table === 'task') {
    const { rrule, dtstart, parentId } = row;
    if (rrule === null || rrule === undefined) return null;
    if (typeof rrule !== 'string') return 'rrule must be a string';
    const parsed = parseRrule(rrule);
    if (!parsed.ok) return `rrule: ${parsed.error}`;
    if (dtstart === null || dtstart === undefined) return 'rrule requires dtstart';
    if (parentId !== null && parentId !== undefined) {
      return 'a subtask cannot carry an rrule (ADR 0009)';
    }
    return null;
  }
  if (table === 'task_occurrence') {
    const { state } = row;
    return state === undefined || STATES.has(state)
      ? null
      : 'state must be one of open, done, skipped';
  }
  return null;
}
```

- [ ] **Step 4: Call it in `applyOne`**

Import `import { rowRejection } from './row-rules.js';` and, right after the
`applyOp(...)` call:

```ts
            if (outcome.status === 'applied') {
              const badRow = rowRejection(table, outcome.row);
              if (badRow !== null) {
                outcome = { status: 'rejected', reason: badRow };
              }
            }
```

(The `AppliedOp` record below is written from `outcome`, so the rejection is
recorded and replays as itself.)

- [ ] **Step 5: Write the failing service tests**

Append to `sync.service.spec.ts`:

```ts
  function setTask(id: string, field: string, value: unknown, baseVersion?: number) {
    return {
      opId: uuidv7(),
      kind: 'set' as const,
      table: 'task' as const,
      id,
      field,
      value,
      ts: new Date().toISOString(),
      ...(baseVersion !== undefined ? { baseVersion } : {}),
    };
  }

  it('stores a recurring task with a valid rule', async () => {
    const op = createTask('stand-up');
    op.fields = { ...op.fields, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', dtstart: '2026-09-28' };

    const res = await service.sync(USER, { since: 0, ops: [op] });

    expect(res.results[0]?.status).toBe('applied');
  });

  it.each([
    [{ rrule: 'FREQ=DAILY;BYHOUR=9', dtstart: '2026-09-28' }, 'rrule: BYHOUR is not supported'],
    [{ rrule: 'FREQ=DAILY' }, 'rrule requires dtstart'],
  ])('rejects a task created with %j', async (fields, reason) => {
    const op = createTask('bad rule');
    op.fields = { ...op.fields, ...fields };

    const res = await service.sync(USER, { since: 0, ops: [op] });

    expect(res.results[0]?.status).toBe('rejected');
    expect(res.results[0]?.reason).toContain(reason);
    expect(await prisma.task.count({ where: { id: op.id } })).toBe(0);
  });

  // Review Focus 5: neither op mentions rrule.
  it('rejects clearing dtstart or adding a parent on a recurring task', async () => {
    const parent = createTask('parent');
    const op = createTask('weekly');
    op.fields = { ...op.fields, rrule: 'FREQ=WEEKLY', dtstart: '2026-09-28' };
    await service.sync(USER, { since: 0, ops: [parent, op] });

    const res = await service.sync(USER, {
      since: 0,
      ops: [setTask(op.id, 'dtstart', null), setParent(op.id, parent.id)],
    });

    expect(res.results.map((r) => r.reason)).toEqual([
      'rrule requires dtstart',
      'a subtask cannot carry an rrule (ADR 0009)',
    ]);
  });

  it('rejects a rule on a subtask', async () => {
    const parent = createTask('parent');
    const child = createTask('child');
    child.fields = { ...child.fields, parentId: parent.id };
    await service.sync(USER, { since: 0, ops: [parent, child] });

    const res = await service.sync(USER, {
      since: 0,
      ops: [setTask(child.id, 'dtstart', '2026-09-28'), setTask(child.id, 'rrule', 'FREQ=DAILY', 2)],
    });

    expect(res.results[1]).toMatchObject({
      status: 'rejected',
      reason: 'a subtask cannot carry an rrule (ADR 0009)',
    });
  });

  it('rejects a task occurrence state outside open, done, skipped', async () => {
    const task = createTask('x');
    const res = await service.sync(USER, {
      since: 0,
      ops: [task, createOccurrence(task.id, '2026-09-28', { state: 'finished' })],
    });

    expect(res.results[1]).toMatchObject({
      status: 'rejected',
      reason: 'state must be one of open, done, skipped',
    });
  });
```

- [ ] **Step 6: Run the backend suite**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend test && pnpm --filter @todoer/backend typecheck && pnpm --filter @todoer/backend lint`
Expected: PASS.

Mutation check: move the `rowRejection` call so it receives `op.fields`
instead of `outcome.row` for `set` ops (i.e. check the op); the "clearing
dtstart" test must fail. Revert.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/backend/src/sync
git commit -m "feat(backend): reject rules no client can expand" \
  -m "A rule outside the supported subset, a rule without its anchor, or a
rule on a subtask would be stored and then expanded differently, or not at
all, by each client. The check runs on the resulting row because clearing
dtstart or adding a parent breaks a recurring task without touching rrule."
```

Tick T006.

---

### Task 7: Prune by cascade; the snapshot hides orphans

Implements FR-012, FR-013 (T007). Departure 4.

**Files:**

- Modify: `apps/backend/src/sync/prune.service.ts`
- Modify: `apps/backend/src/sync/sync.service.ts` (`changesSince`)
- Test: `apps/backend/src/sync/prune.service.spec.ts`,
  `apps/backend/src/sync/sync.service.spec.ts`

**Interfaces:**

- Consumes: the cascading foreign keys (Task 4), derived ids (Task 5).
- Produces: nothing new for other tasks.

The watermark still comes only from pruned tombstones. Cascaded children do
not raise it, and do not need to: a client that has them also has their
parent's tombstone, and a client whose cursor predates that tombstone is
answered `410` because the tombstone's `seq` is covered.

- [ ] **Step 1: Rewrite the two tests that pin the old rule**

In `prune.service.spec.ts`, extend the helpers:

```ts
type Table = 'task' | 'project' | 'tag' | 'task_tag' | 'task_occurrence';
```

and add `import { taskOccurrenceId, taskTagId } from '@todoer/specs';` if
not already there. Replace the whole test
`keeps a tombstoned tag a live TaskTag still references` with:

```ts
  // Plan C2: TaskTag rows are toggled, never tombstoned, so a guard that
  // waited for them to go would keep this tag forever. They cascade instead.
  // The error spy matters: a rolled-back transaction leaves the same counts
  // as a guarded one.
  it('prunes a tombstoned tag together with the TaskTag rows that name it', async () => {
    const task = uuidv7();
    const tag = uuidv7();
    const taskTag = taskTagId(task, tag);
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', task, { title: 'task', rank: 'a0' }),
        create('tag', tag, { name: 'tag' }),
        create('task_tag', taskTag, { taskId: task, tagId: tag }),
        remove('tag', tag),
      ],
    });
    await age('tag', [tag], RETENTION_DAYS + 1);
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(prune.prune(new Date())).resolves.toBe(1);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(await prisma.tag.count({ where: { id: tag } })).toBe(0);
    expect(await prisma.taskTag.count({ where: { id: taskTag } })).toBe(0);
    expect(await prisma.task.count({ where: { id: task } })).toBe(1);
  });
```

Replace the whole test `keeps a tombstoned task a live TaskTag still
references` with:

```ts
  // Scenario 5.
  it('prunes a tombstoned task with its TaskTag rows and task occurrences', async () => {
    const task = uuidv7();
    const tag = uuidv7();
    const taskTag = taskTagId(task, tag);
    const occurrence = taskOccurrenceId(task, '2026-01-05');
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', task, { title: 'task', rank: 'a0' }),
        create('tag', tag, { name: 'tag' }),
        create('task_tag', taskTag, { taskId: task, tagId: tag }),
        create('task_occurrence', occurrence, {
          taskId: task,
          occurrence: '2026-01-05',
          state: 'done',
        }),
        remove('task', task),
      ],
    });
    await age('task', [task], RETENTION_DAYS + 1);
    const { seq } = await prisma.task.findUniqueOrThrow({ where: { id: task } });
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(prune.prune(new Date())).resolves.toBe(1);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(await prisma.task.count({ where: { id: task } })).toBe(0);
    expect(await prisma.taskTag.count({ where: { id: taskTag } })).toBe(0);
    expect(await prisma.taskOccurrence.count({ where: { id: occurrence } })).toBe(0);
    expect(await prisma.tag.count({ where: { id: tag } })).toBe(1);
    expect(await watermark(USER)).toBe(seq);
  });
```

Add one more, for a subtask whose TaskTag used to block its parent:

```ts
  it('prunes a tombstoned parent and subtask that both carry tags', async () => {
    const parent = uuidv7();
    const child = uuidv7();
    const tag = uuidv7();
    await sync.sync(USER, {
      since: 0,
      ops: [
        create('task', parent, { title: 'parent', rank: 'a0' }),
        create('task', child, { title: 'child', rank: 'a0', parentId: parent }),
        create('tag', tag, { name: 'tag' }),
        create('task_tag', taskTagId(parent, tag), { taskId: parent, tagId: tag }),
        create('task_tag', taskTagId(child, tag), { taskId: child, tagId: tag }),
        remove('task', child),
        remove('task', parent),
      ],
    });
    await age('task', [parent, child], RETENTION_DAYS + 1);

    await expect(prune.prune(new Date())).resolves.toBe(2);

    expect(await prisma.taskTag.count({ where: { userId: USER } })).toBe(0);
  });
```

- [ ] **Step 2: Write the failing snapshot test**

Append to `sync.service.spec.ts`:

```ts
  // FR-013: a snapshot omits tombstones, so it must omit their children too,
  // or the client receives rows whose task or tag it is never told about.
  it('leaves children of a tombstoned task or tag out of a snapshot', async () => {
    const live = createTask('live');
    const gone = createTask('gone');
    const tag = uuidv7();
    const liveDone = createOccurrence(live.id, '2026-09-28', { state: 'done' });
    const goneDone = createOccurrence(gone.id, '2026-09-28', { state: 'done' });
    const tagLink = {
      opId: uuidv7(),
      kind: 'create' as const,
      table: 'task_tag' as const,
      id: taskTagId(live.id, tag),
      fields: { taskId: live.id, tagId: tag },
      ts: new Date().toISOString(),
    };
    await service.sync(USER, {
      since: 0,
      ops: [
        live,
        gone,
        { opId: uuidv7(), kind: 'create' as const, table: 'tag' as const, id: tag, fields: { name: 'x' }, ts: new Date().toISOString() },
        liveDone,
        goneDone,
        tagLink,
        deleteTask(gone.id, 1),
        { opId: uuidv7(), kind: 'delete' as const, table: 'tag' as const, id: tag, baseVersion: 1 },
      ],
    });

    const snapshot = await service.sync(USER, { since: 0, ops: [] });
    const ids = snapshot.changes.map((c) => c.id);

    expect(ids).toContain(liveDone.id);
    expect(ids).not.toContain(goneDone.id);
    expect(ids).not.toContain(tagLink.id);
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend exec vitest run src/sync/prune.service.spec.ts src/sync/sync.service.spec.ts -t "prunes a tombstoned|snapshot"`
Expected: FAIL — the prune tests resolve `0` (the guards keep the rows); the
snapshot test finds `goneDone.id`.

- [ ] **Step 4: Drop the guards**

In `prune.service.ts`, replace `steps` in `pruneUser`:

```ts
      const steps: Array<[Prunable, object]> = [
        // Tombstoned TaskTag rows exist only from before TaskTag became a
        // toggle (plan C2); nothing creates new ones.
        [tx.taskTag as unknown as Prunable, old],
        // Subtasks first: their parent can go only once they are gone. A
        // task's TaskTag rows and task occurrences go with it by ON DELETE
        // CASCADE — they are never tombstoned, so waiting for them would keep
        // the task forever.
        [tx.task as unknown as Prunable, { ...old, parentId: { not: null } }],
        [tx.task as unknown as Prunable, { ...old, children: { none: {} } }],
        // A tag's TaskTag rows cascade the same way.
        [tx.tag as unknown as Prunable, old],
        [tx.project as unknown as Prunable, { ...old, tasks: { none: {} } }],
      ];
```

Update the two doc comments that no longer hold:

- class doc, last paragraph → "Only the synchronised tables with tombstones,
  named one by one. Task occurrences are never pruned on their own (ADR
  0013); they go with their task, by cascade, when its tombstone is pruned.
  A loop over every table with `deletedAt` would reach them directly."
- `pruneUser` doc → replace "a live TaskTag on a deleted tag" with "a live
  subtask under a deleted parent", and in the ponytail note replace
  "`RESTRICT` on TaskTag" with "`CASCADE` on TaskTag and TaskOccurrence" and
  drop `TaskTag.tagId` from the list of unindexed columns (Task 4 indexed it).

- [ ] **Step 5: Hide orphans in a snapshot**

In `sync.service.ts`, above `SyncService`:

```ts
/**
 * In a snapshot, rows whose parent is tombstoned are left out with the
 * tombstone: task occurrences and TaskTag rows are never deleted on their own,
 * so without this a snapshot delivers children of a task or tag the client is
 * never told about (plan C2, departure 4). Incremental pulls still deliver
 * them; a client already holding the parent's tombstone hides them.
 */
const SNAPSHOT_LIVE_PARENTS: Partial<Record<TableName, object>> = {
  task_occurrence: { task: { deletedAt: null } },
  task_tag: { task: { deletedAt: null }, tag: { deletedAt: null } },
};
```

and in `changesSince`'s `findMany`:

```ts
              ...(snapshot
                ? { deletedAt: null, ...SNAPSHOT_LIVE_PARENTS[table] }
                : {}),
```

The snapshot cursor's `aggregate` stays over every row, so it still covers
the rows left out.

- [ ] **Step 6: Run the backend suite**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend test && pnpm --filter @todoer/backend typecheck && pnpm --filter @todoer/backend lint`
Expected: PASS, including `keeps pruning other users when one of them fails`
(it sabotages `taskTag.aggregate`, which is still the first step).

Mutation check: restore `tags: { none: {} }` on the second task step only;
the parent/subtask-with-tags test must fail. Revert.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/backend/src/sync
git commit -m "feat(backend): prune toggle rows with their parent" \
  -m "Task occurrences and TaskTag rows are never tombstoned, so the old
guards that waited for them to go would have kept every tagged or completed
task forever. They cascade when their parent's tombstone is pruned, and a
snapshot leaves them out once their parent is gone."
```

Tick T007.

---

### Task 8: Records and documentation

Implements FR-014 (T008). No test can check prose; the check is the grep in
Step 3 and a reviewer reading every changed paragraph against the code.

**Files:**

- Modify: `docs/adr/0002-recurrence-is-virtual.md`,
  `docs/adr/0005-client-generated-identifiers.md`,
  `docs/adr/0006-three-generic-operations.md`,
  `docs/adr/0009-subtask-completion-uses-the-parent-occurrence.md`,
  `docs/adr/0013-tombstones-and-the-retention-contract.md`
- Modify: `docs/specs/2026-09-25-domain-and-sync-design.md` (§2, §4)
- Modify: `docs/specs/2026-09-26-plan-c-recurrence-design.md` (departures)
- Modify: `.claude/CLAUDE.md` (trap 6)
- Move: `specs/tasks/active/T-2026-09-26-task-occurrence.md` →
  `specs/tasks/done/`

- [ ] **Step 1: Amend the ADRs**

Each ADR gets an `## Amendment (2026-09-26, plan C)` section at the end,
leaving the original text as the record of what was decided then:

- **0002:** the two logs became one `task_occurrence` row per (task,
  occurrence) with `state` open/done/skipped, because done and skipped are
  mutually exclusive and one LWW field settles a disagreement that two tables
  would push into every client. The "rule, not rows" decision stands.
- **0005:** `task_occurrence` and `task_tag` ids are UUIDv5 of the natural key
  in namespace `40e49f07-6ce6-46fc-b2de-65dd46253bf2`, names as in the plan C
  design (Q7); the server recomputes and rejects a mismatch. Every other
  table keeps client-minted UUIDv7.
- **0006:** for those two tables a `create` of an existing id merges field by
  field under LWW (`superseded` if no field won), and `delete` is refused;
  the three verbs are unchanged.
- **0009:** a subtask's task occurrence carries the parent's occurrence date in
  `occurrence` and therefore in its id; the server now enforces "a subtask
  carries no rrule".
- **0013:** "a tombstone that a live row still references is kept" no longer
  covers TaskTag or task occurrences: they cascade when their task's or tag's
  tombstone is pruned. Completions are still never pruned on their own; they
  go with their task. A snapshot omits children of a tombstoned parent.

- [ ] **Step 2: Update the domain design and the plan C design**

- Domain design §2: replace `COMPLETION` and `EXCEPTION` in the ER diagram
  with `TASK_OCCURRENCE { uuid id PK "UUIDv5(task_id, occurrence)"; uuid
  task_id FK; date occurrence "nullable"; string state "open | done |
  skipped"; ts completed_at "nullable"; float value "nullable, reserved for v2
  habits" }`, add `bool attached` to `TASK_TAG`, and rewrite the first
  "constraints that carry design weight" bullet: the natural key is the id,
  not a unique index. The relation line becomes
  `TASK ||--o{ TASK_OCCURRENCE : "done or skipped on an occurrence"`.
- Domain design §4: "subtracting the dates present in `completion` and
  `exception`" → "subtracting the occurrences whose task occurrence is `done`
  or `skipped`"; add that the one parser of the subset is `parseRrule` in
  `@todoer/specs`, the vectors live in `packages/specs/vectors/`, and the
  server parses rules but never expands them.
- Plan C design: add a section `## Departures in plan C2` listing the eight
  departures at the top of this plan, one bullet each, and close the open
  thread on TaskTag's flag (`attached`).

- [ ] **Step 3: CLAUDE.md trap 6 and a stale-claim sweep**

In `.claude/CLAUDE.md` trap 6: "The four synced tables' `seq` default" →
"Every synced table's `seq` default", and "`DROP DEFAULT` on the four `seq`
columns" → "`DROP DEFAULT` on every `seq` column".

Then:

```bash
ugrep -rn -i -e 'four (synced|synchronised|tables)' -e 'completion log' \
  -e 'exception log' -e 'RESTRICT on TaskTag' -e 'TaskTag_taskId_tagId' \
  docs .claude apps/backend/src apps/backend/prisma/schema.prisma
```

Every hit is either historical (a dated plan or a done task — leave it) or
fixed in this step.

- [ ] **Step 4: Close the task**

Tick T008 and every Definition-of-Done box that holds, set `Status: done`,
add `- Completed: <date>` and `- Result: <PR URL>` once the PR exists, then:

```bash
git add specs/tasks/active/T-2026-09-26-task-occurrence.md
git mv specs/tasks/active/T-2026-09-26-task-occurrence.md specs/tasks/done/
```

(`git add` before `git mv`: `git mv` moves the index copy, so an unstaged
edit would be committed stale.)

- [ ] **Step 5: Full gates, then commit**

```bash
DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm -w exec turbo run build typecheck test
pnpm lint
```

Expected: all green.

```bash
git add docs .claude specs
git commit -m "docs: record task occurrences, derived ids and cascade pruning" \
  -m "Five ADRs and the domain design still described two logs, random ids
everywhere, and tombstones held by any live reference. They now say what the
code does, each as a dated amendment so the original decision stays
readable."
```

Then the dnote changelog line
(`YYYY-MM-DD · Server stores task occurrences with derived ids; …`) and the
PR, titled `feat: store task occurrences and validate recurrence on the
server`.
