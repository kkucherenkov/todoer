import { describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { PENDING_DELETE, liveTasks, overlay } from './overlay.js';

const server = [
  { id: 'a', title: 'from the server', priority: 0, deletedAt: null },
];

function op(partial: Partial<Op> & Pick<Op, 'kind'>): Op {
  const base =
    partial.kind === 'delete'
      ? {
          opId: 'op',
          table: 'task',
          id: 'a',
          baseVersion: 1,
          ...partial,
        }
      : {
          opId: 'op',
          table: 'task',
          id: 'a',
          ts: '2026-09-26T00:00:00.000Z',
          ...partial,
        };
  return base as Op;
}

describe('overlay', () => {
  it('returns the server rows untouched when nothing is pending', () => {
    expect(overlay('task', server, [])).toEqual(server);
  });

  it('shows a queued create after the server rows', () => {
    const rows = overlay('task', server, [
      op({ kind: 'create', id: 'b', fields: { title: 'queued', priority: 1 } }),
    ]);
    expect(rows).toEqual([
      server[0],
      { id: 'b', title: 'queued', priority: 1, deletedAt: null },
    ]);
  });

  // Once the server has the row, the server's version is the truth.
  it('ignores a queued create for a row the server already sent', () => {
    const rows = overlay('task', server, [
      op({ kind: 'create', id: 'a', fields: { title: 'stale local copy' } }),
    ]);
    expect(rows).toEqual(server);
  });

  it('applies a queued set to the row it names', () => {
    const rows = overlay('task', server, [
      op({ kind: 'set', field: 'title', value: 'renamed' }),
    ]);
    expect(rows[0]).toMatchObject({ id: 'a', title: 'renamed' });
  });

  it('marks a row deleted by a queued delete', () => {
    const rows = overlay('task', server, [
      op({ kind: 'delete', baseVersion: 1 }),
    ]);
    expect(rows[0]?.deletedAt).toBe(PENDING_DELETE);
    expect(liveTasks(rows)).toEqual([]);
  });

  it('applies queued operations in order', () => {
    const rows = overlay(
      'task',
      [],
      [
        op({ kind: 'create', id: 'b', fields: { title: 'one' } }),
        op({ kind: 'set', id: 'b', field: 'title', value: 'two' }),
      ],
    );
    expect(rows).toEqual([{ id: 'b', title: 'two', deletedAt: null }]);
  });

  it('leaves other tables out', () => {
    expect(
      overlay(
        'task',
        [],
        [op({ kind: 'create', table: 'project', id: 'p', fields: {} })],
      ),
    ).toEqual([]);
  });

  it('keeps the server rows it was given unmodified', () => {
    const rows = [{ id: 'a', title: 'x', deletedAt: null }];
    overlay('task', rows, [op({ kind: 'set', field: 'title', value: 'y' })]);
    expect(rows[0]?.title).toBe('x');
  });

  it('ignores a queued set or delete for a row it has never seen', () => {
    const rows = overlay('task', server, [
      op({ kind: 'set', id: 'ghost', field: 'title', value: 'x' }),
      op({ kind: 'delete', id: 'ghost2', baseVersion: 1 }),
    ]);
    expect(rows).toEqual(server);
  });
});

describe('liveTasks', () => {
  it('drops tombstones', () => {
    expect(
      liveTasks([
        { id: 'a', deletedAt: null },
        { id: 'b', deletedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    ).toEqual([{ id: 'a', deletedAt: null }]);
  });
});
