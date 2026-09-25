# 2. Recurrence is a rule, not rows

- **Status:** accepted
- **Date:** 2026-09-25

## Context

A recurring task can be stored as one row per occurrence, generated forward to
a horizon, or as one row holding a rule plus logs of what was completed and
what was skipped. Every client is offline-capable, so whichever is chosen has
to work without a server.

## Decision

One row with an `rrule`, plus a `completion` log and an `exception` log, both
keyed by `(task_id, occurrence)`.

## Consequences

An occurrence carries nothing of its own beyond done-or-not, so it has no
identity worth a row: materialising a five-year daily task spends 1825 rows to
store 1825 booleans.

"Move every future occurrence" stays one operation rather than one per row,
which matters doubly offline, where each of those rows would be a separately
queued operation.

The horizon problem disappears. With materialised occurrences, something has to
generate more of them, and an offline client that reaches the end of the
generated window loses the task until it next synchronises.

The cost is that every client expands the rule to answer "what is due today".
This is not a saving materialisation would have offered: an offline client
would have had to generate occurrences itself, which is the same expansion
pointed the other way.

Reversal is a data migration plus a change in three clients. It is expensive,
which is why the criterion is written down: if an occurrence ever acquires data
of its own — notes for one Tuesday, subtasks for one run, logged time — it has
gained identity and this decision should be revisited. See
[0009](0009-subtask-completion-uses-the-parent-occurrence.md) for how subtasks
sit on the parent's axis rather than acquiring one.
