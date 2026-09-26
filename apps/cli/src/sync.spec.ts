import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Change, Op, OpResult, SyncRequest } from '@todoer/specs';
import { ownOutcome, RefusalError } from './protocol.js';
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

/** A response whose body errors on read, the way a connection dropped
 *  mid-body would — as opposed to `json()`'s "not json" case, whose bytes
 *  arrive whole but do not parse. */
function unreadableBody(status: number): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error('stream broke'));
    },
  });
  return new Response(stream, { status });
}

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

    const flushed = await flush(store, server.send);

    expect(server.requests.map((r) => r.ops.length)).toEqual([MAX_OPS, 1]);
    expect(server.requests[1]?.ops[0]?.opId).toBe(
      `op-${String(MAX_OPS).padStart(4, '0')}`,
    );
    expect(server.requests.map((r) => r.since)).toEqual([0, 10]);
    expect(store.pending()).toEqual([]);
    // Both batches' verdicts, not just the last one's.
    expect(flushed.results).toHaveLength(MAX_OPS + 1);
  });

  it('stops at the first batch the server does not answer', async () => {
    for (let i = 0; i <= MAX_OPS; i++) store.enqueue(create(`op-${i}`));
    const server = scripted((request) => applyAll(request, 10), unreachable);

    const flushed = await flush(store, server.send);

    expect(flushed.synced).toBe(false);
    expect(store.pending()).toHaveLength(1);
    // The batch that did get answered still counts, even though the flush
    // overall did not sync.
    expect(flushed.results).toHaveLength(MAX_OPS);
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

  // Controller ruling: 400/413 mean the request as sent can never be
  // accepted, by this client or any other — a resend cannot change that,
  // so every op it carried is a rejection, not a `pending` stuck forever.
  it('fails every operation in a batch the server refuses outright (413)', async () => {
    store.enqueue(create('earlier'));
    store.enqueue(create('mine'));
    const server = scripted(
      () => json({ title: 'Payload Too Large' }, 413),
      (request) => applyAll(request, 5),
    );

    const flushed = await flush(store, server.send, new Set(['mine']));

    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['earlier', 'failed'],
    ]);
    expect(flushed.results.map((r) => [r.opId, r.status])).toEqual([
      ['earlier', 'rejected'],
      ['mine', 'rejected'],
    ]);
    expect(flushed.results[0]?.reason).toMatch(/413/);
    expect(flushed.results[1]?.reason).toMatch(/413/);
    expect(() => ownOutcome(flushed.results, 'mine')).toThrow(RefusalError);
    // Nothing pulled for the refused batch, so the flush still owes one.
    expect(server.requests[1]).toEqual({ since: 0, ops: [] });
    expect(flushed.synced).toBe(true);
  });

  // G11: the closing pull a refused last batch owes can itself be refused
  // or unreachable. `synced: true` would then claim the local state is
  // current when nothing was actually pulled.
  it('(a) counts the flush as unsynced when the closing pull after a refused batch is itself refused', async () => {
    store.enqueue(create('earlier'));
    store.enqueue(create('mine'));
    const server = scripted(
      () => json({ title: 'Payload Too Large' }, 413),
      () => json({ title: 'Payload Too Large' }, 413),
    );

    const flushed = await flush(store, server.send, new Set(['mine']));

    // The batch's ops settle exactly as they would if the closing pull had
    // gone through — only `synced` reflects the closing pull's own fate.
    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['earlier', 'failed'],
    ]);
    expect(flushed.results.map((r) => [r.opId, r.status])).toEqual([
      ['earlier', 'rejected'],
      ['mine', 'rejected'],
    ]);
    expect(server.requests[1]).toEqual({ since: 0, ops: [] });
    expect(flushed.synced).toBe(false);
  });

  it('(b) still syncs when the closing pull after a refused batch recovers from a 410', async () => {
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
      () => json({ title: 'Payload Too Large' }, 413),
      () => json({ title: 'Gone' }, 410),
      (request) =>
        applyAll(request, 900, [
          { table: 'task', id: 'kept', seq: 800, row: kept },
        ]),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests.map((r) => r.since)).toEqual([50, 50, 0]);
    expect(flushed.synced).toBe(true);
    expect(store.rows('task')).toEqual([kept]);
    expect(store.cursor()).toBe(900);
  });

  it('(c) counts the flush as unsynced when the closing pull after a refused batch is unreachable', async () => {
    store.enqueue(create('a'));
    const server = scripted(
      () => json({ title: 'Payload Too Large' }, 413),
      unreachable,
    );

    const flushed = await flush(store, server.send);

    expect(server.requests).toHaveLength(2);
    expect(flushed.synced).toBe(false);
  });

  it('still sends and applies the next batch after a 400 refuses the one before it', async () => {
    for (let i = 0; i <= MAX_OPS; i++) {
      store.enqueue(create(`op-${String(i).padStart(4, '0')}`));
    }
    const server = scripted(
      () => json({ title: 'Bad Request' }, 400),
      (request) => applyAll(request, 20),
    );

    const flushed = await flush(store, server.send);

    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.ops).toHaveLength(1);
    expect(flushed.synced).toBe(true);
    expect(store.pending()).toEqual([]);
    expect(flushed.results).toHaveLength(MAX_OPS + 1);
  });

  it('does not let a broken response body escape as an unexpected error', async () => {
    store.enqueue(create('a'));
    await expect(
      flush(store, scripted(() => unreadableBody(401)).send),
    ).rejects.toBeInstanceOf(RefusalError);
    expect(store.pending()).toHaveLength(1);
  });

  // Minor 7: the server computed this delta for the since the request
  // carried. A parallel invocation resets the replica on a 410 while the
  // request is in flight, so the delta must not be merged: only the since
  // that was sent, not the cursor read afterwards, shows the mismatch.
  it('does not merge a delta into a replica reset while the request was in flight', async () => {
    store.advanceCursor(40);
    store.enqueue(create('a'));
    const { send, requests } = scripted((request) => {
      store.resetReplica();
      return applyAll(request, 50, [
        { table: 'task', id: 'task-a', seq: 45, row: { id: 'task-a' } },
      ]);
    });

    const flushed = await flush(store, send);

    expect(requests[0]?.since).toBe(40);
    expect(flushed.synced).toBe(true);
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([]);
    expect(store.cursor()).toBe(0);
  });
});

describe('MAX_OPS', () => {
  // G12: an unanchored search for `ops:` / `maxItems:` would happily match
  // the next schema's `maxItems` if `SyncRequest.ops` ever lost its own, so
  // this slices the file down to the `SyncRequest` schema block first (from
  // its own top-level key to the next one, both indented 4 spaces under
  // `schemas:`) and only then looks for `ops` / `maxItems` inside that slice.
  it("matches the contract's cap on ops per request", () => {
    const openapi = readFileSync(
      new URL('../../../packages/specs/openapi/openapi.yaml', import.meta.url),
      'utf8',
    );
    const start = /^ {4}SyncRequest:\s*$/m.exec(openapi);
    expect(start, 'SyncRequest schema not found in openapi.yaml').not.toBe(
      null,
    );
    const afterStart = openapi.slice(start!.index + start![0].length);
    const end = /^ {4}[A-Za-z_]\w*:\s*$/m.exec(afterStart);
    const block = end ? afterStart.slice(0, end.index) : afterStart;
    const match = /ops:[\s\S]*?maxItems:\s*(\d+)/.exec(block);
    expect(
      match,
      'ops.maxItems not found inside the SyncRequest schema block',
    ).not.toBe(null);
    expect(Number(match?.[1])).toBe(MAX_OPS);
  });
});
