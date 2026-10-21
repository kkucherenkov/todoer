# 19. P0 is the highest priority

- **Status:** accepted
- **Date:** 2026-10-21

## Context

A task's `priority` is an integer 0–4. Until now 0 meant "no priority" and
4 the most urgent. The web redesign, Todoist and the maintainer read the
scale the other way. Flipping it only on screen would leave the database,
the API and every agent reading the CLI on the opposite scale from the one
people see.

## Decision

P0 is the most urgent and P4 the least; P4 is the default. The stored
values change once, `new = 4 − old`, for tasks and for the priority leaves
of saved view filters, in one migration that gives each changed row a new
`seq` and `version + 1`. The sort by priority is ascending. There is no
"no priority" value.

No backward compatibility: todoer is barely in use, so an old client, an
old server or an outbox written before the change is not guarded against.
Clients sync before the upgrade and are rebuilt with it. Design:
`docs/specs/2026-10-21-priority-scale-design.md`.

## Consequences

`priority` reads the same everywhere: in Postgres, on the wire, in the CLI's
`list` and in every client. A view selects the tasks it selected before.

The mapping is its own inverse, so running the migration's SQL a second
time undoes it.

An operation queued before the upgrade and sent after it lands on the old
scale; the cut-over order in the design is what prevents that, not code.
