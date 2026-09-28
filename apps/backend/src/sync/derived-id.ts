import { taskOccurrenceId, taskTagId } from '@todoer/specs';
import type { Op } from './apply-op.js';

type Derivation = {
  /** The fields the id is derived from; they can never change. */
  keys: readonly string[];
  /** The field a client toggles instead of deleting the row. */
  toggle: string;
  /** The id these fields derive, or null if they cannot derive one. */
  derive(fields: Record<string, unknown>): string | null;
};

/**
 * Tables whose id is UUIDv5 of a natural key (plan C design, Q2 and Q7). Two
 * clients recording the same fact offline mint the same id, so the server
 * sees one row instead of two that a unique index would have to refuse. The
 * server recomputes the id on every create: POST /sync is the only write
 * path, so a client that derived it wrongly is stopped here or nowhere.
 */
const DERIVED: Readonly<Record<string, Derivation>> = {
  task_occurrence: {
    keys: ['taskId', 'occurrence'],
    toggle: 'state',
    derive: ({ taskId, occurrence = null }) =>
      typeof taskId === 'string' &&
      (occurrence === null || typeof occurrence === 'string')
        ? taskOccurrenceId(taskId, occurrence)
        : null,
  },
  task_tag: {
    keys: ['taskId', 'tagId'],
    toggle: 'attached',
    derive: ({ taskId, tagId }) =>
      typeof taskId === 'string' && typeof tagId === 'string'
        ? taskTagId(taskId, tagId)
        : null,
  },
};

export function isDerivedIdTable(table: string): boolean {
  return Object.hasOwn(DERIVED, table);
}

/**
 * The fields `table`'s id is derived from, or `[]` for a table with no
 * derivation. Passed to `applyOp` as `identityKeys` so a create-merge never
 * lets one of these win on its own — they always carry the same value as
 * the row already holds (M2).
 */
export function derivedIdKeys(table: string): readonly string[] {
  return DERIVED[table]?.keys ?? [];
}

/**
 * Why this op cannot be applied to a derived-id table, or `null`. A malformed
 * `fields` is left to applyOp. Dates are already checked (dateRejection runs
 * first), so `occurrence` is canonical by the time it is hashed.
 */
export function derivedIdRejection(table: string, op: Op): string | null {
  const derivation = DERIVED[table];
  if (derivation === undefined) return null;
  if (op.kind === 'delete') {
    return `rows of ${table} are never deleted; set ${derivation.toggle} instead`;
  }
  if (op.kind === 'set') {
    return derivation.keys.includes(op.field)
      ? `${op.field} is part of this row’s identity and cannot change`
      : null;
  }
  if (
    typeof op.fields !== 'object' ||
    op.fields === null ||
    Array.isArray(op.fields)
  ) {
    return null;
  }
  const derived = derivation.derive(op.fields);
  // `typeof` first: this runs before the UUID check, and a throw here would
  // escape applyOne's per-op rejection as a 500.
  return derived !== null &&
    typeof op.id === 'string' &&
    derived === op.id.toLowerCase()
    ? null
    : `id does not match the id derived from ${derivation.keys.join(', ')}`;
}
