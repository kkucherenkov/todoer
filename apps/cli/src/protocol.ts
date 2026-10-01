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

/** Why the server did not take an operation: it was rejected, or it lost an
 *  optimistic-lock check. */
export type Refusal =
  | { kind: 'rejected'; reason: string }
  | { kind: 'conflict'; version: number | undefined };

/** The refusal an `/sync` result reports, if it reports one. */
export function refusalOf(result: OpResult | undefined): Refusal | undefined {
  if (result?.status === 'rejected') {
    return {
      kind: 'rejected',
      reason: result.reason ?? 'the server refused this operation',
    };
  }
  if (result?.status === 'conflict') {
    return { kind: 'conflict', version: result.currentVersion };
  }
  return undefined;
}

function raise(refusal: Refusal, newer: string): never {
  if (refusal.kind === 'rejected') throw new RefusalError(refusal.reason);
  throw new ConflictError(`${newer} (version ${String(refusal.version)})`);
}

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
  const refusal = refusalOf(result);
  if (refusal) raise(refusal, 'the server holds a newer version of this row');
  return 'settled';
}

/**
 * Throws for a command's batch when any operation was refused. One operation
 * sent: that operation's own error. Several: one error listing every refused
 * operation and how many others landed or wait in the outbox, because the
 * server applies operations one by one and "refused" alone reads as "nothing
 * happened". Exit 1 if any was rejected, else 4.
 */
export function throwRefusals(
  ops: {
    op: { kind: string; table: string };
    outcome: Refusal | 'applied' | 'queued';
  }[],
): void {
  const refused = ops.flatMap(({ op, outcome }) =>
    typeof outcome === 'string' ? [] : [{ op, outcome }],
  );
  const first = refused[0];
  if (first === undefined) return;
  const queued = ops.filter((o) => o.outcome === 'queued').length;
  const sent = ops.length - queued;
  if (sent === 1)
    raise(first.outcome, 'the server holds a newer version of this row');
  const applied = sent - refused.length;
  const parts = refused.map(
    ({ op, outcome }) =>
      `${op.kind} ${op.table}: ${outcome.kind === 'rejected' ? outcome.reason : `the server holds a newer version (version ${String(outcome.version)})`}`,
  );
  if (applied > 0) parts.push(`${applied} other operation(s) applied`);
  if (queued > 0) parts.push(`${queued} still queued`);
  const message = parts.join('; ');
  throw refused.some((r) => r.outcome.kind === 'rejected')
    ? new RefusalError(message)
    : new ConflictError(message);
}
