# 8. Manual order is a fractional index

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Tasks have a user-defined order within their project, and subtasks within their
parent. Order has to survive two offline clients inserting at the same place.

## Decision

`rank` is a string. Inserting between two neighbours computes a value strictly
between them.

## Consequences

An integer order makes insertion renumber the tail: one user action becomes N
queued operations, and two clients that both renumber produce a guaranteed
conflict over rows neither of them meant to touch.

A fractional index never renumbers, so a move is a single `set` on a single
row — which is what lets [0006](0006-three-generic-operations.md) avoid a
`reorder` operation.

Two offline insertions at the same position produce two different strings
rather than a collision. The order between them is arbitrary but stable, and
nothing is lost.

The cost is that ranks lengthen under repeated insertion at the same point.
This is bounded in practice and, if it ever matters, is fixed by a
rebalancing pass that is itself an ordinary batch of `set` operations.
