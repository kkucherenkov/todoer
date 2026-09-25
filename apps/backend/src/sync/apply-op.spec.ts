import { describe, expect, it } from 'vitest';
import { applyOp, type Op, type Row } from './apply-op.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function row(over: Partial<Row> = {}): Row {
  return {
    id: '0192-a',
    version: 3,
    fieldTs: { title: '2026-09-25T10:00:00.000Z' },
    deletedAt: null,
    title: 'old',
    priority: 1,
    ...over,
  };
}

describe('applyOp — create', () => {
  it('applies to an absent row', () => {
    const op: Op = {
      opId: 'o1', kind: 'create', table: 'task', id: '0192-a',
      fields: { title: 'new' }, ts: '2026-09-25T11:00:00.000Z',
    };

    const out = applyOp(op, null, NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(out.row.title).toBe('new');
    expect(out.row.version).toBe(1);
  });

  // Review Focus 4: clients generate ids, so a retry or a bug can collide.
  it('does not overwrite an existing row', () => {
    const op: Op = {
      opId: 'o1', kind: 'create', table: 'task', id: '0192-a',
      fields: { title: 'clobber' }, ts: '2026-09-25T11:00:00.000Z',
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('rejected');
    if (out.status !== 'rejected') throw new Error('unreachable');
    expect(out.reason).toMatch(/exists/i);
  });
});

describe('applyOp — set', () => {
  it('applies an edit newer than the field timestamp', () => {
    const op: Op = {
      opId: 'o2', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'newer', ts: '2026-09-25T11:00:00.000Z',
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(out.row.title).toBe('newer');
    expect(out.row.version).toBe(4);
    expect(out.row.fieldTs.title).toBe('2026-09-25T11:00:00.000Z');
  });

  it('reports an edit older than the field timestamp as superseded', () => {
    const op: Op = {
      opId: 'o3', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'stale', ts: '2026-09-25T09:00:00.000Z',
    };

    expect(applyOp(op, row(), NOW).status).toBe('superseded');
  });

  // Review Focus 2: field-level, not row-level. A row-level implementation
  // passes every test above and fails this one.
  it('applies an edit to an untouched field even when the row is newer', () => {
    const current = row({ fieldTs: { title: '2026-09-25T11:59:00.000Z' } });
    const op: Op = {
      opId: 'o4', kind: 'set', table: 'task', id: '0192-a',
      field: 'priority', value: 4, ts: '2026-09-25T10:30:00.000Z',
    };

    const out = applyOp(op, current, NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(out.row.priority).toBe(4);
    expect(out.row.title).toBe('old');
  });

  // Review Focus 3: a device with a wrong clock would otherwise pin a field
  // permanently — no later edit from any device could ever win.
  it('clamps a timestamp from the far future', () => {
    const op: Op = {
      opId: 'o5', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'from the future', ts: '2030-01-01T00:00:00.000Z',
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(new Date(out.row.fieldTs.title!).getTime())
      .toBeLessThanOrEqual(NOW.getTime() + 5 * 60_000);
  });

  it('rejects a set against an absent row', () => {
    const op: Op = {
      opId: 'o6', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'x', ts: '2026-09-25T11:00:00.000Z',
    };

    expect(applyOp(op, null, NOW).status).toBe('rejected');
  });
});

describe('applyOp — delete', () => {
  it('tombstones when the base version matches', () => {
    const op: Op = {
      opId: 'o7', kind: 'delete', table: 'task', id: '0192-a', baseVersion: 3,
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(out.row.deletedAt).not.toBeNull();
    expect(out.row.version).toBe(4);
  });

  it('reports a conflict when the row moved on', () => {
    const op: Op = {
      opId: 'o8', kind: 'delete', table: 'task', id: '0192-a', baseVersion: 2,
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('conflict');
    if (out.status !== 'conflict') throw new Error('unreachable');
    expect(out.currentVersion).toBe(3);
  });
});
