/**
 * The conflict rules of the sync protocol, as a pure function.
 *
 * Kept free of Prisma so that every rule is testable without a database — this
 * is the one module whose correctness is not obvious by reading it, and the
 * cases that matter (an edit arriving late, a clock that is wrong, a create
 * that collides) are awkward to stage against a real server.
 *
 * Invariant: `applyOp` never throws. Any operation the caller could not have
 * validated up front — an unparseable `ts`, a non-integer `baseVersion` — is
 * reported as `{ status: 'rejected' }`. Task 6 applies a batch of operations
 * inside one transaction, so a throw here would fail every other operation in
 * the same request alongside it, and the client's outbox would never drain.
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
  | {
      opId: string;
      kind: 'set';
      table: string;
      id: string;
      field: string;
      value: unknown;
      ts: string;
      /**
       * Opt-in optimistic lock for a destructive field, e.g. `rrule` — see
       * ADR 0004. Absent for an ordinary field edit, where per-field
       * last-write-wins is the only conflict rule.
       */
      baseVersion?: number;
    }
  | { opId: string; kind: 'delete'; table: string; id: string; baseVersion: number };

export type Outcome =
  | { status: 'applied'; row: Row }
  | { status: 'superseded' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'rejected'; reason: string };

/**
 * How far a client clock may lead the server before its timestamp is
 * clamped. Only the future is bounded — see ADR 0004 for why a clock that
 * lags is left alone: a device offline for a week is the case this design
 * exists to serve, and lifting its timestamp toward "now" would make its
 * stale edit beat a fresh one instead of losing to it.
 */
const MAX_SKEW_AHEAD_MS = 5 * 60_000;

/** Fields whose change is destructive enough to require an explicit
 *  baseVersion opt-in — see ADR 0004. A stale rrule change strands the
 *  completion/exception logs, which are keyed by occurrence date, on
 *  dates the new rule no longer generates. */
const FIELDS_REQUIRING_BASE_VERSION = new Set(['rrule']);

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
  const hi = now.getTime() + MAX_SKEW_AHEAD_MS;
  return new Date(Math.min(t, hi)).toISOString();
}

/** True for a value that `new Date(...)` can turn into a real instant. */
function isParseableTimestamp(ts: unknown): ts is string {
  return typeof ts === 'string' && !Number.isNaN(new Date(ts).getTime());
}

export function applyOp(op: Op, current: Row | null, now: Date): Outcome {
  if (op.kind === 'create') {
    if (current !== null) {
      return { status: 'rejected', reason: 'a row with this id already exists' };
    }
    if (!isParseableTimestamp(op.ts)) {
      return { status: 'rejected', reason: 'ts is missing or not a valid timestamp' };
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
    if (!isParseableTimestamp(op.ts)) {
      return { status: 'rejected', reason: 'ts is missing or not a valid timestamp' };
    }
    if (FIELDS_REQUIRING_BASE_VERSION.has(op.field) && op.baseVersion === undefined) {
      return { status: 'rejected', reason: `${op.field} requires baseVersion` };
    }
    if (current === null) {
      return { status: 'rejected', reason: 'no such row' };
    }
    if (current.deletedAt !== null) {
      return { status: 'rejected', reason: 'row is deleted (tombstoned)' };
    }
    if (op.baseVersion !== undefined && current.version !== op.baseVersion) {
      return { status: 'conflict', currentVersion: current.version };
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

  if (!Number.isInteger(op.baseVersion)) {
    return { status: 'rejected', reason: 'baseVersion is missing or not an integer' };
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
