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

Two offline insertions at the same position may produce the same string. The
tie breaks by id, which is equally stable, and nothing is lost. A move into a
run of equal ranks re-ranks that run as one batch of `set`s.

The cost is that ranks lengthen under repeated insertion at the same point.
This is bounded in practice and, if it ever matters, is fixed by a
rebalancing pass that is itself an ordinary batch of `set` operations.

## Amendment (2026-10-02, plan W3)

`rankBetween` is a deterministic midpoint, so two offline insertions at one
position get the same string instead of two different ones. Every sort ends in
the id, which keeps the order total and stable. Every existing task has `'a0'`,
so a move into a tie re-ranks the tied run (a key and the same key plus
trailing zeros, such as `'a'` and `'a0'`, count as tied: no key fits between
them): the rebalancing pass above, kept as
small as the run. Generated keys never end in `'0'`, which would leave no room
below them. A generated key can still equal a legacy one's prefix, hence the
rule above.
