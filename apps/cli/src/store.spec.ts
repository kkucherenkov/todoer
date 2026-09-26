import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { UsageError } from './protocol.js';
import { Store } from './store.js';

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
  const store = Store.open(join(dir, name));
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
  it('keeps queued operations in the order they were queued', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    expect(store.pending().map((op) => op.opId)).toEqual(['a', 'b']);
  });

  it('keeps the outbox on disk across a reopen', () => {
    const first = Store.open(join(dir, 'todoer.db'));
    first.enqueue(create('a'));
    first.close();
    expect(storeAt().pending()).toEqual([create('a')]);
  });

  // Review Focus 1: two invocations share one file. With a JSON file, the
  // second writer's copy would not contain the first writer's operation.
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

  it('returns rows in seq order', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'b', seq: 2, row: { id: 'b' } },
      { table: 'task', id: 'a', seq: 1, row: { id: 'a' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'a' }, { id: 'b' }]);
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
    );
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([{ id: 'task-a' }]);
    expect(store.cursor()).toBe(3);
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

  it('keeps the database readable only by its owner', () => {
    storeAt();
    expect(statSync(join(dir, 'todoer.db')).mode & 0o777).toBe(0o600);
  });
});
