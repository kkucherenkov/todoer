/**
 * The conflict rules of the sync protocol, as a pure function.
 *
 * Kept free of Prisma so that every rule is testable without a database — this
 * is the one module whose correctness is not obvious by reading it, and the
 * cases that matter (an edit arriving late, a clock that is wrong, a create
 * that collides) are awkward to stage against a real server.
 */

export type Row = {
  id: string;
  version: number;
  fieldTs: Record<string, string>;
  deletedAt: string | null;
  [key: string]: unknown;
};

export type Op =
  | { opId: string; kind: 'create'; table: string; id: string; fields: Record<string, unknown>; ts: string }
  | { opId: string; kind: 'set'; table: string; id: string; field: string; value: unknown; ts: string }
  | { opId: string; kind: 'delete'; table: string; id: string; baseVersion: number };

export type Outcome =
  | { status: 'applied'; row: Row }
  | { status: 'superseded' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'rejected'; reason: string };

/** How far a client clock may lead or lag the server before it is clamped. */
const MAX_SKEW_AHEAD_MS = 5 * 60_000;
const MAX_SKEW_BEHIND_MS = 24 * 60 * 60_000;

/**
 * Columns the sync protocol owns. `set` may never target them directly:
 * `deletedAt` would let a client tombstone or resurrect a row without the
 * base-version check `delete` requires, and `id`/`version`/`fieldTs` would
 * let it rewrite the primary key or the bookkeeping conflict resolution
 * itself depends on.
 */
const PROTOCOL_FIELDS = new Set([
  'id',
  'userId',
  'version',
  'fieldTs',
  'seq',
  'deletedAt',
  'createdAt',
  'updatedAt',
]);

function clamp(ts: string, now: Date): string {
  const t = new Date(ts).getTime();
  const lo = now.getTime() - MAX_SKEW_BEHIND_MS;
  const hi = now.getTime() + MAX_SKEW_AHEAD_MS;
  return new Date(Math.min(Math.max(t, lo), hi)).toISOString();
}

export function applyOp(op: Op, current: Row | null, now: Date): Outcome {
  if (op.kind === 'create') {
    if (current !== null) {
      return { status: 'rejected', reason: 'a row with this id already exists' };
    }
    const ts = clamp(op.ts, now);
    const fieldTs: Record<string, string> = {};
    for (const key of Object.keys(op.fields)) fieldTs[key] = ts;
    return {
      status: 'applied',
      row: { ...op.fields, id: op.id, version: 1, fieldTs, deletedAt: null },
    };
  }

  if (op.kind === 'set') {
    if (PROTOCOL_FIELDS.has(op.field)) {
      return {
        status: 'rejected',
        reason: `${op.field} is protocol-owned and cannot be set directly`,
      };
    }
    if (current === null) {
      return { status: 'rejected', reason: 'no such row' };
    }
    const ts = clamp(op.ts, now);
    const seen = current.fieldTs[op.field];
    if (seen !== undefined && ts <= seen) {
      return { status: 'superseded' };
    }
    return {
      status: 'applied',
      row: {
        ...current,
        [op.field]: op.value,
        version: current.version + 1,
        fieldTs: { ...current.fieldTs, [op.field]: ts },
      },
    };
  }

  if (current === null) {
    return { status: 'rejected', reason: 'no such row' };
  }
  if (current.version !== op.baseVersion) {
    return { status: 'conflict', currentVersion: current.version };
  }
  return {
    status: 'applied',
    row: { ...current, deletedAt: now.toISOString(), version: current.version + 1 },
  };
}
