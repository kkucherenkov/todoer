import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  assertNotRefused,
  liveTasks,
  ownOutcome,
  readSyncResponse,
  ConflictError,
  NetworkError,
  RefusalError,
  type State,
} from './protocol.js';

describe('applyChanges + liveTasks', () => {
  it('keeps rows of different tables from colliding on id', () => {
    const state: State = { cursor: 0, rows: {} };
    applyChanges(state, [
      {
        table: 'task',
        id: 'x',
        seq: 1,
        row: { title: 'buy milk', deletedAt: null },
      },
      {
        table: 'project',
        id: 'x',
        seq: 2,
        row: { name: 'same id, different table' },
      },
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
      {
        table: 'task',
        id: 'x',
        seq: 1,
        row: { title: 'gone', deletedAt: '2026-01-01T00:00:00.000Z' },
      },
    ]);
    expect(liveTasks(state)).toEqual([]);
  });
});

describe('readSyncResponse', () => {
  it('parses a successful response', async () => {
    const res = new Response(
      JSON.stringify({ cursor: 1, results: [], changes: [] }),
      { status: 200 },
    );
    await expect(readSyncResponse(res)).resolves.toEqual({
      cursor: 1,
      results: [],
      changes: [],
    });
  });

  // The token lives 15 minutes and there is no `login` command, so this is
  // the failure a long-running agent meets first. Read as a network error it
  // is retried forever; read as a refusal it is a signal to get a new token.
  it('treats an expired or missing token as a refusal, not a network failure', async () => {
    const res = new Response('unauthorized', { status: 401 });
    await expect(readSyncResponse(res)).rejects.toBeInstanceOf(RefusalError);
  });

  it('treats a refused batch as a refusal', async () => {
    const res = new Response('payload too large', { status: 413 });
    await expect(readSyncResponse(res)).rejects.toBeInstanceOf(RefusalError);
  });

  it('treats a server fault as a network error, which is the retryable one', async () => {
    const res = new Response('boom', { status: 500 });
    await expect(readSyncResponse(res)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('assertNotRefused', () => {
  it('throws a RefusalError when the op it cares about was rejected', () => {
    expect(() =>
      assertNotRefused(
        [{ opId: 'a', status: 'rejected', reason: 'nope' }],
        'a',
      ),
    ).toThrow(RefusalError);
  });

  // The real conflict signal: /sync answers 200 and reports it per operation.
  // The server never returns 409 on that path, which is why reading conflict
  // off the HTTP status found nothing.
  it('throws a ConflictError when the server has a newer version of the row', () => {
    expect(() =>
      assertNotRefused(
        [{ opId: 'a', status: 'conflict', currentVersion: 7 }],
        'a',
      ),
    ).toThrow(ConflictError);
  });

  it('names the version the caller has to rebase onto', () => {
    expect(() =>
      assertNotRefused(
        [{ opId: 'a', status: 'conflict', currentVersion: 7 }],
        'a',
      ),
    ).toThrow(/7/);
  });

  // A response that does not mention the operation it was sent is not
  // success: the caller has no idea whether the write happened, and a silent
  // exit 0 is the one outcome that makes an automation caller confidently do
  // the wrong thing.
  it('refuses a response that says nothing about the op at all', () => {
    expect(() => assertNotRefused([], 'a')).toThrow(RefusalError);
    expect(() =>
      assertNotRefused([{ opId: 'b', status: 'applied' }], 'a'),
    ).toThrow(RefusalError);
  });

  it('does nothing when the op was applied', () => {
    expect(() =>
      assertNotRefused([{ opId: 'a', status: 'applied' }], 'a'),
    ).not.toThrow();
  });

  // A redelivered op that had already been applied, and an edit an older
  // timestamp lost to: both mean the intent is in the server's state, which
  // is what the caller asked for.
  it('does nothing for a duplicate or a superseded op', () => {
    expect(() =>
      assertNotRefused([{ opId: 'a', status: 'duplicate' }], 'a'),
    ).not.toThrow();
    expect(() =>
      assertNotRefused([{ opId: 'a', status: 'superseded' }], 'a'),
    ).not.toThrow();
  });
});

describe('ownOutcome', () => {
  it('is settled when the server applied, deduplicated or superseded it', () => {
    for (const status of ['applied', 'duplicate', 'superseded'] as const) {
      expect(ownOutcome([{ opId: 'a', status }], 'a')).toBe('settled');
    }
  });

  it('is unreported when the response does not mention it', () => {
    expect(ownOutcome([{ opId: 'b', status: 'applied' }], 'a')).toBe(
      'unreported',
    );
  });

  it('throws a RefusalError carrying the reason for a rejection', () => {
    expect(() =>
      ownOutcome(
        [{ opId: 'a', status: 'rejected', reason: 'unknown field: x' }],
        'a',
      ),
    ).toThrow(/unknown field: x/);
    expect(() => ownOutcome([{ opId: 'a', status: 'rejected' }], 'a')).toThrow(
      RefusalError,
    );
  });

  it('throws a ConflictError naming the current version', () => {
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(ConflictError);
    expect(() =>
      ownOutcome([{ opId: 'a', status: 'conflict', currentVersion: 7 }], 'a'),
    ).toThrow(/7/);
  });
});
