import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import type { Store } from './store.js';
import { flush, type Transport } from './sync.js';
import { openStore } from './test-store.js';

const create = (opId: string): Op => ({
  opId,
  kind: 'create',
  table: 'task',
  id: `task-${opId}`,
  fields: { title: opId, rank: 'a0' },
  ts: '2026-10-03T00:00:00.000Z',
});

/**
 * A server as far as these tests need one: an opId applies once (ADR 0005)
 * and every later sight of it answers `applied` again; each applied create
 * gets the next seq; a pull returns the rows after `since`. Each answer
 * waits a tick, so two flushes started together are in flight together.
 */
function server() {
  const arrivals = new Map<string, number>();
  const changes: Change[] = [];
  const send: Transport = async (request: SyncRequest) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const op of request.ops) {
      const seen = arrivals.get(op.opId) ?? 0;
      arrivals.set(op.opId, seen + 1);
      if (seen === 0 && op.kind === 'create') {
        changes.push({
          table: op.table,
          id: op.id,
          seq: changes.length + 1,
          row: { id: op.id, ...op.fields, deletedAt: null },
        });
      }
    }
    return new Response(
      JSON.stringify({
        cursor: changes.length,
        results: request.ops.map((op) => ({
          opId: op.opId,
          status: 'applied',
        })),
        changes: changes.filter((c) => c.seq > request.since),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { send, arrivals, changes };
}

let dir: string;
let a: Store;
let b: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-shared-'));
  const path = join(dir, 'todoer.db');
  a = openStore(path);
  b = openStore(path);
});

afterEach(() => {
  a.close();
  b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('two stores on one replica file', () => {
  it('each queued op reaches the server and both outboxes end empty', async () => {
    const srv = server();
    a.enqueue(create('from-a'));
    b.enqueue(create('from-b'));

    await Promise.all([flush(a, srv.send), flush(b, srv.send)]);

    expect([...srv.arrivals.keys()].sort()).toEqual(['from-a', 'from-b']);
    expect(a.pending()).toEqual([]);
    expect(b.pending()).toEqual([]);
    const ids = (s: Store) =>
      s
        .rows('task')
        .map((r) => r.id)
        .sort();
    expect(ids(a)).toEqual(['task-from-a', 'task-from-b']);
    expect(ids(b)).toEqual(ids(a));
    expect(a.cursor()).toBe(srv.changes.length);
  });

  it('a slower, older answer does not move the cursor back', async () => {
    const srv = server();
    a.enqueue(create('first'));
    await flush(a, srv.send); // cursor 1
    b.enqueue(create('second'));
    // b's request carries since 1; a's next flush runs alongside it.
    await Promise.all([flush(b, srv.send), flush(a, srv.send)]);
    expect(a.cursor()).toBe(2);
    expect(b.cursor()).toBe(2);
  });
});
