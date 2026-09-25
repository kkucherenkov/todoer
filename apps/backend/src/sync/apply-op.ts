/**
 * The conflict rules of the sync protocol, as a pure function.
 *
 * Kept free of Prisma so that every rule is testable without a database — this
 * is the one module whose correctness is not obvious by reading it, and the
 * cases that matter (an edit arriving late, a clock that is wrong, a create
 * that collides) are awkward to stage against a real server.
 *
 * Invariant: `applyOp` never throws, for any `op` that is an *object* — an
 * unparseable `ts`, a non-integer `baseVersion`, a `fields` that is not an
 * object, a `field` that is missing or not a string. Each is validated
 * before use and reported as `{ status: 'rejected' }` instead. A `null` or
 * `undefined` `op` is not covered: `op.kind` is read on the first line, so a
 * non-object `op` still throws. That is the caller's responsibility, not
 * this module's — the contract's `oneOf` discriminator on `kind` rejects a
 * non-object body before it ever reaches here. `SyncService` gives each
 * operation its own transaction and its own catch, but that catch only
 * turns a *Prisma* error into a clean per-operation rejection — a throw
 * from this module would not be one, so it would still escape as an
 * unrecognized error and fail the whole request rather than the one
 * operation, and the client's outbox would never drain. `current` and `now`
 * are not part of this guarantee: they are server-constructed (a database
 * row, the server's own clock), not client
 * input, so the module trusts their shape.
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

/**
 * The one path both `create` and `set` route through to enforce
 * `PROTOCOL_FIELDS`, so the check cannot drift between the two branches the
 * way the accidental spread-order protection once did.
 */
function protocolFieldRejection(field: string): Outcome | null {
  if (!PROTOCOL_FIELDS.has(field)) return null;
  return {
    status: 'rejected',
    reason: `${field} is protocol-owned and cannot be set directly`,
  };
}

/**
 * A task may not be its own parent. The rule lives here rather than only in
 * the database's CHECK constraint (see the 20260925200000 migration) because
 * it is a rule about the operation, not about storage: decided here, the
 * client is told which operation was refused and why, instead of the whole
 * batch failing on a constraint error that names a column. The constraint
 * stays as defence in depth, for write paths that do not exist yet.
 *
 * The depth rule's other half — that the *parent* must have no parent of its
 * own — needs a second row and therefore the database; it lives in
 * SyncService, beside the ownership check that already loads the referenced
 * row. That half forbids every cycle **when operations arrive one at a
 * time**; two concurrent `set parentId` operations pointing at each other can
 * still write one, because each reads the other's row before the other has
 * parented it. See SyncService's note on referenceRejection for the
 * reproduction and the two candidate fixes.
 */
function selfParentRejection(field: string, value: unknown, id: string): Outcome | null {
  if (field !== 'parentId' || value !== id) return null;
  return { status: 'rejected', reason: 'a task cannot be its own parent' };
}

function clamp(ts: string, now: Date): string {
  const t = new Date(ts).getTime();
  const hi = now.getTime() + MAX_SKEW_AHEAD_MS;
  return new Date(Math.min(t, hi)).toISOString();
}

/** True for a value that `new Date(...)` can turn into a real instant. */
function isParseableTimestamp(ts: unknown): ts is string {
  return typeof ts === 'string' && !Number.isNaN(new Date(ts).getTime());
}

/** True for a plain object `Object.keys` can walk without throwing. */
function isFieldsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a non-empty string — what a column name must be to mean anything. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True for the shape `delete`'s and `set`'s optimistic lock both require. */
function isValidBaseVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function applyOp(op: Op, current: Row | null, now: Date): Outcome {
  if (op.kind === 'create') {
    if (current !== null) {
      return { status: 'rejected', reason: 'a row with this id already exists' };
    }
    if (!isFieldsRecord(op.fields)) {
      return { status: 'rejected', reason: 'fields is missing or not an object' };
    }
    for (const key of Object.keys(op.fields)) {
      const blocked = protocolFieldRejection(key);
      if (blocked) return blocked;
    }
    const selfParent = selfParentRejection('parentId', op.fields.parentId, op.id);
    if (selfParent) return selfParent;
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
    if (!isNonEmptyString(op.field)) {
      return { status: 'rejected', reason: 'field is missing or not a string' };
    }
    const blockedField = protocolFieldRejection(op.field);
    if (blockedField) return blockedField;
    const selfParent = selfParentRejection(op.field, op.value, op.id);
    if (selfParent) return selfParent;
    if (!isParseableTimestamp(op.ts)) {
      return { status: 'rejected', reason: 'ts is missing or not a valid timestamp' };
    }
    if (op.baseVersion !== undefined && !isValidBaseVersion(op.baseVersion)) {
      return { status: 'rejected', reason: 'baseVersion is not an integer' };
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

  if (!isValidBaseVersion(op.baseVersion)) {
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
