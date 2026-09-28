# Plan C: recurrence, task occurrences and deterministic ids

Plan A left `rrule` and `dtstart` as columns nobody reads and deferred
`completion` and `exception` to plan C. Today the CLI has only `add` and `list`,
so there is no way to finish a task at all. This document settles how plan C
builds recurrence. The ADR 0002 pair of logs becomes one **task occurrence**
row per (task, occurrence), whose id is a **deterministic id** (UUIDv5 of the
natural key), toggled with `set` and never deleted. TaskTag moves to the same
pattern, which also fixes a detach-then-re-attach collision that exists today.
The server stays blind to rule *expansion* but validates rule *syntax* with a
small parser shipped in `@todoer/specs`; expansion lives in the CLI. It ships as
two plans: **C2** (server, contract, test vectors), then **C1** (CLI). Where
this document and an ADR disagree, the ADR changes; the list is under
[Follow-up to the records](#follow-up-to-the-records).

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **occurrence** | One date produced by expanding a task's `rrule` from its `dtstart`; null for a non-recurring task. | instance, run |
| **task occurrence** | The one synced row per (task, occurrence): id = UUIDv5(task_id, occurrence), `state` ∈ `open`, `done`, `skipped`. Replaces the separate completion and exception logs. | completion row, exception row, log entry |
| **deterministic id** | A row id derived as UUIDv5 from its natural key, so every client mints the same id for the same fact (task occurrence, TaskTag). | natural id, hash id |
| **current occurrence** | The occurrence `list` shows and `done` marks by default for a recurring task (see Q11). | next due, active occurrence |
| **test vectors** | The shared JSON file of `{ rrule, dtstart, window, expected[] }` cases every expander must pass (D18). | fixtures, golden files |
| **C2** | The server half of plan C: table, deterministic-id rules, create-merge, cascade, rrule parser, contract, vectors. | plan C part 2 |
| **C1** | The client half of plan C: expander, `--rrule`/`--from`, `done`/`skip`/`undo`, current occurrence in `list`. | plan C part 1 |

`completion` and `exception` survive as words for the `done` and `skipped`
states, not as table names.

## Why

A task list that cannot mark a task done is not yet a task list. The domain
design (section 4) and ADR 0002 describe recurrence as a rule plus two logs,
and plan A shipped the rule columns without anything that reads them. Plan C is
next rather than plan D (auth) because it grows the synced schema: in an
offline-first system each table added to the contract gets more expensive once
real replicas cache data, while plan D is almost entirely server routes that no
replica stores.

Working through the design exposed two defects in the as-written model:

- **Tombstones collide with natural keys.** `completion(task_id, occurrence)`
  is unique, and undo is a `delete` that leaves a tombstone, so completing the
  same occurrence again is a new row that violates the constraint (P2002,
  rejected). TaskTag has the same bug today: `@@unique([taskId, tagId])`, so
  detach then re-attach fails.
- **NULLs are distinct in a Postgres unique index**, so for a non-recurring
  task (`occurrence` null) the uniqueness the design relies on for idempotency
  does not exist.

## Locked decisions

### One task occurrence row with a state, replacing two logs (Q4)

**Decision.** One table, `task_occurrence`: `id` (deterministic, see below),
`task_id`, `occurrence` (date, nullable), `state` (`open` | `done` |
`skipped`), `completed_at` (timestamp, nullable), `value` (decimal, nullable,
reserved for v2 habits), plus the four protocol columns. `state` is merged by
the existing field-level LWW (ADR 0004).

- Done and skipped are mutually exclusive for one occurrence. With two tables,
  device X completing and device Y skipping the same Tuesday offline leaves
  both rows, and every client needs a tie-break rule; four implementations of a
  tie-break is the drift D18 exists to prevent. One field lets the server's
  merge settle it.
- The v2 habit tracker keeps what it needs: skipped (`state = skipped`) stays
  distinct from missed (no row, or `open`), and `value` sits on the same row.
- `open` is what undo writes; a row in `open` means the same as no row.

**Rejected.**

- *Two tables, each a toggle* (`completion.completed_at` nullable,
  `exception.skipped` boolean). Works, but pushes the done-vs-skipped
  resolution into every client.

**Cost.** ADR 0002's wording and the ER diagram in the domain design change.
The new table needs the hand-kept `nextval('change_seq')` default on `seq`
(trap #6), and every future `migrate dev` will try to drop it there too.

### Rows keyed by a natural key get a deterministic id and are toggled, never deleted (Q2)

**Decision.** A task occurrence's id is UUIDv5 over its natural key. Undo is
`set state=open`, never `delete`. The row is never tombstoned.

- The natural key becomes the primary key, so two offline devices acting on the
  same occurrence address the same row, and LWW settles complete-vs-undo.
- A null occurrence hashes the task id alone, so the NULL-distinct problem
  disappears without `NULLS NOT DISTINCT`.
- Nothing needs an index Prisma cannot model.

**Rejected.**

- *Partial unique index `WHERE deleted_at IS NULL` with `NULLS NOT DISTINCT`,
  hand-written in the migration.* Prisma models neither, so it repeats trap #6:
  every `migrate dev` would generate a statement dropping it.
- *Keep the plain constraint and document that re-completing is rejected.*
  Ships a bug that looks like correct behaviour until the first undo.

**Cost.** ADR 0005 is amended: ids are UUIDv7 minted by the client *except* for
deterministic-id tables. `create` of an existing id becomes normal for those
tables (see Q8).

### The server recomputes every deterministic id (Q7)

**Decision.** On `create` into a deterministic-id table the server recomputes
UUIDv5 from the fields and rejects the op if the id does not match. There is no
separate unique index on the natural key.

The derivation is frozen protocol:

- **namespace:** one fixed UUID, exported as a constant from `@todoer/specs`;
- **name, task occurrence:** `<task_id>:<YYYY-MM-DD>`, or `<task_id>:` for a
  null occurrence;
- **name, TaskTag:** `<task_id>:<tag_id>`;
- ids in the name are lowercase canonical UUID text.

The derivation is written into the OpenAPI description and covered by cases in
the test vectors file.

- A buggy or old client that sends a random UUIDv7 would otherwise create a
  second row for the same fact. `POST /sync` is the only write path (trap #5),
  so an invariant not enforced there is not enforced.
- With the id as the only uniqueness rule, the NULL and partial-index problems
  never return.

**Rejected.**

- *Trust the client, keep a unique index as a backstop.* Brings back exactly
  the index Q2 removed.

**Cost.** Changing the name encoding later orphans every existing row, so it
cannot change.

### `create` of an existing deterministic id merges field by field (Q8)

**Decision.** For deterministic-id tables, a `create` whose id already exists
is applied as one `set` per field, each with the op's `ts`, under per-field LWW.
The result is `applied`. For random-id tables a duplicate id is still rejected
(`a row with this id already exists`).

- Device X marks Tuesday done, device Y offline marks it skipped; both send
  `create`. The later action wins whichever arrives first. "First write wins"
  would let arrival order decide, which ADR 0004 exists to prevent.
- The list of deterministic-id tables lives in one place in the backend, next
  to the id derivation.

**Rejected.**

- *First write wins, second create is an `applied` no-op.* Arrival order
  decides.
- *Clients never `create` these rows; `set` on a missing row upserts.* Gives
  `set` two meanings and bends ADR 0006's three verbs for a subset of tables.

**Cost.** The create path forks by table.

### Children of a tombstoned parent cascade on prune (Q13)

**Decision.** The foreign keys from `task_occurrence.task_id` and
`task_tag.task_id` to `task`, and from `task_tag.tag_id` to `tag`, become
`ON DELETE CASCADE` (Prisma `onDelete: Cascade`). The pruning job drops its
`tags: { none: {} }` / `tasks: { none: {} }` guards for these relations.
Clients treat children of a tombstoned parent as gone.

- Verified in `prune.service.ts`: today prune deletes tombstoned TaskTag rows
  first, then a task only when it has no TaskTag rows, a tag only when it has
  none, and TaskTag's FK is `RESTRICT`. Once TaskTag and task occurrences are
  never tombstoned, any task that ever had a tag or a completion, and any tag
  ever attached, would never be pruned.
- A child of a tombstoned task is already dead to every client that saw the
  tombstone. A client that missed it is below the prune watermark and rebuilds
  from the snapshot after `410`. The physical cascade 90 days later tells no
  replica anything new.

**Rejected.**

- *Deleting a task or tag also tombstones its children in the same
  transaction.* A five-year daily task means about 1800 tombstones per delete,
  and it reintroduces "create on a tombstoned deterministic id", which the Q8
  merge does not cover.

**Cost.** ADR 0013's invariant weakens from "every disappearance is a
tombstone" to "every disappearance is a tombstone, or the pruning of a
tombstoned parent", and the ADR must say so.

### Rule syntax is validated by one parser in `@todoer/specs` (Q14)

**Decision.** A small parser for the supported subset lives in
`@todoer/specs`, next to the test vectors. The server and the CLI both use it.
On every `create`/`set` of a task the server also rejects:

- an `rrule` outside the subset (unknown key, `BYHOUR`/`BYMINUTE`/`BYSECOND`,
  malformed value, both `COUNT` and `UNTIL`);
- an `rrule` without a `dtstart`;
- an `rrule` on a subtask (ADR 0009). Verified: nothing enforces this today.

The subset is FREQ (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`), `INTERVAL`,
`BYDAY`, `BYMONTHDAY`, `BYMONTH`, `BYSETPOS`, `COUNT`, `UNTIL`, `WKST`
(domain design section 4).

- Which rules are legal is contract, so the parser belongs with the OpenAPI
  document. One copy means the server and the CLI cannot disagree about what
  `FREQ=MONTHLY;BYSETPOS=-1` means.
- A future web client writing `BYHOUR=9` would otherwise store a rule no client
  can expand.

**Rejected.**

- *A separate parser in `apps/backend`.* Two copies of the contract.
- *Only the CLI validates.* The server stores anything; trap #5.

**Cost.** `@todoer/specs` starts shipping runtime code rather than only the
OpenAPI document and generated types. The "parse" half of Q6 moves out of the
CLI.

### The expander lives in the CLI, is our own code, and the server never expands (Q3, Q6)

**Decision.** Occurrence expansion is our own code for the restricted subset,
written in `apps/cli`, tested against the vectors in `@todoer/specs`. It moves
to a shared package when a second TypeScript consumer (the web client) exists.
The server never expands a rule: it does not check that a written occurrence
belongs to the task's rule, only its shape (a `YYYY-MM-DD` date or null, the
task exists and belongs to the user).

- The subset is date-only (ADR 0010), so the hard parts of `rrule.js` (time
  zones, DST, times of day) are dead weight. Its known weak spots (`BYSETPOS`,
  JS `Date` UTC offsets leaking into dates) are exactly the edge cases the
  vectors list. Estimate: 200–300 lines.
- The Flutter client will need a port anyway, which is easier from code we
  understand line by line.
- `rrule` can change concurrently: ADR 0004 requires `baseVersion` for it
  precisely because a rule change strands occurrences. A server that checked
  membership would reject ops that were valid when queued.

**Rejected.**

- *`rrule` (rrule.js) from npm.* A new dependency whose complexity is in the
  parts we do not use.
- *A Temporal-based library.* Same trade, plus a younger ecosystem.
- *A shared `packages/recurrence` now.* A package with one caller.
- *Server rejects occurrences not produced by the rule.* Rejects offline-valid
  ops after a concurrent rule change.

**Cost.** We own the expander's correctness, and the vectors only cover as far
as their cases go. A web client means a move PR. Nothing server-side notices an
occurrence date that is well-formed but belongs to no rule.

### The current occurrence is the latest open one up to today, else the next (Q11)

**Decision.** For a recurring task, the current occurrence is the latest
occurrence on or before today if its state is open (no row, or `open`);
otherwise the first occurrence after today. Older missed occurrences are not
shown. `done`, `skip` and `undo` act on the current occurrence unless
`--on YYYY-MM-DD` names another. A non-recurring task's `done` writes the task
occurrence with a null occurrence, and the task leaves `list`.

- A task list is about what to do now. Five missed days of "water the plants"
  should not demand five actions, but today's still-open occurrence stays
  visible until it is done.
- Misses stay distinguishable (no row) for the v2 habit tracker.

**Rejected.**

- *The earliest open occurrence.* Missed occurrences pile up and each must be
  done or skipped.
- *Always the next occurrence on or after today.* Hides an overdue monthly bill
  the day after it was due.

**Cost.** A monthly bill missed yesterday disappears from `list` until next
month unless the user asks for it with `--on`.

## Routine choices

- **Plan C comes before plan D and tuxedo #362 (Q1).** Schema growth first;
  auth stays at register and login for now.
- **TaskTag moves to the deterministic-id pattern in plan C (Q5).** Its id
  becomes UUIDv5(task_id, tag_id) and detach becomes a `set` of a flag rather
  than a `delete`. Verified: no client writes TaskTag rows yet (the CLI has no
  tag support until #362), so the change touches only test data. #362 stays
  about tag *names*.
- **Recurrence enters the CLI as raw flags now, natural language later (Q9).**
  `add … --rrule 'FREQ=WEEKLY;BYDAY=MO' --from 2026-09-28`; `--from` defaults
  to today; the rule is checked with the `@todoer/specs` parser before it is
  queued (exit 2 on failure). Natural-language quick-add (`every monday`) may
  come later as sugar that produces the same flags; it is not promised.
- **A task is named by its full id or a unique suffix (Q10).** `list` shows the
  last 6 hex digits of the id as a short ref; `done`, `skip` and `undo` accept
  the full id or a unique suffix of at least 4 hex digits. An ambiguous suffix
  is a usage error (exit 2) that lists the candidates. Suffix, not prefix:
  UUIDv7 begins with a 48-bit millisecond timestamp, so prefixes of tasks
  created minutes apart are nearly identical. Help text states it is a suffix.
- **Two plans, C2 then C1 (Q12).** C2: `task_occurrence` table, deterministic-id
  derivation and recomputation, create-merge, TaskTag migration, cascade and
  prune changes, rrule parser, OpenAPI schema, test vectors file. C1: expander,
  `--rrule`/`--from`, `done`/`skip`/`undo`, current occurrence and short ref in
  `list`. The vectors ship with the contract because they live in
  `@todoer/specs`.

## Verified facts

- `apps/cli/src/run.ts` has `add`, `list` and `outbox` only; `list` prints
  `<priority>  <title>` with no id.
- `apps/backend/prisma/schema.prisma` has `rrule String?` and
  `dtstart DateTime? @db.Date` on `Task`, and no completion or exception model.
- `apps/backend/src/sync/apply-op.ts` rejects `create` of an existing id (`a row
  with this id already exists`), and `set rrule` already requires
  `baseVersion`.
- TaskTag has `@@unique([taskId, tagId])`, so detach (tombstone) then re-attach
  fails today.
- `prune.service.ts` prunes TaskTag tombstones first, then tasks with no
  TaskTag rows, then tags with no TaskTag rows; TaskTag's FK is `RESTRICT`.
- Nothing enforces "a subtask carries no rrule" or "rrule needs dtstart".
- No client writes TaskTag rows; the CLI reports `#project` and `@tag` as
  parsed, not stored.

## Risks

- **The UUIDv5 name encoding is permanent.** A mistake in it (case, separator,
  date format) cannot be fixed without migrating every row on every replica.
  Mitigation: vectors cases for the derivation, written before either side
  implements it.
- **Vectors authored before any implementation.** C2 writes expected values
  that C1's expander meets for the first time. A disagreement in C1 must be
  checked against RFC 5545 first; the vector may be wrong.
- **One more hand-kept `seq` default.** `task_occurrence.seq` joins trap #6;
  the migration that creates the table must set the default by hand, and later
  generated migrations will try to drop it.
- **Stranded occurrences.** A rule change leaves task occurrences for dates the
  new rule no longer produces. They are kept and ignored by expansion; this is
  the existing ADR 0004 trade, now visible.
- **Clients must hide children of a tombstoned or absent parent.** A client
  that shows a task occurrence or TaskTag whose task or tag is tombstoned, or
  that it never received at all (a snapshot omits both), shows a ghost until
  the prune.
- **Current-occurrence rule hides yesterday's miss.** Acceptable for a task
  list; wrong for a habit view, which v2 will build separately.

### Notes for C1

- C1 derives done/skipped from `state` alone; per-field LWW can leave a
  `completedAt` from a losing `create` sitting next to `state: skipped`, so
  C1 must not infer completion from `completedAt` on its own.
- Undo sets `state: open` and `completedAt: null`.
- C1 hides a task occurrence or TaskTag row whose task or tag is tombstoned
  or absent from its replica (see I1).

## Deferred

- **Natural-language recurrence in quick-add** (Q9 C). Reopens when a human
  shell (TUI or web) exists or agents struggle with raw RRULE.
- **Moving the expander to a shared package.** Reopens when the web client is
  built.
- **Subtask completion in the CLI.** C1 reads a subtask on its parent's rule
  and dates (departure 3, "Departures in plan C1"); the CLI still cannot
  create one.

## Open threads

Resolved by the C1 plan
([docs/plans/2026-09-28-plan-c1-cli-recurrence.md](../plans/2026-09-28-plan-c1-cli-recurrence.md)):

- **Missed occurrences:** `--on` is the only way to reach a missed occurrence
  in C1; a listing of them is left to a later client.

## Departures in plan C2

Building C2 surfaced eight places where the plan as implemented differs from
what this document says. Each is recorded in full, with its reasoning, at the
top of
[the plan](../plans/2026-09-26-plan-c2-task-occurrence.md#where-this-plan-departs-from-the-design-doc);
this is the index.

1. **A `create` that wins on no field answers `superseded`, not `applied`.**
   "Nothing changed" is the same outcome a losing `set` already reports.
2. **`value` is `Float`, not `decimal`.** Prisma turns a `Decimal` into a
   string through `JSON.stringify`, and a habit quantity does not need exact
   decimal arithmetic.
3. **TaskTag's flag is `attached Boolean @default(true)`**, not a nullable
   `detached_at`. This closes the open thread this document left on the exact
   shape of that flag: a boolean mirrors `state` and needs no clock.
4. **A snapshot omits children of a tombstoned parent**, rather than leaving
   clients to infer it. `since: 0` already omits tombstones, so without this a
   snapshot would deliver task occurrences and TaskTag rows whose task or tag
   the client is never told about.
5. **Date columns were fixed before anything else.** Prisma rejects a bare
   `YYYY-MM-DD` for a `@db.Date` column, so `scheduledOn`, `dueOn` and
   `dtstart` could not be written through `/sync` at all until this shipped —
   and `occurrence`'s id derivation hashes the date, so it had to work first.
6. **The parser is strict about case.** RFC 5545 is case-insensitive;
   `parseRrule` accepts upper case only, so two stored strings for the same
   rule never look different.
7. **`state` is a `String`, checked in code, not a Postgres enum** — the same
   choice already made for `AppliedOp.status`, because a Postgres enum needs
   its own migration for every new value.
8. **TaskTag's `@@unique([taskId, tagId])` becomes two plain indexes.** The
   derived id is the uniqueness rule (Q7); the indexes keep the cascade and
   the lookups by task or tag cheap.

## Departures in plan C1

Building C1 surfaced six places where the plan as implemented differs from
what this document says. Each is recorded in full, with its reasoning, at the
top of
[the plan](../plans/2026-09-28-plan-c1-cli-recurrence.md#where-this-plan-departs-from-the-design-doc);
this is the index.

1. **`undo` reopens the latest done or skipped occurrence, not the current
   one.** Q11 puts all three commands on the current occurrence, but after
   `done` the current occurrence has already moved to the next, open one, so a
   plain `undo` there would reopen nothing.
2. **The next occurrence skips ones already closed.** Q11's "first occurrence
   after today" would keep showing tomorrow after it was marked done in
   advance; C1 takes the first open one after today, looking at most 100
   occurrences and ten years ahead.
3. **A subtask reads its parent's rule and dates.** "Deferred" left subtask
   completion for when the CLI can create one; other clients already can, and
   without this a subtask of a recurring task would look like a one-off in
   `list`, and `done` would write a null occurrence — the defect ADR 0009
   describes. The cost is one parent lookup.
4. **Two expander details follow python-dateutil, not a reading of the RFC.**
   A WEEKLY rule's first week offers no candidates before `dtstart`, so
   BYSETPOS does not count them; a repeated BYMONTH value yields one
   occurrence. RFC 5545 is silent on the first and lets the parser through on
   the second as a duplicate; two vectors pin both against the reference
   implementation.
5. **`list` gains two columns.** A line is `<ref>  <priority>  <title>`, plus
   `  <YYYY-MM-DD>` for a recurring task; each `--json` row gains `ref` and
   `occurrence`.
6. **The CLI's tests run with `TZ=UTC`.** "Today" is the local date
   (ADR 0010), and the fixed test clock (`2026-09-26T10:00Z`) would fall on
   another day in UTC+14; `apps/cli/vitest.config.mjs` pins the zone.

## Follow-up to the records

- **ADR 0002:** amend — one task occurrence row with a state, not two logs.
- **ADR 0005:** amend — deterministic-id tables are the exception to
  client-minted UUIDv7; state the derivation.
- **ADR 0006:** amend — `create` of an existing deterministic id merges as
  per-field `set`.
- **ADR 0009:** amend — the subtask's task occurrence id uses the parent's
  occurrence date.
- **ADR 0013:** amend — children of a tombstoned parent disappear by cascade on
  prune.
- **Domain design, sections 2 and 4:** new ER diagram and table description;
  the parser in `@todoer/specs`.
- **`.claude/CLAUDE.md`, trap #6:** "the four synced tables" becomes "every
  synced table" — a count goes stale the next time one is added.
