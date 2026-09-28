import { parseRrule } from '@todoer/specs';

const STATES: ReadonlySet<unknown> = new Set(['open', 'done', 'skipped']);

/**
 * Why a row, as it would be after an applied operation, may not be stored —
 * or `null`. Checked on the resulting row rather than on the op, because
 * `set dtstart null` or `set parentId` breaks a recurring task without
 * mentioning `rrule` at all.
 *
 * The server parses a rule but never expands it (plan C design, Q6, Q14): it
 * does not check that an occurrence belongs to the rule, which a concurrent
 * rule change would make a false rejection.
 */
export function rowRejection(
  table: string,
  row: Record<string, unknown>,
): string | null {
  if (table === 'task') {
    const { rrule, dtstart, parentId } = row;
    if (rrule === null || rrule === undefined) return null;
    if (typeof rrule !== 'string') return 'rrule must be a string';
    const parsed = parseRrule(rrule);
    if (!parsed.ok) return `rrule: ${parsed.error}`;
    if (dtstart === null || dtstart === undefined)
      return 'rrule requires dtstart';
    if (parentId !== null && parentId !== undefined) {
      return 'a subtask cannot carry an rrule (ADR 0009)';
    }
    return null;
  }
  if (table === 'task_occurrence') {
    const { state } = row;
    return state === undefined || STATES.has(state)
      ? null
      : 'state must be one of open, done, skipped';
  }
  return null;
}
