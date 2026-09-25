# 3. The log lives on the client

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Offline-first needs an operation log somewhere. It can be the server's source
of truth with state as a projection, or purely a client-side queue against
server-held state, or logs on both sides merged by vector clocks.

## Decision

The log is a client-side outbox. The server holds state and serves a monotonic
change cursor. There is no event store.

## Consequences

The decisive fact is that users are isolated
([0007](0007-tags-only-no-contexts.md) is unrelated; isolation is a product
decision recorded in the spec): every dataset has exactly one author, across
that person's own devices. Genuinely concurrent writes do not arise. Delayed
writes do — a phone offline for a week. Machinery for the first, vector clocks
and CRDTs and lossless merge, is an order of magnitude more expensive than
machinery for the second, which is ordering plus idempotency.

Event sourcing would buy full history, rollback to any point, and undo as a
side effect. It would cost a projector, snapshots, event versioning and a
migration path for old events — infrastructure for a problem a personal task
list does not have.

What is given up: there is no record of what happened, only of what is. Restore
is from a backup, not from a replay.

This decision depends on isolation. If shared projects are ever added, this ADR
must be reconsidered before anything else, because a second author reintroduces
exactly the concurrency this avoids.
