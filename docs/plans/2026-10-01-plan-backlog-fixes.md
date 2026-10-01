# Backlog fixes (#390, #391, #361, #407) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** settle four backlog items the way the client-shells interview
decided: idempotent marks on closed one-off tasks, no deleting a task with
live subtasks, a CI guard for the trap-6 migration statements, and
`TRUST_PROXY`.

**Architecture:** four independent changes. CLI `run.ts` (#390), the sync
service plus one data migration (#391), a POSIX check script in Shell tests
(#361), and `AppConfig` plus `main.ts` (#407).

**Tech Stack:** TypeScript, NestJS 11, Prisma 6.19, POSIX sh. No new
dependencies.

**Spec:** [`docs/specs/2026-10-01-client-shells-design.md`](../specs/2026-10-01-client-shells-design.md),
section "Backlog decisions". Task spec:
[`specs/tasks/active/T-2026-10-01-backlog-decisions.md`](../../specs/tasks/active/T-2026-10-01-backlog-decisions.md).

## Global Constraints

- **Exit codes:** usage error 2, refusal 1, conflict 4, unreached 5; a
  no-op mark exits 0 and sends nothing.
- **Server:** one op, one row; a refusal is a per-operation `rejected` with a
  reason, never a 500.
- **Trap 6:** generated migrations get their `DROP DEFAULT` on `seq` and
  `DROP SEQUENCE "change_seq"` deleted; the new guard enforces it.
- **Tests:** backend
  `DATABASE_URL=postgresql://todoer:todoer@localhost:5433/todoer_test JWT_SECRET=0123456789abcdef0123456789abcdef pnpm --filter @todoer/backend test`;
  CLI `pnpm --filter @todoer/cli test`; shell `sh scripts/<name>.test.sh`.
- **Commits:** Conventional Commits with a scope, body says why, no
  `Co-Authored-By` trailer; `pnpm format` first.

## Review Focus

1. **`done` twice on a one-off task** after a lost response: the second exits
   0, sends nothing, and `--json` returns the existing occurrence (Task 1).
2. **A batch that deletes the subtasks and then the parent** is applied in
   order and fully succeeds (Task 2).
3. **The guard against the existing migrations** passes, and fails on a
   migration with the trap-6 statements (Task 3).
4. **`TRUST_PROXY=abc` or `TRUST_PROXY=-1`** — what express accepts and what
   the config refuses (Task 4).

---

### Task 1: Marks on a closed one-off task (#390)

**Files:** `apps/cli/src/run.ts`, `run.spec.ts`, `apps/cli/src/usage.ts`.

- [ ] **Step 1: Tests** (`describe('recurrence and marks')`, one-off task):
  - `done`, then `done` again → second run: exit 0, `store.pending()`
    unchanged from after the first (nothing queued), stdout says it is
    already done; `--json` `data` is the existing occurrence row;
  - `skip` then `skip` → same;
  - `done` then `skip` → `UsageError` matching
    `/already done — undo it first/`; `skip` then `done` →
    `/already skipped — undo it first/`; nothing queued;
  - a recurring task keeps today's behaviour (marks act on the current
    occurrence; `done --on <closed date>` re-marking the same state is also a
    no-op, a different state is the same `UsageError`).
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — in the mark branch, after `pickOccurrence`,
      read the occurrence's current state with `stateOf(marks, taskId)(occurrence)`.
      For `done`/`skip`: same state as `MARK[command]` → return
      `{ exit: synced-of-a-flush, stdout, stderr }` without queuing (still
      flush first, like `list`, so the answer reflects the server); the other
      closed state → `UsageError(\`already ${state} — undo it first\`)`.
      `undo` is unchanged.
- [ ] **Step 4:** HELP: in the done/skip lines, "repeating the same mark does
      nothing (exit 0); switching done and skipped needs undo first".
- [ ] **Step 5: Mutations:** drop the same-state branch → the repeat test
      goes red; drop the other-state branch → the switch test goes red.
- [ ] **Step 6: Commit** `fix(cli): make a repeated mark a no-op and refuse
      switching done and skipped` — body: ADR 0015 callers retry; a silent
      flip rewrote completedAt.

---

### Task 2: No deleting a task with live subtasks (#391)

**Files:** `apps/backend/src/sync/sync.service.ts`, `sync.service.spec.ts`,
a new migration, `docs/specs/2026-09-25-domain-and-sync-design.md` (the depth
rule's paragraph), `.claude/CLAUDE.md` trap 5 (one clause).

- [ ] **Step 1: Tests** (`sync.service.spec.ts`):
  - delete of a task with a live subtask → `rejected`,
    `a task with subtasks cannot be deleted — delete its subtasks first`; the
    task stays live;
  - one batch `[delete subtask, delete parent]` → both `applied`;
  - delete of a task whose only subtasks are tombstoned → `applied`;
  - a subtask delete is never affected.
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — in `applyOne`, for `table === 'task'` and
      `op.kind === 'delete'`, after `lockRows` and before `applyOp`, look up
      `task.findFirst({ where: { parentId: op.id, userId, deletedAt: null }, select: { id: true } })`;
      found → outcome `rejected` with the reason above. Extend
      `referenceRejection`'s doc comment (or add a sibling function
      `deleteRejection` beside it) so the depth rules are described in one
      place.
- [ ] **Step 4: Migration** — `prisma migrate dev --create-only --name
      tombstone_orphan_subtasks` against `todoer_test` (it will be empty of
      schema changes; delete the trap-6 statements), body:

```sql
-- A live subtask under a tombstoned parent: the server never cascaded
-- deletes (#391). Tombstone it the way a delete would — a new seq, so
-- clients pull the tombstone, and a version bump.
UPDATE "Task" AS child
   SET "deletedAt" = parent."deletedAt",
       "version" = child."version" + 1,
       "seq" = nextval('change_seq'),
       "updatedAt" = CURRENT_TIMESTAMP
  FROM "Task" AS parent
 WHERE child."parentId" = parent."id"
   AND child."deletedAt" IS NULL
   AND parent."deletedAt" IS NOT NULL;
```

  Test it: in `sync.service.spec.ts` (or a dedicated spec) insert a
  tombstoned parent and a live child with Prisma, run the SQL with
  `$executeRawUnsafe` read from the migration file, expect the child
  tombstoned with a higher `seq`.
- [ ] **Step 5: Docs** — domain design: the depth rule gains "a task with live
      subtasks cannot be deleted; clients delete the subtasks first, in the
      same batch". CLAUDE.md trap 5: add "no deleting a task with live
      subtasks" to the invariants list.
- [ ] **Step 6: Mutation:** drop the check → the first test goes red.
- [ ] **Step 7: Commit** `fix(backend): refuse deleting a task that has live
      subtasks` (code + docs) and `fix(backend): tombstone subtasks orphaned
      by earlier deletes` (migration + its test).

---

### Task 3: A CI guard for trap 6 (#361)

**Files:** create `scripts/check-migrations.sh`,
`scripts/check-migrations.test.sh`; modify `.github/workflows/test.yml`
(Shell tests job), `.claude/CLAUDE.md` (trap 6: "CI checks it").

- [ ] **Step 1: Test script** `check-migrations.test.sh` (POSIX, in the style
      of `check-pr-title.test.sh`): builds temporary migration folders in
      `mktemp -d` and asserts the guard:
  - passes on a folder with a clean `migration.sql`;
  - fails (exit 1, message naming the file) on `DROP SEQUENCE "change_seq";`;
  - fails on `ALTER TABLE "Task" ALTER COLUMN "seq" DROP DEFAULT;`;
  - passes on the repository's real `apps/backend/prisma/migrations`.
- [ ] **Step 2:** run — FAIL (no guard).
- [ ] **Step 3: Implement** `check-migrations.sh [dir]` (default
      `apps/backend/prisma/migrations`): `grep -n` each `*/migration.sql` for
      `DROP SEQUENCE "change_seq"` and for `"seq" DROP DEFAULT`
      (case-insensitive), print `file:line: <statement>` and a pointer to
      trap 6 in `.claude/CLAUDE.md` for every hit, exit 1 if any.
      Shebang `#!/usr/bin/env sh`, `set -eu`, nothing non-POSIX (trap 4).
- [ ] **Step 4: CI** — the Shell tests job runs `sh scripts/check-migrations.test.sh`
      and `sh scripts/check-migrations.sh`.
- [ ] **Step 5:** `sh -n` both; run both.
- [ ] **Step 6: Commit** `ci: fail a migration that drops change_seq or a seq
      default` — body: trap 6 depended on memory; the init migration's
      hand-written defaults must survive every generated migration.

---

### Task 4: `TRUST_PROXY` (#407)

**Files:** `apps/backend/src/config/app-config.ts`, `app-config.spec.ts`,
`apps/backend/src/main.ts`, `README.md`, `turbo.json` only if the variable
must reach a task (it does not — runtime only).

- [ ] **Step 1: Tests** (`app-config.spec.ts`):
  - unset or empty → `trustProxy` is `undefined`;
  - `1` → `1` (number of hops); `0` → `0`;
  - `loopback`, `10.0.0.0/8`, `loopback, 172.16.0.0/12` → the string as is;
  - `-1`, `1.5` → throws `TRUST_PROXY must be a hop count or a list of
    addresses/subnets`; `true` → throws as well (trusting every hop is what
    the decision rejects).
- [ ] **Step 2:** run — FAIL.
- [ ] **Step 3: Implement** — `readonly trustProxy = this.proxyTrust('TRUST_PROXY');`
      returning `number | string | undefined` with the rules above; in
      `main.ts`, after `NestFactory.create`, when defined:
      `app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);`
      with a comment pointing at the README and the rate limits.
- [ ] **Step 4: README** — replace the proxy warning with: set
      `TRUST_PROXY` to the number of proxies in front (usually `1`) or their
      addresses; unset, every client behind a proxy shares one IP for the
      rate limits.
- [ ] **Step 5: Mutation:** skip the `set` call → add one backend test that
      builds the app the way `main.ts` does if that is cheap; otherwise state
      that the wiring is covered by reading and by the README example.
- [ ] **Step 6: Commit** `feat(backend): trust a configured reverse proxy for
      client IPs` — body: per-IP limits were instance-wide behind a proxy.

---

### Task 5: Close out (controller)

- [ ] Gates, task spec to `done/`, PR, merge after the four gates; close
      tuxedo #390, #391, #361, #407; dnote changelog line.
