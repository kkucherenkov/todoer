/**
 * The one method `lockUserWrites` and `lockRow` need, so that either takes a
 * transaction client without naming Prisma's full generated type.
 */
export type RawClient = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
};

/**
 * Serialises every write of one user: a transaction holding this lock keeps
 * the next one of the same user waiting until it commits or rolls back.
 *
 * That is what makes a user's `seq` values commit in the order they were
 * allocated. Without it, a write that took seq 10 and a write that took seq 11
 * can commit in the opposite order, a pull between the two commits reports
 * cursor 11, and `seq > 11` never selects row 10 again (ADR 0016, superseded
 * by ADR 0017). Pulls filter by user, so only one user's order matters, and a
 * per-user lock is enough.
 *
 * Must be the first statement of the transaction, before any row lock. Taken
 * later, it deadlocks against a transaction of the same user that already
 * holds it and is waiting for a row lock this one holds.
 *
 * Transaction-scoped (`_xact_`): released by commit or rollback, so it cannot
 * leak onto a pooled connection. Class 1 is this lock's namespace; the second
 * key is a 32-bit hash of the user id, and a collision only makes two users
 * wait for each other, never lets two writes of one user overlap.
 *
 * Selected FROM the function rather than as a column: it returns `void`, and
 * Prisma cannot deserialise a `void` column.
 */
export async function lockUserWrites(
  tx: RawClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM pg_advisory_xact_lock(1, hashtext(${userId}::text))
  `;
}
