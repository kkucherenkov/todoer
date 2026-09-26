# 12. There is no REST surface

- **Status:** accepted
- **Date:** 2026-09-25

## Context

The obvious API for a task manager is a resource per entity with filters and
pagination. Every client here holds a full local replica.

## Decision

`POST /sync` is the entire data plane, including the first sign-in and
recovery from [0013](0013-tombstones-and-the-retention-contract.md): both are
a request with `since: 0`. There are no resource endpoints.

## Consequences

"Today's tasks tagged `@home`, ordered by rank" is a local query. Filtering,
sorting and pagination are client concerns, which is also the only way they can
work offline.

A second read path would immediately diverge from the first — different
filters, different defaults, different bugs — and there would be no way to tell
which one was right.

The contract is close to frozen after its first version. Subtasks, habits,
quantified completions and every future field add no endpoint, because all of
them are expressed by three verbs inside `/sync`. What changes is
`components/schemas`, never `paths`. This inverts the usual economics of a
contract: expensive to design once, nearly free to live with.

The cost is that anything wanting a slice of the data without a replica — a
future integration, a webhook consumer, a script — has no cheap way in. When
that arrives it should be a separate read-only surface with its own name, not
an erosion of this one.
