# 16. The sync cursor orders by seq allocation, not by commit

- **Status:** accepted
- **Date:** 2026-09-25

## Context

Every applied write takes its `seq` from `nextval('change_seq')`, called as
the first thing inside that write's transaction, before the row itself is
written. A pull reads the four synchronised tables inside one REPEATABLE
READ transaction, so all four scans share a snapshot with each other, and
reports its cursor as the highest `seq` those scans actually returned (or
`since`, if nothing came back).

That single-snapshot read closes the bug this design started with: four
separate reads, no shared transaction, where a write that committed between
two of them was visible to one and not the other, and a cursor computed
from whichever read happened to see it could leave the other table's
matching row below a client's `since` forever. It does not close every race
a concurrent writer can open.

A transaction calls `nextval()`, allocating, say, seq 10, and then does
whatever else it does before committing: more queries, a slow network round
trip, contention on a lock. Postgres sequences are not transactional. The
value is burned the instant `nextval()` runs, whether or not that
transaction ever commits, and however long it takes to. Meanwhile a second,
unrelated transaction can start after the first, call `nextval()`, get seq
11, and commit immediately, before the first transaction does.

Say a client's pull takes its snapshot at this point. Seq 11's row is
committed and visible; seq 10's is not, because its transaction has not
committed yet. The pull's scans return seq 11 as the highest row they saw,
so the cursor is reported as 11. When the first transaction finally
commits, its row carries seq 10, a value already below a cursor the client
believes is fully synced. `seq > since` will never select that row for this
client again.

This needs both conditions at once: an in-flight write allocating a lower
seq, **and** a different write's higher seq already visible in the same
snapshot to push the cursor past it. Either alone is harmless. An
in-flight low seq with nothing higher visible leaves the cursor at
`since`, not past the gap; that is what keeps a pull returning nothing from
ever claiming ground it did not cover. It is the combination that loses a
row.

## Decision

Accept it. `seq` is allocated in transaction order, not commit order, and
the cursor is built from delivered rows, which is a bound on it, not a fix
for it. Closing this needs a different mechanism than a sequence, not a
different way of reading the same one.

## Consequences

The failure needs two transactions racing to write data for the **same
user**, close enough together that a pull's snapshot lands in the gap
between one's `nextval()` and its commit, with a third write's higher seq
already visible to complete the trap. A single device, or two devices that
never mutate concurrently, cannot trigger it.

The skip is **permanent**, not eventually self-healing. `seq > since` never
selects a row whose `seq` already sits below the client's cursor, no matter
how many times that client syncs again. Nothing rewrites the row with a
fresh `seq` unless something else edits it later, and even then only that
later edit becomes visible, not the original one the client missed. The
only path back is the one ADR 0013 already names for a stale cursor:
`410 Gone` and `GET /sync/snapshot`, which this failure does not trigger on
its own, since the cursor a client holds is not, in fact, older than
retention. A client can carry a gap indefinitely without ever being told to
resynchronise.

The standard remedy is a snapshot-based cursor. Instead of the highest
`seq` a pull happened to see, track the oldest still-open write transaction
(Postgres exposes this as `pg_snapshot_xmin` / the `xmin` horizon) and cap
the cursor there, so a pull never reports a position past a transaction
that might still be in flight. That trades an occasionally more
conservative cursor for closing the race entirely. Reading and reasoning
about transaction snapshots instead of a sequence value is real work, and
it sits outside the walking skeleton's scope.

Any future work on this either implements that remedy or replaces this ADR
with one that says why it didn't need to.
