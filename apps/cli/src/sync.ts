import type { Op, OpResult, SyncRequest, SyncResponse } from '@todoer/specs';
import { RefusalError } from './protocol.js';
import type { Store } from './store.js';

/** One POST /sync. Injected, so the flush is testable without a network. */
export type Transport = (request: SyncRequest) => Promise<Response>;

/**
 * `results` accumulates every verdict across every batch this flush sent,
 * successful or not. When `synced` is false it still holds the verdicts of
 * whichever batches the server did answer before one stopped the run.
 */
export type Flushed = { synced: boolean; results: OpResult[] };

/** The contract's `maxItems` for `ops`. */
export const MAX_OPS = 1000;

/**
 * A 400 or 413: the request as sent can never be accepted, by this client
 * or any other, so every operation it carried is a rejection rather than
 * something a resend could fix. `detail` is `"<status> <body text>"`.
 */
type BatchRefused = { kind: 'batch-refused'; detail: string };

type Exchange = SyncResponse | 'gone' | 'unreached' | BatchRefused;

/** What `attempt` returns: 410 is resolved internally (retried or thrown),
 *  so it never reaches a caller. */
type Settled = SyncResponse | 'unreached' | BatchRefused;

function isBatchRefused(answer: Settled): answer is BatchRefused {
  return typeof answer === 'object' && answer !== null && 'kind' in answer;
}

/**
 * One request and what became of it. "Unreached" covers everything after
 * which a resend is both safe and the right thing to do: no connection, a
 * timeout, a 5xx, a body that never arrived whole. 400 and 413 are the
 * server refusing the batch as a whole — too large, or invalid in a way
 * that is not any one operation's fault to isolate — so the caller gets the
 * detail back to fail every operation the batch carried. Any other 4xx
 * (401, 403, …) is the server refusing the request as it stands, which a
 * resend cannot change either, but which is not this batch's fault: it
 * stays pending for a caller to fix and retry (a new token, say).
 */
async function exchange(
  send: Transport,
  request: SyncRequest,
): Promise<Exchange> {
  let response: Response;
  try {
    response = await send(request);
  } catch {
    return 'unreached';
  }
  if (response.status === 410) return 'gone';
  if (response.status === 400 || response.status === 413) {
    const text = await response.text().catch(() => '');
    return { kind: 'batch-refused', detail: `${response.status} ${text}` };
  }
  if (response.status >= 500) return 'unreached';
  if (!response.ok) {
    throw new RefusalError(
      `sync refused: ${response.status} ${await response.text().catch(() => '')}`,
    );
  }
  try {
    return (await response.json()) as SyncResponse;
  } catch {
    return 'unreached';
  }
}

/**
 * One exchange, with the one 410 recovery it gets before giving up: reset
 * the replica and repeat with since 0 (ADR 0013). Shared by every request
 * `flush` makes, including the pull-only one at the end. Returns the answer
 * with the `since` the answered request carried.
 */
async function attempt(
  store: Store,
  send: Transport,
  ops: Op[],
): Promise<{ answer: Settled; since: number }> {
  const since = store.cursor();
  let answer = await exchange(send, { since, ops });
  if (answer === 'gone') {
    // The cursor predates tombstone retention: deletions it missed can no
    // longer be sent. Start the replica over; the outbox is untouched, and
    // the operations in this batch replay their outcomes (ADR 0013).
    store.resetReplica();
    answer = await exchange(send, { since: 0, ops });
    if (answer === 'gone') {
      throw new RefusalError('the server answered 410 to since 0');
    }
    return { answer, since: 0 };
  }
  return { answer, since };
}

/**
 * Sends every pending operation, oldest first, at most MAX_OPS per request,
 * and pulls what changed. Stops at the first request the server does not
 * answer: whatever was not sent stays queued with its id, which is what makes
 * the next attempt safe (ADR 0015 §4).
 *
 * `own` names the operations the running command queued; see Store.settle.
 */
export async function flush(
  store: Store,
  send: Transport,
  own: ReadonlySet<string> = new Set(),
): Promise<Flushed> {
  const pending = store.pending();
  const results: OpResult[] = [];
  let pulled = false;
  // At least one request, so an empty outbox still pulls.
  for (let start = 0; start === 0 || start < pending.length; start += MAX_OPS) {
    const ops = pending.slice(start, start + MAX_OPS);
    const { answer, since } = await attempt(store, send, ops);
    if (answer === 'unreached') return { synced: false, results };
    if (isBatchRefused(answer)) {
      // Every op in the batch fails the same way a per-op `rejected` would
      // (FR-006): the running command's own op still ends up in `results`
      // for its caller to read via `ownOutcome`, an earlier invocation's
      // stays `failed` for `todoer outbox` to show.
      const refused: OpResult[] = ops.map((op) => ({
        opId: op.opId,
        status: 'rejected',
        reason: `the server refused the request carrying this operation: ${answer.detail}`,
      }));
      store.transaction(() => store.settle(refused, own));
      results.push(...refused);
      pulled = false;
      continue;
    }
    store.applyResponse(answer, own, since);
    results.push(...answer.results);
    pulled = true;
  }
  if (!pulled) {
    // The last batch was refused outright, so it carried no pull: ask once
    // more, empty-handed, for what changed. A 400/413 to this empty request
    // is the server refusing to talk at all, not this batch's fault to
    // settle — the local replica and cursor are unconfirmed, so this flush
    // did not sync (the command exits 5) even though every op already has
    // its verdict.
    const { answer, since } = await attempt(store, send, []);
    if (answer === 'unreached' || isBatchRefused(answer)) {
      return { synced: false, results };
    }
    store.applyResponse(answer, own, since);
  }
  return { synced: true, results };
}
