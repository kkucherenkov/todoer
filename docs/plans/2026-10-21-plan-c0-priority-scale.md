# C0 Priority Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the stored priority scale so P0 is the most urgent and P4 the default, in Postgres, the core and every client, in one PR.

**Architecture:** One SQL migration maps tasks and the priority leaves of view filters to `4 − old` with a new `seq` and `version + 1`, and sets the column default to 4. The core sorts ascending and quick add defaults to 4. The TUI and the web hide the default `p4` and fall back to 4 where a priority is missing.

**Tech Stack:** Prisma 6 / PostgreSQL 18, TypeScript, vitest, Ink (TUI), Nuxt 4 (web).

**Spec:** `docs/specs/2026-10-21-priority-scale-design.md`, ADR 0019, task `specs/tasks/active/T-2026-10-21-core-priority-scale.md`.

## Global Constraints

- New value = `4 − old` for every task row, tombstones included; range stays 0–4.
- Every row the migration changes gets `"seq" = nextval('change_seq')` and `"version" = "version" + 1`; `fieldTs` is not touched.
- `Task.priority` default is 4 in `schema.prisma` and in the database.
- A filter leaf is `{ "priority": [n, …] }` anywhere in `and`/`or`/`not`; each `n` becomes `4 − n`; nothing else in the tree changes; a view without such a leaf keeps its `seq` and `version`.
- The generated migration must not contain `DROP SEQUENCE "change_seq"` or `"seq" DROP DEFAULT` (trap 6); `scripts/check-migrations.sh` must pass.
- No backward compatibility code: no protocol field, no outbox conversion.
- Commits carry no `Co-Authored-By` trailer. Conventional-commit subjects.
- Backend DB specs run only against a database whose name ends in `_test`.

## Review Focus

- A filter whose priority leaf sits under `not` and two levels deep → mapped like a root leaf (Task 1 spec).
- A view with no priority leaf → its `seq` and `version` unchanged (Task 1 spec).
- A tombstoned task → mapped too, stays deleted (Task 1 spec).
- Editing a TUI line of a P4 task without typing `pN` → no `priority` change queued (Task 3 spec).
- Two tasks with equal priority under sort `priority` → ordered by rank, then id (Task 2 spec).

---

### Task 1: Migration of stored priorities

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (`priority Int @default(0)` → `@default(4)`)
- Create: `apps/backend/prisma/migrations/20261021120000_priority_p0_highest/migration.sql`
- Create: `apps/backend/src/sync/priority-migration.spec.ts`

**Interfaces:**
- Produces: the migration directory name above; nothing in TypeScript.

- [ ] **Step 1: Write the failing spec** in `priority-migration.spec.ts`, using the same Prisma client and per-test truncation helpers `sync.service.spec.ts` uses. Apply the migration with `prisma db execute --file <path> --url $DATABASE_URL` through `execFileSync` (the file has several statements and a function body; `$executeRawUnsafe` runs one statement only). Tests:
  - `it('maps every task, tombstones included, to 4 − old with a new seq and version')`: insert tasks with priority 0,1,2,3,4 and one deleted task with priority 1; after: priorities 4,3,2,1,0 and 3, each `seq` greater and `version` = before + 1, deleted one still has `deletedAt`.
  - `it('maps priority leaves anywhere in a view filter')`: filters `{priority:[4,0]}`, `{and:[{tag:X},{priority:[1]}]}`, `{not:{or:[{priority:[2,3]}]}}`, `{or:[{and:[{not:{priority:[0]}}]}]}` become `{priority:[0,4]}`, `{and:[{tag:X},{priority:[3]}]}`, `{not:{or:[{priority:[2,1]}]}}`, `{or:[{and:[{not:{priority:[4]}}]}]}`; each changed view: new `seq`, `version + 1`.
  - `it('leaves a view without a priority leaf alone')`: `{and:[{tag:X},{due:{to:0}}]}` keeps filter, `seq`, `version`.
  - `it('defaults a new task to 4')`: insert through raw SQL without `priority`; it reads 4.

- [ ] **Step 2: Run it to see it fail**

Run: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm --filter @todoer/backend exec vitest run src/sync/priority-migration.spec.ts`
Expected: FAIL, migration file missing.

- [ ] **Step 3: Write the migration.** Change the schema default, run `pnpm --filter @todoer/backend exec prisma migrate dev --create-only --name priority_p0_highest`, rename the directory to `20261021120000_priority_p0_highest` if the timestamp differs (any timestamp after `20261001194224` is fine), delete every `DROP SEQUENCE "change_seq"` and `"seq" DROP DEFAULT` line, keep the `ALTER COLUMN "priority" SET DEFAULT 4`, then add, above it:
  - `UPDATE "Task"` per Global Constraints, with `"updatedAt" = CURRENT_TIMESTAMP` as `20261001194224_tombstone_orphan_subtasks` does;
  - a `CREATE FUNCTION pg_temp.flip_priority(f jsonb) RETURNS jsonb` in plpgsql that maps an object with key `priority` to `jsonb_build_object('priority', <mapped array>)`, recurses into `and`/`or` arrays and `not`, and returns any other leaf unchanged;
  - `UPDATE "View" SET "filter" = pg_temp.flip_priority("filter"), version + 1, new seq, updatedAt WHERE "filter"::text LIKE '%"priority"%'`, then restrict further with `AND pg_temp.flip_priority("filter") <> "filter"` so a leaf-free view is untouched.
  A comment at the top names ADR 0019 and says the statement list is its own inverse except the default.

- [ ] **Step 4: Run the spec and the migration check**

Run: the Step 2 command, then `sh scripts/check-migrations.sh`
Expected: PASS; check prints nothing and exits 0.

- [ ] **Step 5: Apply to the dev database** (SC-001): `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer pnpm --filter @todoer/backend exec prisma migrate deploy`, then `prisma migrate status` with the same URL says up to date.

- [ ] **Step 6: Commit** `feat(backend): store P0 as the highest priority`

### Task 2: Core sort and quick-add default

**Files:**
- Modify: `packages/client-core/src/operations.ts` (`sortFor`, the `priority` key)
- Modify: `packages/client-core/src/parse-quick-add.ts` (`let priority = 0` → 4)
- Test: `packages/client-core/src/operations.spec.ts`, `packages/client-core/src/parse-quick-add.spec.ts`

**Interfaces:**
- Produces: `parseQuickAdd(text).priority` is 4 when no `pN`; `sort: 'priority'` orders 0 first.

- [ ] **Step 1: Change the specs first.** `parse-quick-add.spec.ts`: every expectation without a `pN` marker expects `priority: 4`; add `it('reads p0 as the highest priority')` → `parseQuickAdd('ship it p0').priority === 0`. `operations.spec.ts:135` becomes `'sorts by priority (0 first) and due (nulls last), ending in rank then id'` with `b` at priority 0, `a`/`c`/`d` at 3: `sorted('priority')` → `['b', 'a', 'c', 'd']` unchanged order; add a tie case: two tasks priority 2 ranks `a2`,`a1` → rank order. Update the `task()` fixture default (`operations.spec.ts:57`) to 4 and the test at line 397 so its intent (highest first) holds with 0.
- [ ] **Step 2: Run** `pnpm --filter @todoer/client-core test` → the new expectations FAIL.
- [ ] **Step 3: Implement**: the sort key becomes `l.facts.priority`; the parser default becomes 4. Update the doc comment above `sortFor` if it says 4 first.
- [ ] **Step 4: Run** `pnpm -w exec turbo run build typecheck test --filter=@todoer/client-core` → PASS.
- [ ] **Step 5: Commit** `feat(client-core): sort P0 first and default quick add to P4`

### Task 3: TUI shows the new scale

**Files:**
- Modify: `apps/tui/src/line.ts`, `apps/tui/src/fields.ts`, `apps/tui/src/details.tsx` (`priorityOf`), `apps/tui/src/outline.tsx:33`
- Test: `apps/tui/src/line.spec.ts`, `apps/tui/src/fields.spec.ts`, `apps/tui/src/details.spec.tsx`, fixtures in `app.spec.tsx`, `board.spec.tsx`

**Interfaces:**
- Consumes: Task 2's parser default.

- [ ] **Step 1: Specs first.** `fields.spec.ts`: `parsePriority('')` → 4, `parsePriority('p0')` → 0. `line.spec.ts`: a P4 item writes no `pN`; a P0 item writes `p0`; `it('queues no priority change for a P4 line typed without pN')` → `lineChanges({…, priority: 4}, 'milk')` has no `priority` key. Fixture default priorities 0 → 4 in the TUI specs, unless a test is about a shown priority.
- [ ] **Step 2: Run** `pnpm -w exec turbo run build test --filter=@todoer/tui...` → FAIL.
- [ ] **Step 3: Implement**: every `?? 0` on a priority becomes `?? 4`; the shown predicate is `priority < 4` (line.ts and outline.tsx); `parsePriority('')` returns 4.
- [ ] **Step 4: Run** the Step 2 command → PASS.
- [ ] **Step 5: Commit** `feat(tui): show P0–P3 and treat P4 as the default`

### Task 4: Web shows the new scale

**Files:**
- Modify: `apps/web/app/components/TaskRow.vue:90`, `KanbanCard.vue:88`, `PlacementChip.vue:73` (`> 0` → `< 4`), `TaskDrawer.vue:61` (default 4), `apps/web/app/utils/filterTree.ts:144` (`[4]` → `[0]`), the doc comment at `filterTree.ts:128`
- Test: `apps/web/app/utils/filterTree.spec.ts:214`, `apps/web/e2e/fixtures.ts:363` (`priority: 0` → 4), component specs that assert a shown priority, if any

- [ ] **Step 1: Specs first**: `blank('priority', c)` → `{ priority: [0] }`; if a component spec renders a row with priority 0 expecting no badge, change it to 4 and add one row at 0 expecting `p0`.
- [ ] **Step 2: Run** `pnpm --filter @todoer/web test` → FAIL.
- [ ] **Step 3: Implement** the listed edits.
- [ ] **Step 4: Run** `pnpm --filter @todoer/web test && pnpm --filter @todoer/web typecheck` → PASS. The Playwright suite runs in CI (`Web e2e`); `list.spec.ts` uses p2/p3, which keep their meaning as shown values.
- [ ] **Step 5: Commit** `feat(web): show P0–P3 and treat P4 as the default`

### Task 5: CLI usage and documents

**Files:**
- Modify: `apps/cli/src/usage.ts:76` → `p0..p4      priority, p0 the highest; p4 when none is given`
- Modify: `docs/specs/2026-09-25-domain-and-sync-design.md:76` and `docs/specs/2026-10-01-views-design.md:301`: add a line noting ADR 0019 superseded the old scale (do not rewrite the history)
- Modify: `specs/tasks/active/T-2026-10-21-core-priority-scale.md` steps T002–T005 ticked with what landed
- Test: `apps/cli/src/*.spec.ts` that snapshot usage text, if any

- [ ] **Step 1:** `ugrep -rn "p0..p4" apps/cli/src` and update any usage snapshot spec first; run `pnpm -w exec turbo run build test --filter=@todoer/cli...` → FAIL if a snapshot exists.
- [ ] **Step 2:** Edit usage and the two docs; rerun → PASS.
- [ ] **Step 3:** Full gate: `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test pnpm -w exec turbo run build typecheck test && pnpm lint && sh scripts/check-migrations.sh` → all PASS.
- [ ] **Step 4: Commit** `docs: describe the P0-highest scale`
