# 16. The sync cursor orders by seq allocation, not by commit

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Every applied write takes its `seq` from `nextval('change_seq')`, called as
the first thing inside that write's transaction, before the row itself is
written. A pull's cursor is read the same way: `SELECT ... FROM change_seq`,
taken before the four tables are scanned, inside one REPEATABLE READ
transaction so all four scans share a snapshot with each other.

That closes the bug this design started with: four separate reads, no
shared snapshot, a cursor computed as the max of whatever came back. That
let a write which committed between two of those reads vanish below a
cursor already handed to a client (see the commit that introduced the
shared transaction). It does not close every race a concurrent writer can
open.

A transaction calls `nextval()`, allocating, say, seq 10, and then does
whatever else it does before committing: more queries, a slow network round
trip, contention on a lock. Postgres sequences are not transactional. The
value is burned the instant `nextval()` runs, whether or not that
transaction ever commits, and however long it takes to. Meanwhile a second,
unrelated transaction can start after the first, call `nextval()`, get seq
11, and commit immediately.

Say a client's pull reads the cursor between those two commits. It sees seq
11's row, already committed, but not seq 10's, still in flight, and reports
its cursor as 11: `change_seq`'s current position, regardless of what the
snapshot actually contains. When the first transaction finally commits, its
row carries seq 10. No client will ever request `since: 9` again; a cursor
of 11 already told every client it had seen everything up to and including
10.

## Decision

Accept it. `seq` is allocated in transaction order, not commit order, and
the walking skeleton's cursor is built on `seq` directly. This is a design
ceiling in the sequence itself. Closing it needs a different mechanism, not
a different value read from the same one.

## Consequences

The failure needs two things at once: two transactions racing to write
data for the **same user**, close enough together that a pull lands in the
gap between one's `nextval()` and its commit. A single device, or two
devices that never mutate concurrently, cannot trigger it. Syncing again
eventually recovers the row anyway. The tombstone/retention design (ADR
0013) already accepts that a client can be stale and must be able to catch
up; a skipped seq stays invisible exactly the way a client that never
synced would see it. That is a rare instance of an existing failure mode,
not a new one.

The standard remedy is a snapshot-based cursor. Instead of reading "the
sequence's current position," track the oldest still-open write transaction
(Postgres exposes this as `pg_snapshot_xmin` / the `xmin` horizon) and cap
the cursor there, so a pull never reports a position past a transaction
that might still be in flight. That trades an occasionally more
conservative cursor for closing the race entirely. Reading and reasoning
about transaction snapshots instead of a single sequence value is real
work, and it sits outside the walking skeleton's scope.

Any future work on this either implements that remedy or replaces this ADR
with one that says why it didn't need to.
