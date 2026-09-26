import type { Op } from '@todoer/specs';
import type { Row } from './store.js';

/** `deletedAt` of a row a queued delete has removed but the server has not
 *  confirmed. Any non-null value hides the row; this one says why. */
export const PENDING_DELETE = 'pending';

/**
 * One table as this client shows it: the rows the server last sent, with
 * the operations still in the outbox applied on top, in outbox order.
 *
 * The replica itself never holds a local edit (design doc, Q7), so a pull
 * never has to reconcile one, and a 410 can discard the replica without
 * losing anything unsent. The price is that every read walks the pending
 * operations.
 */
// ponytail: O(rows + pending) per read; fine for an outbox of hundreds.
// Index pending by id if a client stays offline for thousands of operations.
export function overlay(table: string, rows: Row[], pending: Op[]): Row[] {
  const view = new Map<string, Row>();
  for (const row of rows) view.set(String(row.id), row);
  for (const op of pending) {
    if (op.table !== table) continue;
    const current = view.get(op.id);
    if (op.kind === 'create') {
      if (current === undefined) {
        view.set(op.id, { ...op.fields, id: op.id, deletedAt: null });
      }
    } else if (op.kind === 'set') {
      if (current !== undefined) {
        view.set(op.id, { ...current, [op.field]: op.value });
      }
    } else if (current !== undefined) {
      view.set(op.id, {
        ...current,
        deletedAt: current.deletedAt ?? PENDING_DELETE,
      });
    }
  }
  return [...view.values()];
}

/** The rows `list` shows: anything not deleted, locally or on the server. */
export function liveTasks(rows: Row[]): Row[] {
  return rows.filter((row) => row.deletedAt === null);
}
