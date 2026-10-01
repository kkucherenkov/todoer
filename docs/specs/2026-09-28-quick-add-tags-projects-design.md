# Quick-add projects and tags as rows (tuxedo #362)

The CLI's quick-add parses `#project` and `@tag` and, until now, stores
neither: it prints a note that they were dropped. This document settles how
they become rows. The deciding problem is offline creation: two clients that
both create `@phone` while disconnected mint two tags with different ids.
Instead of making the name the identity, the design **tolerates duplicate
names and merges them automatically**. Clients treat live tags (and projects)
with the same normalised name as one. After every pull, a client that sees
duplicates moves their references to the one with the lowest id and deletes
the rest; because the winner is deterministic, two clients merging at once
converge. `@phone` stores the name `@phone` (a context, ADR 0007); an unknown
name is created on the spot; archived projects are out of play. The work is
entirely client-side plus one shared name function in `@todoer/specs`, and
needs no server change.

## Terms

| Term | Definition | Avoid |
| --- | --- | --- |
| **quick-add** | The text of `todoer add`, parsed for markers: `p0..p4` priority, `@name` tag, `#name` project. | smart add, natural input |
| **context** | A tag whose name begins with `@` — derived from the name, never a stored flag (ADR 0007). | context flag, location |
| **duplicate name** | Two live tags (or two live, non-archived projects) of one user whose names match under the name rule. | conflict, collision |
| **name rule** | Two names match when they are equal after Unicode NFC normalisation and case folding; the stored spelling is kept as typed. | fuzzy match |
| **merge** | Folding duplicates into the one with the lowest id: references moved to it, the rest deleted. | dedupe, reconcile |
| **winner** / **loser** | The lowest-id row among duplicates, and every other row among them. | primary, secondary |

## Why

A task list that cannot carry a project or a context is missing half of
quick-add: `todoer add "call the bank @phone #finance p2"` keeps only the
title and priority today. Storing the markers means resolving names to rows,
and in an offline-first system two clients can create the same name before
either has heard of the other's. Tuxedo #362 recorded this as the open
question between ADR 0005 (client-generated ids) and ADR 0007 (tags are named
things that can be renamed).

## Locked decisions

### Duplicate names are tolerated; clients treat same-named rows as one (Q1)

**Decision.** Tags and projects keep random UUIDv7 ids (ADR 0005). Two live
rows may share a name. Every client resolves, displays and filters by name
under the name rule, so both `@phone` rows behave as one tag.

- Duplicates arise only from a genuinely offline race; online, quick-add
  finds the existing row first.
- No server change, and ADR 0007's cheap rename (an ordinary `set`) stays.

**Rejected.**

- *Tag id = UUIDv5 of the normalised name* (C2's pattern). Names are mutable:
  recreating `phone` after renaming it to `mobile` would derive the renamed
  tag's id, and the create's LWW merge would rename it back. A deleted tag's
  tombstone would also block recreating its name.
- *The server refuses a create whose name matches a live row.* The late
  client's tag, and its TaskTag with it, fail — data lost at exactly the
  moment offline-first promises it will not be.
- *Immutable names derived into the id; rename = new tag plus moving every
  TaskTag.* Turns ADR 0007's rename into a bulk operation.

**Cost.** Until a merge runs, two rows can drift (a colour set on one, a
rename on the other). The automatic merge below removes them.

### `@phone` stores the name `@phone` (Q2)

**Decision.** The `@` is part of the stored name. Every tag quick-add creates
is therefore a context. Plain tags (no `@`) are not creatable from quick-add;
a later explicit command or client can create them.

**Rejected.**

- *Store `phone`.* Contexts could not be created from quick-add at all, and
  the classification would depend on something other than the name.
- *A second marker (`+errand`) for plain tags.* Collides with the todo.txt
  habit where `+` means project.

**Cost.** No way to create a plain tag from the CLI until something asks for
one.

### The name rule is NFC plus case folding, in `@todoer/specs` (Q4)

**Decision.** Two names match when `name.normalize('NFC').toLowerCase()` (or
an equivalent case fold) are equal. The stored spelling stays as typed. The
function lives in `@todoer/specs`, beside `parseRrule`, so every TypeScript
client applies the same rule; future ports copy it and test against shared
cases.

**Rejected.**

- *Exact match.* `@Phone` and `@phone` would fork a tag because an agent
  capitalised differently from its human.
- *Also ignore `-`/`_`.* Guesses at intent and makes the rule hard to state.

**Cost.** A user cannot keep `@Work` and `@work` apart.

### Archived projects are out of play (Q5, Q8)

**Decision.** An archived project is never matched by `#name`, never counted
as a duplicate, and never a merge winner. `#finance` next to an archived
`finance` creates a new project. A tombstoned tag or project is gone and never
matches either.

**Rejected.**

- *Match an archived project and unarchive it.* Rejected by the maintainer:
  archiving is deliberate, and a quick-add should not reverse it.
- *Match it and leave it archived.* Files a live task where no view shows it.
- *Let archived projects join the merge with live winning.* Archiving a
  project and later creating one of the same name would move the archived
  project's tasks into the new one.

**Cost.** Two projects named `finance`, one archived, coexist indefinitely —
which is what archiving means.

### The merge runs on every pull and queues its operations (Q7, Q9)

**Decision.** After each pull, a client computes duplicates from the replica
with its outbox overlaid. For each duplicate group it queues the merge
operations (next section). They are delivered by the next command's flush,
like any other queued operation; the command that found them does not flush
again.

- Merging after the pull sees every duplicate the server holds; merging before
  it would work from a stale replica.
- Two clients that pull the same duplicates queue the same merge. That is
  harmless: the winner is deterministic, TaskTag creates are idempotent by
  derived id (C2), and a second delete of an already-deleted loser is
  rejected per operation without affecting the rest.

**Rejected.**

- *Defer the merge until a second client exists.* Rejected by the maintainer:
  build it now.
- *An explicit `todoer tags merge` command.* Leaves duplicates in place until
  someone remembers.
- *Flush again in the same command.* Doubles the round trips of every command
  that finds a duplicate.
- *Merge before the flush.* Misses the duplicate that just arrived.

**Cost.** A duplicate survives on the server until some client's next
command. Merge operations are not the running command's own, so a failure
among them surfaces as a failed outbox entry (`todoer outbox`), not as the
command's exit code.

### Losers are emptied and deleted; the winner keeps its own fields (Q10)

**Decision.** For each loser:

- **tag:** for every live, attached TaskTag `(task, loser)`, queue
  `create TaskTag(task, winner)` (derived id) and `set attached = false` on the
  old one; then `delete` the loser with its `baseVersion`.
- **project:** for every live task with `projectId = loser`, queue
  `set projectId = winner`; then `delete` the loser with its `baseVersion`.

The winner keeps its own name, colour and rank. Nothing is copied from a
loser.

**Rejected.**

- *Keep the loser as an empty row.* The next merge would find it again, and
  clients unaware of the name rule would still show two.
- *Copy fields the winner lacks.* No clear rule when both have one.

**Cost.** A rename made on the loser by another device at the same moment is
lost with it. The delete needs the loser's `baseVersion`, so a concurrent edit
makes it conflict; that operation fails in the outbox and the next merge
retries with the new version.

## Routine choices

- **Quick-add creates unknown names (Q3).** An unknown `@name` or `#name`
  queues a tag or project create, then the task (with `projectId`) and its
  TaskTag, in that order in one outbox; outbox order guarantees the server
  sees the tag before the TaskTag and the project before the task. What was
  created is reported on stderr, so a typo (`@phnoe`) is visible.
- **`list` shows and filters (Q6).** A text line appends `#project @tag…`
  after the title; `--json` rows carry the project name and tag names;
  `list @phone` and `list #finance` filter by name under the name rule, AND
  when several are given. Filtering by name is also what makes tolerated
  duplicates invisible to the caller.
- **Projects follow the tag rules** (tolerated duplicates, resolved by name,
  created when unknown), except for archiving (above).

## Verified facts

- `Tag` has `id`, `name`, `color`; `Project` has `id`, `name`, `rank`,
  `archivedAt` (`apps/backend/prisma/schema.prisma`). Neither has a unique
  index on `name`, so duplicates are already storable.
- TaskTag ids are UUIDv5 of `<taskId>:<tagId>` and detach is
  `set attached = false` since plan C2; the server merges a create of an
  existing TaskTag id field by field.
- `parse-quick-add.ts` already parses `#project` and `@tag` (tokens must stand
  alone) and `planAdd` reports them as "parsed but not stored".
- A tag or project `delete` needs `baseVersion`; the server does not refuse
  deleting a tag with TaskTag rows or a project with tasks, and pruning a
  tombstoned tag cascades to its TaskTag rows (plan C2).

## Risks

- **The name rule is a contract between clients.** A client that folds case
  differently (a future Dart port) sees different duplicates and merges
  differently. Mitigation: shared test cases for the rule next to the rrule
  vectors.
- **Merge storms.** Every client that pulls a duplicate queues the same merge.
  Idempotent derived ids keep the result right; the cost is redundant
  operations, some rejected as already applied.
- **Merge versus concurrent edits.** A loser renamed or recoloured elsewhere
  loses that edit; a conflicting delete leaves the loser in place until the
  next merge.
- **Quick-add typos create rows.** Reported on stderr, not refused.

## Deferred

- **Plain (non-`@`) tags from the CLI.** Reopens when a caller needs one; the
  likely shape is an explicit `todoer tag add <name>`.
- **Renaming tags and projects from the CLI.** Not asked for; a rename is an
  ordinary `set` whenever it is built.

## Departures in the plan

The [implementation plan](../plans/2026-10-01-plan-quick-add-tags.md#where-this-plan-departs-from-the-design-doc)
departs from this document in four places, and the plan wins where they differ.

1. **Only server-confirmed rows are merged.** A tag still pending in the outbox
   has no `version`, and a loser cannot be deleted without a `baseVersion`, so
   the merge ignores rows without a numeric `version`. Quick-add still reuses
   a pending tag by name.
1. **A tag named twice in one add (`@a @A`) is one tag and one TaskTag.**
1. **Created labels and queued merges are reported on stderr**
   (`note: created @phone`, and a merge queued after a pull); stdout and
   `--json` keep their shape apart from the new `project` and `tags` fields.
1. **A pair of duplicates attached to one task shows once**, spelled as the
   lowest-id tag spells it.

Two behaviours are narrower than the design reads, and neither is a departure
the plan chose:

- `list` still shows the name of an archived project a task belongs to.
  Archiving only takes a project out of matching and merging.
- Quick-add may reuse a lower-id row still waiting in the outbox, while the
  merge picks its winner only among server-confirmed rows. The two converge
  after the next sync.

## Open threads

None.
