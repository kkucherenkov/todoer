import { describe, expect, it } from 'vitest';
import {
  applyChanges, assertNotRejected, liveTasks, readSyncResponse,
  NetworkError, RefusalError, type State,
} from './protocol.js';

describe('applyChanges + liveTasks', () => {
  it('keeps rows of different tables from colliding on id', () => {
    const state: State = { cursor: 0, rows: {} };
    applyChanges(state, [
      { table: 'task', id: 'x', seq: 1, row: { title: 'buy milk', deletedAt: null } },
      { table: 'project', id: 'x', seq: 2, row: { name: 'same id, different table' } },
    ]);
    expect(liveTasks(state)).toEqual([{ title: 'buy milk', deletedAt: null }]);
  });

  it('list ignores rows from other tables entirely', () => {
    const state: State = { cursor: 0, rows: {} };
    applyChanges(state, [
      { table: 'project', id: 'p1', seq: 1, row: { name: 'inbox' } },
      { table: 'tag', id: 't1', seq: 2, row: { name: 'urgent' } },
    ]);
    expect(liveTasks(state)).toEqual([]);
  });

  it('excludes a tombstoned task', () => {
    const state: State = { cursor: 0, rows: {} };
    applyChanges(state, [
      { table: 'task', id: 'x', seq: 1, row: { title: 'gone', deletedAt: '2026-01-01T00:00:00.000Z' } },
    ]);
    expect(liveTasks(state)).toEqual([]);
  });
});

describe('readSyncResponse', () => {
  it('parses a successful response', async () => {
    const res = new Response(JSON.stringify({ cursor: 1, results: [], changes: [] }), { status: 200 });
    await expect(readSyncResponse(res)).resolves.toEqual({ cursor: 1, results: [], changes: [] });
  });

  it('treats HTTP 409 as a refusal', async () => {
    const res = new Response('conflict', { status: 409 });
    await expect(readSyncResponse(res)).rejects.toBeInstanceOf(RefusalError);
  });

  it('treats any other non-2xx as a network error', async () => {
    const res = new Response('boom', { status: 500 });
    await expect(readSyncResponse(res)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('assertNotRejected', () => {
  it('throws a RefusalError when the op it cares about was rejected', () => {
    expect(() => assertNotRejected([{ opId: 'a', status: 'rejected', reason: 'nope' }], 'a'))
      .toThrow(RefusalError);
  });

  it('does nothing when the op was applied', () => {
    expect(() => assertNotRejected([{ opId: 'a', status: 'applied' }], 'a')).not.toThrow();
  });
});
