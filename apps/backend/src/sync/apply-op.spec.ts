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

/** Narrows `fieldTs[field]` without a non-null assertion. */
function fieldTs(current: Row, field: string): string {
  const ts = current.fieldTs[field];
  if (ts === undefined) throw new Error(`no fieldTs recorded for ${field}`);
  return ts;
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
    expect(out.row.id).toBe(op.id);
    expect(out.row.deletedAt).toBeNull();
    expect(fieldTs(out.row, 'title')).toBe('2026-09-25T11:00:00.000Z');
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

  // I1: two plausible mutations of the create branch pass every other case —
  // writing the raw ts into fieldTs, or leaving fieldTs empty. This pins both.
  it('stamps every field with the clamped timestamp, not the raw one', () => {
    const op: Op = {
      opId: 'o11', kind: 'create', table: 'task', id: '0192-c',
      fields: { title: 'new', priority: 2 }, ts: '2030-01-01T00:00:00.000Z',
    };

    const out = applyOp(op, null, NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    const clamped = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    expect(fieldTs(out.row, 'title')).toBe(clamped);
    expect(fieldTs(out.row, 'priority')).toBe(clamped);
    expect(fieldTs(out.row, 'title')).not.toBe(op.ts);
  });

  // C2: ts is not required by the type at runtime — a payload that bypassed
  // the request validator can still omit it.
  it('rejects a create with an unparseable ts', () => {
    const op = {
      opId: 'o12', kind: 'create', table: 'task', id: '0192-d', fields: { title: 'x' },
    } as unknown as Op;

    expect(applyOp(op, null, NOW).status).toBe('rejected');
  });

  // Finding 1 (Critical, round 3): create wrote op.fields straight into the
  // row with no allow-list check at all — id/version/fieldTs/deletedAt were
  // only protected by standing after the spread, and userId/seq/createdAt/
  // updatedAt had no protection whatsoever. Tested the way set is: one case
  // per protocol field.
  it.each(['id', 'userId', 'version', 'fieldTs', 'seq', 'deletedAt', 'createdAt', 'updatedAt'])(
    'rejects a create whose fields include the protocol-owned field %s',
    (field) => {
      const op: Op = {
        opId: 'o21', kind: 'create', table: 'task', id: '0192-e',
        fields: { title: 'x', [field]: 'clobber' }, ts: '2026-09-25T11:00:00.000Z',
      };

      const out = applyOp(op, null, NOW);

      expect(out.status).toBe('rejected');
      if (out.status !== 'rejected') throw new Error('unreachable');
      expect(out.reason).toMatch(/protocol-owned/i);
    },
  );

  // Finding 2 (Important, round 3): Object.keys(op.fields) threw when fields
  // was missing — the same class of defect as an unparseable ts, just not
  // yet recognised for this property.
  it('rejects a create whose fields is missing', () => {
    const op = {
      opId: 'o22', kind: 'create', table: 'task', id: '0192-f', ts: '2026-09-25T11:00:00.000Z',
    } as unknown as Op;

    expect(applyOp(op, null, NOW).status).toBe('rejected');
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

  // M1: `ts <= seen` and `ts < seen` both pass every other case. Equality is
  // two skewed clocks landing on the same clamped instant; `<=` gives a
  // deterministic first-wins instead of an accidental last-wins.
  it('reports an edit exactly at the field timestamp as superseded', () => {
    const op: Op = {
      opId: 'o13', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'tie', ts: '2026-09-25T10:00:00.000Z',
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
    expect(new Date(fieldTs(out.row, 'title')).getTime())
      .toBeLessThanOrEqual(NOW.getTime() + 5 * 60_000);
  });

  // I2: only the future is clamped. A device offline for a week is the case
  // this design exists to serve — lifting its stale edit toward "now" would
  // make it beat a genuinely fresher edit instead of losing to it.
  it('stores a far-past timestamp unchanged', () => {
    const current = row({ fieldTs: {} });
    const op: Op = {
      opId: 'o10', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'from the past', ts: '2020-01-01T00:00:00.000Z',
    };

    const out = applyOp(op, current, NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(fieldTs(out.row, 'title')).toBe('2020-01-01T00:00:00.000Z');
  });

  it('rejects a set against an absent row', () => {
    const op: Op = {
      opId: 'o6', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'x', ts: '2026-09-25T11:00:00.000Z',
    };

    expect(applyOp(op, null, NOW).status).toBe('rejected');
  });

  // C2: same defect as create — a set can arrive with no ts at all.
  it('rejects a set with an unparseable ts', () => {
    const op = {
      opId: 'o14', kind: 'set', table: 'task', id: '0192-a', field: 'title', value: 'x',
    } as unknown as Op;

    expect(applyOp(op, row(), NOW).status).toBe('rejected');
  });

  // C1: set put the computed key before the row's literals, so id and
  // deletedAt were writable through it with no baseVersion check at all.
  it.each(['id', 'userId', 'version', 'fieldTs', 'seq', 'deletedAt', 'createdAt', 'updatedAt'])(
    'rejects a set targeting the protocol-owned field %s',
    (field) => {
      const op: Op = {
        opId: 'o15', kind: 'set', table: 'task', id: '0192-a',
        field, value: 'x', ts: '2026-09-25T11:00:00.000Z',
      };

      const out = applyOp(op, row(), NOW);

      expect(out.status).toBe('rejected');
      if (out.status !== 'rejected') throw new Error('unreachable');
      expect(out.reason).toMatch(/protocol-owned/i);
    },
  );

  // I4: an edit addressed to a row deleted on another device used to apply,
  // bump version, and report success — the client then dropped it from its
  // outbox as done although nothing visible happened.
  it('rejects a set on a tombstoned row', () => {
    const current = row({ deletedAt: '2026-09-24T00:00:00.000Z' });
    const op: Op = {
      opId: 'o16', kind: 'set', table: 'task', id: '0192-a',
      field: 'title', value: 'edit after delete', ts: '2026-09-25T11:00:00.000Z',
    };

    const out = applyOp(op, current, NOW);

    expect(out.status).toBe('rejected');
    if (out.status !== 'rejected') throw new Error('unreachable');
    expect(out.reason).toMatch(/tombstone|delet/i);
  });

  // I3: rrule shifts every occurrence, and the completion/exception logs are
  // keyed by occurrence date — a stale rule change strands them, so this
  // field opts into the same optimistic lock delete already has.
  it('applies a set with a matching baseVersion', () => {
    const op: Op = {
      opId: 'o17', kind: 'set', table: 'task', id: '0192-a',
      field: 'rrule', value: 'FREQ=DAILY', ts: '2026-09-25T11:00:00.000Z', baseVersion: 3,
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('applied');
    if (out.status !== 'applied') throw new Error('unreachable');
    expect(out.row.rrule).toBe('FREQ=DAILY');
    expect(out.row.version).toBe(4);
  });

  it('reports a conflict when a set baseVersion is stale', () => {
    const op: Op = {
      opId: 'o18', kind: 'set', table: 'task', id: '0192-a',
      field: 'rrule', value: 'FREQ=DAILY', ts: '2026-09-25T11:00:00.000Z', baseVersion: 2,
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('conflict');
    if (out.status !== 'conflict') throw new Error('unreachable');
    expect(out.currentVersion).toBe(3);
  });

  it('rejects a set on rrule without a baseVersion', () => {
    const op: Op = {
      opId: 'o19', kind: 'set', table: 'task', id: '0192-a',
      field: 'rrule', value: 'FREQ=DAILY', ts: '2026-09-25T11:00:00.000Z',
    };

    const out = applyOp(op, row(), NOW);

    expect(out.status).toBe('rejected');
    if (out.status !== 'rejected') throw new Error('unreachable');
    expect(out.reason).toMatch(/baseVersion/i);
  });

  // Finding 4 (Minor, round 3): "checked exactly as delete checks it" meant
  // the type too. baseVersion: '3' (a string) used to compare unequal to
  // current.version by strict inequality and report conflict instead of
  // rejected.
  it('rejects a set whose baseVersion is not an integer', () => {
    const op = {
      opId: 'o23', kind: 'set', table: 'task', id: '0192-a', field: 'rrule',
      value: 'FREQ=DAILY', ts: '2026-09-25T11:00:00.000Z', baseVersion: '3',
    } as unknown as Op;

    expect(applyOp(op, row(), NOW).status).toBe('rejected');
  });

  // Finding 5 (Minor, round 3): a missing/non-string field used to write a
  // column literally named "undefined" and report applied.
  it('rejects a set whose field is missing', () => {
    const op = {
      opId: 'o24', kind: 'set', table: 'task', id: '0192-a', value: 'x',
      ts: '2026-09-25T11:00:00.000Z',
    } as unknown as Op;

    expect(applyOp(op, row(), NOW).status).toBe('rejected');
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

  it('rejects a delete against an absent row', () => {
    const op: Op = {
      opId: 'o9', kind: 'delete', table: 'task', id: '0192-a', baseVersion: 1,
    };

    const out = applyOp(op, null, NOW);

    expect(out.status).toBe('rejected');
    if (out.status !== 'rejected') throw new Error('unreachable');
    expect(out.reason).toMatch(/no such row/i);
  });

  // C2: baseVersion is required by the contract, but the module must not
  // trust that every caller validated it — defense in depth against a
  // payload that bypassed the validator, or a bug in an earlier stage.
  it('rejects a delete with a non-integer baseVersion', () => {
    const op = {
      opId: 'o20', kind: 'delete', table: 'task', id: '0192-a',
    } as unknown as Op;

    expect(applyOp(op, row(), NOW).status).toBe('rejected');
  });
});
