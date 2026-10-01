# 13. Deletion is a tombstone with a retention contract

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Clients pull changes with `WHERE seq > since`. A physically deleted row has no
`seq` to be greater than, so it is invisible to that query.

## Decision

Deletion sets `deleted_at`; the row stays and takes a new `seq`. Tombstones are
retained for **90 days**, then physically deleted by a job the server runs at
startup and daily. Each user carries a **prune watermark**, the highest `seq`
among their pruned tombstones. A pull whose cursor is below it
(`0 < since < watermark`) is answered `410 Gone`, and the client discards its
replica and repeats with `since: 0`.

`since: 0` is the snapshot: every live row, no tombstones, and a cursor at or
above the watermark (refined below: a live task occurrence or TaskTag row
whose task or tag is itself tombstoned is left out too). It is never answered
`410`. There is no separate snapshot endpoint ([0012](0012-no-rest-surface.md)).

A tombstone that a live row still references is kept until the reference goes.

## Consequences

Without tombstones a client would never learn about deletions and would keep
showing tasks that no longer exist — silent data corruption rather than an
error. This is the one path in the design where doing nothing produces wrong
data instead of a failure, which is why it is an ADR and not a task.

Tombstone retention is therefore not a housekeeping detail but a **contract
with offline clients**: it states the longest a client may be away and still
catch up incrementally.

The `410` path has to be exercised by a test rather than discovered in
production, because the failure it prevents is invisible from the outside.

Completions are exempt from every pruning discussion: they are permanent
(see the habit tracker in the spec's out-of-scope section), and a cleanup job
that treated them as expendable would delete the data a future feature is made
of.

## Amendment (2026-09-26, plan C)

"A tombstone that a live row still references is kept" no longer covers
TaskTag or task occurrences: both cascade (`ON DELETE CASCADE`) when the
task's or tag's tombstone they reference is pruned, rather than holding it
back. Completions are still never pruned on their own — as `task_occurrence`
rows they go with their task, exactly as this ADR always meant. A snapshot
(`since: 0`) omits task occurrences and TaskTag rows whose task or tag is
tombstoned, so a client is never shown a child of a parent it was never told
about.

A task occurrence or TaskTag row written after its parent's tombstone — the
server does not refuse a reference to a tombstoned row — is cascaded away on
prune without raising the watermark. That is safe because every client is in
one of two states with respect to that child: it received the parent's
tombstone before the prune (an incremental pull that stayed below the
watermark) and already hides that parent's children under the tombstone
rule, or it never received the parent at all — a client bootstrapped from a
snapshot (`since: 0`) never receives a tombstone, and the snapshot itself
omits every task occurrence and TaskTag row whose task or tag is tombstoned
— so the same child is hidden under the absent-parent rule instead. A client
whose cursor is below the watermark is answered `410` and rebuilds from the
snapshot, landing in the second case. Clients MUST hide a task occurrence or
TaskTag row whose task or tag is tombstoned or absent from their replica.

## Amendment (2026-10-01, plan V2)

Three references added by the views design hold tombstones back differently:

- A status tombstone is kept while **any** task references it through
  `statusId`, a tombstoned task included — stricter than the rule above, the
  same as a project. A task whose `statusId` names a status the client does
  not have (pruned, or left out of a snapshot) is shown in the first
  non-completing status (views design, Q8).
- `originTaskId` holds nothing back: it has no foreign key, so the original
  task's tombstone is pruned while a copy of one of its occurrences lives,
  and the copy keeps an id that names no row (plan V2, departure 5).
- Ids inside a view's `filter` hold nothing back either. A predicate naming a
  pruned tag, project or status matches no task; a client that folds a
  duplicate into another row rewrites the filters that name it.
