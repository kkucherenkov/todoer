import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { UsageError } from './protocol.js';
import type { Store } from './store.js';
import { openStore } from './test-store.js';

let dir: string;
let open: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-store-'));
  open = [];
});

afterEach(() => {
  for (const store of open) store.close();
  rmSync(dir, { recursive: true, force: true });
});

function storeAt(name = 'todoer.db'): Store {
  const store = openStore(join(dir, name));
  open.push(store);
  return store;
}

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

describe('Store', () => {
  // G4: op ids sort the other way round from queue order, so a passing
  // result can only come from `ORDER BY position`, not from `op_id` order.
  it('keeps queued operations in the order they were queued', () => {
    const store = storeAt();
    store.enqueue(create('b'));
    store.enqueue(create('a'));
    expect(store.pending().map((op) => op.opId)).toEqual(['b', 'a']);
  });

  it('keeps the outbox on disk across a reopen', () => {
    const first = openStore(join(dir, 'todoer.db'));
    first.enqueue(create('a'));
    first.close();
    expect(storeAt().pending()).toEqual([create('a')]);
  });

  // Review Focus 1: pins that two connections share one file's outbox, so
  // neither one's writes are shadowed by the other's in-memory copy — with a
  // JSON file, the second writer's copy would not contain the first writer's
  // operation. It does not exercise real parallelism (both calls here are
  // sequential); that is proved by the barrier test below and by
  // scripts/outbox-e2e.sh.
  it('loses no operation when two connections queue into one file', () => {
    const first = storeAt();
    const second = storeAt();
    first.enqueue(create('a'));
    second.enqueue(create('b'));
    first.enqueue(create('c'));
    expect(second.pending().map((op) => op.opId)).toEqual(['a', 'b', 'c']);
  });

  it('removes settled operations and keeps refused ones as failed', () => {
    const store = storeAt();
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.enqueue(create(id));
    store.settle(
      [
        { opId: 'a', status: 'applied' },
        { opId: 'b', status: 'duplicate' },
        { opId: 'c', status: 'superseded' },
        { opId: 'd', status: 'rejected', reason: 'unknown field: x' },
        { opId: 'e', status: 'conflict', currentVersion: 7 },
      ],
      new Set(),
    );
    expect(store.pending()).toEqual([]);
    expect(
      store
        .entries()
        .map((e) => [e.opId, e.status, e.reason, e.currentVersion]),
    ).toEqual([
      ['d', 'failed', 'unknown field: x', null],
      ['e', 'failed', null, 7],
    ]);
    expect(store.counts()).toEqual({ pending: 0, failed: 2 });
  });

  // Plan ruling 4: the invocation that queued it reports it by exit code.
  it("removes the caller's own refused operation instead of keeping it", () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.settle(
      [{ opId: 'a', status: 'rejected', reason: 'no' }],
      new Set(['a']),
    );
    expect(store.entries()).toEqual([]);
  });

  it('looks one entry up by op id, and removes one', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    store.settle([{ opId: 'a', status: 'rejected', reason: 'no' }], new Set());

    expect(store.entry('a')).toMatchObject({ status: 'failed', reason: 'no' });
    expect(store.entry('nope')).toBeUndefined();

    store.remove('a');
    expect(store.entry('a')).toBeUndefined();
    expect(store.entries().map((e) => e.opId)).toEqual(['b']);
  });

  it('drops failed entries, and refuses anything else without dropping', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    store.settle([{ opId: 'a', status: 'rejected', reason: 'no' }], new Set());

    expect(() => store.drop(['a', 'b'])).toThrow(UsageError);
    expect(() => store.drop(['nope'])).toThrow(UsageError);
    expect(store.entries()).toHaveLength(2);

    store.drop(['a']);
    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['b', 'pending'],
    ]);
  });

  // Review Focus 5: two invocations flushing at once can merge an older
  // response after a newer one.
  it('never replaces a row with an older version of it', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 5, row: { id: 'x', title: 'new' } },
    ]);
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 3, row: { id: 'x', title: 'old' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'new' }]);
  });

  it('never moves the cursor backwards', () => {
    const store = storeAt();
    expect(store.cursor()).toBe(0);
    store.advanceCursor(9);
    store.advanceCursor(4);
    expect(store.cursor()).toBe(9);
  });

  it('keeps rows of different tables apart even with the same id', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 1, row: { id: 'x', title: 'task' } },
      { table: 'project', id: 'x', seq: 2, row: { id: 'x', name: 'project' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'task' }]);
  });

  // G3: seq order here is the reverse of id order, so a fixture that
  // happened to line up with the primary key's own order (tbl, id) cannot
  // pass by accident — only `ORDER BY seq` can.
  it('returns rows in seq order', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'a', seq: 2, row: { id: 'a' } },
      { table: 'task', id: 'b', seq: 1, row: { id: 'b' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'b' }, { id: 'a' }]);
  });

  it('discards the replica but not the outbox on reset', () => {
    const store = storeAt();
    store.mergeChanges([{ table: 'task', id: 'x', seq: 5, row: { id: 'x' } }]);
    store.advanceCursor(5);
    store.enqueue(create('a'));

    store.resetReplica();

    expect(store.rows('task')).toEqual([]);
    expect(store.cursor()).toBe(0);
    expect(store.pending()).toHaveLength(1);
  });

  it('applies a whole response in one step', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.applyResponse(
      {
        cursor: 3,
        results: [{ opId: 'a', status: 'applied' }],
        changes: [
          { table: 'task', id: 'task-a', seq: 3, row: { id: 'task-a' } },
        ],
      },
      new Set(),
      0,
    );
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([{ id: 'task-a' }]);
    expect(store.cursor()).toBe(3);
  });

  // FR-001: a response that fails half-way leaves nothing behind — not the
  // verdicts, not the rows before the one that failed, not the cursor.
  it('applies nothing of a response that fails half-way', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    expect(() =>
      store.applyResponse(
        {
          cursor: 3,
          results: [{ opId: 'a', status: 'applied' }],
          changes: [
            { table: 'task', id: 'ok', seq: 2, row: { id: 'ok' } },
            // JSON.stringify throws on a BigInt.
            { table: 'task', id: 'bad', seq: 3, row: { x: 1n } },
          ],
        },
        new Set(),
        0,
      ),
    ).toThrow();
    expect(store.pending().map((op) => op.opId)).toEqual(['a']);
    expect(store.cursor()).toBe(0);
    expect(store.rows('task')).toEqual([]);
  });

  // Minor 7: a delta computed for cursor 40 is only the rows after 40. Merged
  // into a replica a parallel 410 has just emptied, it would leave a partial
  // replica behind a cursor that claims everything up to 50.
  it('settles but does not merge a delta computed for a replica since reset', () => {
    const store = storeAt();
    store.advanceCursor(40);
    store.enqueue(create('a'));
    store.resetReplica();

    store.applyResponse(
      {
        cursor: 50,
        results: [{ opId: 'a', status: 'applied' }],
        changes: [
          { table: 'task', id: 'task-a', seq: 45, row: { id: 'task-a' } },
        ],
      },
      new Set(),
      40,
    );

    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([]);
    expect(store.cursor()).toBe(0);
  });

  it('rolls a transaction back when it throws', () => {
    const store = storeAt();
    expect(() =>
      store.transaction(() => {
        store.enqueue(create('a'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.pending()).toEqual([]);
  });

  // G6: a ROLLBACK issued after the transaction already ended (SQLite can
  // end one itself, e.g. on SQLITE_FULL) throws "no transaction is active"
  // and must not hide the real error `fn` threw.
  it('surfaces the original error even when the transaction already ended', () => {
    const store = storeAt();
    expect(() =>
      store.transaction(() => {
        (store as unknown as { db: { exec(sql: string): void } }).db.exec(
          'ROLLBACK',
        );
        throw new Error('original');
      }),
    ).toThrow('original');
  });
});

describe('Store auth', () => {
  const auth = {
    accessToken: 'a1',
    accessExpiresAt: '2026-10-01T00:15:00.000Z',
    refreshToken: 'r1',
  };

  it('round-trips the session and replaces it on a second save', () => {
    const store = storeAt();
    expect(store.auth()).toBeUndefined();
    store.saveAuth(auth);
    expect(store.auth()).toEqual(auth);
    store.saveAuth({ ...auth, accessToken: 'a2' });
    expect(store.auth()?.accessToken).toBe('a2');
  });

  it('keeps the session through a replica reset and drops it on clearAuth', () => {
    const store = storeAt();
    store.saveAuth(auth);
    store.resetReplica();
    expect(store.auth()).toEqual(auth);
    store.clearAuth();
    expect(store.auth()).toBeUndefined();
  });

  it('makes a second store wait for the lock until the first body resolves', async () => {
    const first = storeAt();
    const second = storeAt();
    const events: string[] = [];
    let release!: () => void;
    const held = first.withWriteLock(async () => {
      events.push('first start');
      await new Promise<void>((resolve) => (release = resolve));
      events.push('first end');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const waiting = second.withWriteLock(() => {
      events.push('second start');
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events).toEqual(['first start']);
    release();
    await Promise.all([held, waiting]);
    expect(events).toEqual(['first start', 'first end', 'second start']);
  });

  it('rolls back and releases the lock when the body throws', async () => {
    const store = storeAt();
    await expect(
      store.withWriteLock(() => {
        store.saveAuth(auth);
        return Promise.reject(new Error('boom'));
      }),
    ).rejects.toThrow('boom');
    expect(store.auth()).toBeUndefined();
    await store.withWriteLock(() => Promise.resolve());
  });

  // The lock polls with the busy timeout off; every other statement must get
  // it back, on the success path and the throw path alike.
  it('restores the busy timeout after the lock is taken', async () => {
    const store = storeAt();
    const busyTimeout = () =>
      (store as unknown as { db: { all<T>(sql: string): T[] } }).db.all<{
        timeout: number;
      }>('PRAGMA busy_timeout')[0] as { timeout: number };
    await store.withWriteLock(() => {
      expect(busyTimeout().timeout).toBe(5000);
      return Promise.resolve();
    });
    expect(busyTimeout().timeout).toBe(5000);
    await expect(
      store.withWriteLock(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(busyTimeout().timeout).toBe(5000);
  });

  // BEGIN IMMEDIATE inside an open transaction fails with a non-busy error
  // (SQLITE_ERROR), the path that skips the retry and rethrows.
  it('restores the busy timeout when BEGIN itself fails', async () => {
    const store = storeAt();
    const db = (
      store as unknown as {
        db: { exec(sql: string): void; all<T>(sql: string): T[] };
      }
    ).db;
    db.exec('BEGIN');
    await expect(store.withWriteLock(() => Promise.resolve())).rejects.toThrow(
      /within a transaction/,
    );
    db.exec('ROLLBACK');
    expect(db.all<{ timeout: number }>('PRAGMA busy_timeout')[0]?.timeout).toBe(
      5000,
    );
  });
});

describe('claim', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('is seen after the transaction commits and not after a rollback', () => {
    const store = storeAt();
    store.transaction(() => store.claim('a', 1000));
    expect(store.seen('a')).toBe(true);
    expect(() =>
      store.transaction(() => {
        store.claim('b', 1000);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.seen('b')).toBe(false);
  });

  it('forgets markers older than 7 days on the next claim', () => {
    const store = storeAt();
    store.claim('old', 0);
    store.claim('edge', DAY);
    store.claim('new', 8 * DAY);
    expect(store.seen('old')).toBe(false);
    expect(store.seen('edge')).toBe(true);
    expect(store.seen('new')).toBe(true);
  });

  it('does not touch the cursor', () => {
    const store = storeAt();
    store.advanceCursor(5);
    store.claim('a', 100 * DAY);
    expect(store.cursor()).toBe(5);
  });
});
