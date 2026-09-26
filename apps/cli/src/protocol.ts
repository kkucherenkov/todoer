/**
 * This CLI's whole exit-code vocabulary, and the only place the mapping is
 * decided — `index.ts` does nothing but translate an error class into a
 * status. What is left here: the three error classes that map to exit codes
 * 1, 2 and 4 (exit 5 needs no error — `run.ts` returns it directly), and
 * `ownOutcome`, which reads the one operation a running command minted out
 * of a `/sync` response that may report many.
 *
 * `OpResult` comes from @todoer/specs rather than being hand-rolled here — a
 * contract change then breaks this build instead of silently drifting from
 * what the server actually sends.
 */
import type { OpResult } from '@todoer/specs';

/** Exit 1: the server refused — a 4xx, or a rejected operation. Retrying the
 *  same request cannot change the answer; something about it has to change
 *  first, and for a 401 that something is the token. */
export class RefusalError extends Error {}
/** Exit 2: the invocation itself is wrong — an unknown command, or text that
 *  leaves no title. Nothing was sent. */
export class UsageError extends Error {}
/** Exit 4: the operation lost an optimistic-lock check — the server holds a
 *  newer version of the row. A retry needs the current row first. */
export class ConflictError extends Error {}

/**
 * What happened to the one operation the running command queued, in a
 * response that may carry many. Throws when the server refused it, so the
 * command's exit code says so. `unreported` is not an error: the operation
 * is still in the outbox with its id, and a later command resends it safely.
 */
export function ownOutcome(
  results: OpResult[],
  opId: string,
): 'settled' | 'unreported' {
  const result = results.find((r) => r.opId === opId);
  if (result === undefined) return 'unreported';
  if (result.status === 'rejected') {
    throw new RefusalError(
      result.reason ?? 'the server refused this operation',
    );
  }
  if (result.status === 'conflict') {
    throw new ConflictError(
      `the server holds a newer version of this row (version ${String(result.currentVersion)})`,
    );
  }
  return 'settled';
}
