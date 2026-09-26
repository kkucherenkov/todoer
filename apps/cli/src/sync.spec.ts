import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Change, Op, OpResult, SyncRequest } from '@todoer/specs';
import { RefusalError } from './protocol.js';
import { Store } from './store.js';
import { MAX_OPS, flush, type Transport } from './sync.js';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

function create(opId: string): Op {
  return {
    opId,
    kind: 'create',
    table: 'task',
    id: `task-${opId}`,
    fields: { title: opId, rank: 'a0' },
    ts: '2026-09-26T00:00:00.000Z',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function applyAll(
  request: SyncRequest,
  cursor: number,
  changes: Change[] = [],
) {
  const results: OpResult[] = request.ops.map((op) => ({
    opId: op.opId,
    status: 'applied',
  }));
  return json({ cursor, results, changes });
}

/** A transport that answers with the given handlers in turn and records
 *  every request it saw. */
function scripted(
  ...handlers: Array<(request: SyncRequest) => Response | Promise<Response>>
) {
  const requests: SyncRequest[] = [];
  const send: Transport = async (request) => {
    requests.push(structuredClone(request));
    const handler = handlers.shift();
    if (handler === undefined) throw new Error('unexpected request');
    return handler(request);
  };
  return { send, requests };
}

const unreachable = () => {
  throw new TypeError('fetch failed');
};

describe('flush', () => {
  it('sends the pending operations with the cursor and applies the answer', async () => {
    store.advanceCursor(4);
    store.enqueue(create('a'));
    const row = { id: 'task-a', title: 'a', deletedAt: null };
    const server = scripted((request) =>
      applyAll(request, 9, [{ table: 'task', id: 'task-a', seq: 9, row }]),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests).toEqual([{ since: 4, ops: [create('a')] }]);
    expect(flushed.synced).toBe(true);
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([row]);
    expect(store.cursor()).toBe(9);
  });

  it('still pulls when nothing is queued', async () => {
    const server = scripted((request) => applyAll(request, 0));
    await flush(store, server.send);
    expect(server.requests).toEqual([{ since: 0, ops: [] }]);
  });

  // FR-003: the operation keeps its id across attempts (ADR 0015 §4).
  it('resends the same operation after the server was unreachable', async () => {
    store.enqueue(create('a'));

    const offline = await flush(store, scripted(unreachable).send);
    expect(offline.synced).toBe(false);
    expect(store.pending()).toEqual([create('a')]);

    const server = scripted((request) => applyAll(request, 1));
    await flush(store, server.send);
    expect(server.requests[0]?.ops).toEqual([create('a')]);
  });

  it('treats a 5xx as the server not reached', async () => {
    store.enqueue(create('a'));
    const flushed = await flush(store, scripted(() => json({}, 503)).send);
    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it('treats an unreadable body as the server not reached', async () => {
    store.enqueue(create('a'));
    const flushed = await flush(
      store,
      scripted(() => new Response('not json', { status: 200 })).send,
    );
    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it('keeps the operations queued when the server refuses the request', async () => {
    store.enqueue(create('a'));
    await expect(
      flush(store, scripted(() => json({ title: 'Unauthorized' }, 401)).send),
    ).rejects.toBeInstanceOf(RefusalError);
    expect(store.pending()).toHaveLength(1);
  });

  // Review Focus 2: the server applied the batch, the answer never arrived.
  it('settles a resent operation the server reports as a duplicate', async () => {
    store.enqueue(create('a'));
    const applied = new Set<string>();
    const server = scripted(
      (request) => {
        for (const op of request.ops) applied.add(op.opId);
        throw new TypeError('socket hang up');
      },
      (request) =>
        json({
          cursor: 1,
          results: request.ops.map((op) => ({
            opId: op.opId,
            status: applied.has(op.opId) ? 'duplicate' : 'applied',
          })),
          changes: [],
        }),
    );

    expect((await flush(store, server.send)).synced).toBe(false);
    const second = await flush(store, server.send);

    expect(second.results).toEqual([{ opId: 'a', status: 'duplicate' }]);
    expect(store.pending()).toEqual([]);
    expect(store.entries()).toEqual([]);
  });

  // FR-007, ADR 0013: discard the replica, keep the outbox, ask for since 0.
  it('recovers from a 410 with a snapshot and keeps the outbox', async () => {
    store.mergeChanges([
      {
        table: 'task',
        id: 'gone',
        seq: 50,
        row: { id: 'gone', deletedAt: null },
      },
    ]);
    store.advanceCursor(50);
    store.enqueue(create('a'));
    const kept = { id: 'kept', deletedAt: null };
    const server = scripted(
      () => json({ title: 'Gone' }, 410),
      (request) =>
        applyAll(request, 900, [
          { table: 'task', id: 'kept', seq: 800, row: kept },
        ]),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests.map((r) => r.since)).toEqual([50, 0]);
    expect(server.requests[1]?.ops).toEqual([create('a')]);
    expect(flushed.synced).toBe(true);
    expect(store.rows('task')).toEqual([kept]);
    expect(store.cursor()).toBe(900);
    expect(store.pending()).toEqual([]);
  });

  it('refuses when the server answers 410 even to since 0', async () => {
    const server = scripted(
      () => json({}, 410),
      () => json({}, 410),
    );
    await expect(flush(store, server.send)).rejects.toBeInstanceOf(
      RefusalError,
    );
  });

  // FR-010: the contract caps a batch at 1000 operations.
  it('sends a large outbox in batches, oldest first, carrying the cursor forward', async () => {
    for (let i = 0; i <= MAX_OPS; i++)
      store.enqueue(create(`op-${String(i).padStart(4, '0')}`));
    const server = scripted(
      (request) => applyAll(request, 10),
      (request) => applyAll(request, 20),
    );

    await flush(store, server.send);

    expect(server.requests.map((r) => r.ops.length)).toEqual([MAX_OPS, 1]);
    expect(server.requests[1]?.ops[0]?.opId).toBe(
      `op-${String(MAX_OPS).padStart(4, '0')}`,
    );
    expect(server.requests.map((r) => r.since)).toEqual([0, 10]);
    expect(store.pending()).toEqual([]);
  });

  it('stops at the first batch the server does not answer', async () => {
    for (let i = 0; i <= MAX_OPS; i++) store.enqueue(create(`op-${i}`));
    const server = scripted((request) => applyAll(request, 10), unreachable);

    const flushed = await flush(store, server.send);

    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
  });

  it("removes the caller's own refused operation and keeps another's as failed", async () => {
    store.enqueue(create('mine'));
    store.enqueue(create('theirs'));
    const server = scripted((request) =>
      json({
        cursor: 0,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'rejected',
          reason: 'no',
        })),
        changes: [],
      }),
    );

    await flush(store, server.send, new Set(['mine']));

    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['theirs', 'failed'],
    ]);
  });
});
