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
above the watermark. It is never answered `410`. There is no separate snapshot
endpoint ([0012](0012-no-rest-surface.md)).

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
