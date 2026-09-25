# 9. Subtasks live on the parent's occurrence axis

- **Status:** accepted
- **Date:** 2026-09-25

## Context

The hierarchy is project → task → subtask, exactly two levels of task. A
recurring parent — "clean the kitchen", weekly — has subtasks. Completing
"dishes" means completing it *this week*.

## Decision

A subtask carries no `rrule` of its own. Its completions are keyed by the
**parent's** occurrence date. Depth is enforced by the server, not by clients.

## Consequences

The schema needs no change: `completion.occurrence` already holds a date.
The rule is recorded because the obvious implementation gives a subtask
`occurrence = NULL` and extinguishes it permanently the first time it is
completed — a defect that would look like correct behaviour for one week.

Depth is enforced server-side because operations arrive from an offline queue.
A client with a bug, or an old version, will send a three-level reference, and
there is nobody else in the path to catch it.

Completing a parent does not complete its subtasks, and completing every
subtask does not complete the parent. A cascade turns one user action into N+1
queued operations, and two clients cascading in opposite directions offline
produce a result that depends on arrival order. The parent shows derived
progress — "2 of 3" — which is also more honest than a checkmark over an
unfinished list.
