# 17. A per-user write lock orders the cursor

- **Status:** accepted
- **Date:** 2026-09-26
- **Supersedes:** [0016](0016-the-sync-cursor-is-not-linearizable.md)

## Context

ADR 0016 accepted a race: a write allocates `seq` 10, a second write of the
same user allocates 11 and commits first, a pull between the two commits
reports cursor 11, and `seq > 11` never selects row 10. It judged the race
rare because it needs two concurrent writes of one user. The client outbox
makes that routine: agents call the CLI in parallel, and each call flushes.

## Decision

Every write transaction in `POST /sync`, and every pruning transaction, first
takes `pg_advisory_xact_lock(1, hashtext(user_id))`. One user's writes run one
after another, so their `seq` values commit in allocation order.

## Consequences

Pulls filter by user, so per-user order is all a cursor needs; seq values of
different users still interleave, harmlessly. A pull that sees `seq` 11 of a
user also sees that user's `seq` 10. The xmin-based cursor ADR 0016 described
as the standard remedy is not needed.

The lock is taken before any row lock. Taken after, a transaction holding a
row lock waits for the advisory lock while the holder of the advisory lock
waits on that row's `FOR KEY SHARE` from a foreign key: a deadlock, `40P01`,
a 500.

One user's writes are serialised. For a personal task list this is
imperceptible. The lock key encodes user isolation: if shared projects are
ever added (ADR 0003), two authors write one dataset and this key no longer
orders it. Reconsider this ADR together with 0003.

While one write of a user holds the lock, every other write of that user
waits inside an open interactive transaction, holding a pooled database
connection and running down Prisma's interactive-transaction timeout (5 s by
default). A burst of parallel writes from one user (an agent's outbox flush)
can therefore exhaust the connection pool, which slows other users, and the
tail of the queue can time out (P2028), which the service reports as a
retryable 5xx. Acceptable for a personal instance; if it bites, the options
are a larger pool, a longer transaction timeout, or batching one user's
operations into one transaction.
