import type { OpResult, SyncRequest, SyncResponse } from '@todoer/specs';
import { RefusalError } from './protocol.js';
import type { Store } from './store.js';

/** One POST /sync. Injected, so the flush is testable without a network. */
export type Transport = (request: SyncRequest) => Promise<Response>;

export type Flushed = { synced: boolean; results: OpResult[] };

/** The contract's `maxItems` for `ops`. */
export const MAX_OPS = 1000;

type Exchange = SyncResponse | 'gone' | 'unreached';

/**
 * One request and what became of it. "Unreached" covers everything after
 * which a resend is both safe and the right thing to do: no connection, a
 * timeout, a 5xx, a body that never arrived whole. A 4xx other than 410 is
 * the server refusing the request as it stands, which a resend cannot change.
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
  if (response.status >= 500) return 'unreached';
  if (!response.ok) {
    throw new RefusalError(
      `sync refused: ${response.status} ${await response.text()}`,
    );
  }
  try {
    return (await response.json()) as SyncResponse;
  } catch {
    return 'unreached';
  }
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
  // At least one request, so an empty outbox still pulls.
  for (let start = 0; start === 0 || start < pending.length; start += MAX_OPS) {
    const ops = pending.slice(start, start + MAX_OPS);
    let answer = await exchange(send, { since: store.cursor(), ops });
    if (answer === 'gone') {
      // The cursor predates tombstone retention: deletions it missed can no
      // longer be sent. Start the replica over; the outbox is untouched, and
      // the operations in this batch replay their outcomes (ADR 0013).
      store.resetReplica();
      answer = await exchange(send, { since: 0, ops });
      if (answer === 'gone') {
        throw new RefusalError('the server answered 410 to since 0');
      }
    }
    if (answer === 'unreached') return { synced: false, results };
    store.applyResponse(answer, own);
    results.push(...answer.results);
  }
  return { synced: true, results };
}
