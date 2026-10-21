# Priority scale: P0 is the highest

- **Date:** 2026-10-21
- **Status:** approved by the maintainer, 2026-10-21; [ADR 0019](../adr/0019-p0-is-the-highest-priority.md)
- **Task:** [`T-2026-10-21-core-priority-scale`](../../specs/tasks/active/T-2026-10-21-core-priority-scale.md)
  (C0 of the [web redesign plan](../plans/2026-10-03-plan-web-ux-redesign.md))

## Why

A task's `priority` is an integer 0–4. Today 0 means "no priority" and 4 is
the most urgent: the core sorts by `-priority`
(`packages/client-core/src/operations.ts`, `sortFor`), quick add defaults to
0, and the clients hide the 0 and show `p1`–`p4`.

The redesign reads the scale the other way, as Todoist does: **P0 is the
most urgent, P4 the least, and P4 is what a task gets when nobody says
otherwise.** The maintainer approved that on 2026-10-03 and on 2026-10-21
chose to change the stored values rather than flip them only on screen. A
display-only flip would leave the database, the API, the CLI's output and
every agent reading it on the opposite scale from the one people see.

## Goals

- One scale in storage, on the wire, in the core and in every client: P0
  highest, P4 lowest and default.
- The data already stored keeps its meaning: the same tasks are the most
  urgent after the change, and every saved view selects the same tasks.

## Non-goals

- **No backward compatibility.** The maintainer, 2026-10-21: todoer is barely
  in use, so the change does not have to survive an old client, an old
  server, or an outbox written before it. No protocol version, no gate in
  the contract, no conversion of queued operations. Everything is upgraded
  together.
- No separate "no priority" value. P4 is the ordinary task, as in Todoist.
- No restyling. Colours and badges for priorities are W2's, in the web.

## Anti-goals

- A view that selected tasks before the change and silently selects other
  tasks after it.
- Two scales living side by side anywhere: one in the database, another in a
  client.

## The design

### Stored values

The new value is `4 − old` for every task, live or tombstoned. The mapping
is one-to-one and is its own inverse: applying it twice gives the original
value back. Old 0 ("no priority") becomes 4, the new default; old 4 becomes 0.

`Task.priority` keeps its type and its 0–4 range; its default changes from 0
to 4 in `schema.prisma` and the database.

### The migration

One Prisma migration, plain SQL, in one transaction:

1. `UPDATE "Task" SET "priority" = 4 - "priority", "version" = "version" + 1, "seq" = nextval('change_seq')`.
   The new `seq` makes every replica pull the row again. The `version` bump
   sends a stale `delete` or base-versioned `set` from a replica that has
   not pulled yet to `conflict` instead of letting it pass
   (`apps/backend/src/sync/apply-op.ts`); `fieldTs` is left alone. Claude's
   call, after the builder check.
2. Rewrite every `View.filter` that names a priority. A priority appears in a
   filter only as the leaf `{ "priority": [n, …] }`, anywhere in an
   `and`/`or`/`not` tree (`packages/specs/src/filter.ts`). Each `n` becomes
   `4 − n`; the tree around it is unchanged. Views whose filter changed get
   a new `seq` and `version + 1`, as tasks do. The walk is a temporary plpgsql function the migration
   creates, uses and drops. Each mapped array is ordered by its new value.
3. `ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 4`.

A view's `sort` needs no rewrite: `priority` stays the sort's name and now
means ascending.

`prisma migrate dev` writes `DROP DEFAULT` on every `seq` and
`DROP SEQUENCE "change_seq"` into the generated SQL (trap 6 in
`.claude/CLAUDE.md`). Those lines are deleted before the migration is
applied; `scripts/check-migrations.sh` fails the build otherwise.

**Rollback:** `pg_dump` before deploying. Because the mapping is its own
inverse, running the same SQL again restores the old values if the dump is
not needed; the default goes back to 0 by hand.

### The core

- `sortFor` sorts by `priority` ascending, P0 first. The tie-break stays
  rank, then id.
- `parseQuickAdd` reads `pN` as N, as now, and defaults to 4 instead of 0.
- `edit` keeps accepting 0–4; the message stays "priority must be 0 to 4".
- The filter editor's starting condition for a new priority leaf
  (`apps/web/app/utils/filterTree.ts`, today `{ priority: [4] }`, "the most
  urgent") becomes `{ priority: [0] }`.

### The clients

- **TUI and web:** show `p0`–`p3` and hide `p4`, the default, the way they
  hide `p0` today. Every place that falls back to 0 for a missing or empty
  priority falls back to 4 (`apps/tui/src/fields.ts`, `line.ts`,
  `details.tsx`; the drawer's default in `TaskDrawer.vue`). Hiding the default keeps an ordinary row quiet; this is
  Claude's call, the mockups show every value and W2 may change it when it
  restyles the badges. The web's edits are C0's, not Codex's, although the
  plan gives `apps/web` to Codex: they are a predicate in `TaskRow.vue`,
  `KanbanCard.vue`, `PlacementChip.vue`, the drawer's default and the
  filter editor's starting leaf, and leaving them to W2 would merge a state
  with two scales.
- **CLI:** the `list` column stays the integer, since scripts and agents
  parse it (ADR 0015). The usage text says P0 is the highest and P4 the
  default.
- **Docs:** the OpenAPI description of `priority`, the CLI usage and any
  design doc that says 0 means "no priority" are corrected in the same PR.

### Existing replicas and the cut-over

After the migration every client must re-pull before it writes: the new
`seq` brings each task and view back down. A pending outbox entry written
before the upgrade is sent as it is, on the old scale; the non-goal above
accepts that. The order, written into the PR description and the task's
checkpoint, not automated:

1. Sync every client (CLI, TUI, open web tabs) so no outbox holds a write.
2. `pg_dump` the NAS database.
3. Deploy the image: `prisma migrate deploy` in the entrypoint runs the
   migration, and the SPA ships with it.
4. Rebuild the CLI and the TUI from the same commit, then sync each once.

## Tests

- A DB-backed migration spec: tasks at 0–4 and tombstones come out at 4–0
  with new `seq` and `version + 1`; filters with a priority leaf at the root, under `and`,
  `or`, `not` and two levels deep come out mapped, and a filter without one
  keeps its `seq`; a new task defaults to 4.
- Core specs: ascending sort with ties; the parser's default and `p0`.
- TUI and web specs: `p4` hidden, `p0` shown.

## Left to the builder

- How the migration spec reaches a database in the pre-migration state
  (seed through SQL after `migrate reset` to the previous migration, or
  another way that fits the backend's test setup).
- Splitting the work into PRs, as long as no merged state has two scales.
