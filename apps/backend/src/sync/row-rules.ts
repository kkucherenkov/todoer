import { filterProblem, parseRrule } from '@todoer/specs';

const STATES: ReadonlySet<unknown> = new Set(['open', 'done', 'skipped']);
const LAYOUTS: ReadonlySet<unknown> = new Set(['list', 'kanban', 'calendar']);
const SORTS: ReadonlySet<unknown> = new Set([
  'manual',
  'priority',
  'due',
  'scheduled',
]);

const isName = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';
const isSet = (value: unknown): boolean =>
  value !== null && value !== undefined;

/**
 * Why a row, as it would be after an applied operation, may not be stored —
 * or `null`. Checked on the resulting row rather than on the op, because
 * `set dtstart null` or `set parentId` breaks a recurring task without
 * mentioning `rrule` at all.
 *
 * Covers tasks (rrule, origin), task occurrences, statuses and views; a
 * view's filter is stored only if every client can evaluate it (design Q6).
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
    if (isSet(row.originTaskId) !== isSet(row.originOccurrence)) {
      return 'originTaskId and originOccurrence are set together';
    }
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
  if (table === 'status') {
    if (!isName(row.name)) return 'name must be a non-empty string';
    if (typeof row.rank !== 'string') return 'rank must be a string';
    if (row.completing !== undefined && typeof row.completing !== 'boolean') {
      return 'completing must be a boolean';
    }
    if (isSet(row.color) && typeof row.color !== 'string') {
      return 'color must be a string or null';
    }
    return null;
  }
  if (table === 'view') {
    if (!isName(row.name)) return 'name must be a non-empty string';
    if (!LAYOUTS.has(row.layout)) {
      return 'layout must be one of list, kanban, calendar';
    }
    if (!SORTS.has(row.sort)) {
      return 'sort must be one of manual, priority, due, scheduled';
    }
    if (typeof row.rank !== 'string') return 'rank must be a string';
    const problem = filterProblem(row.filter);
    return problem === null ? null : `filter: ${problem}`;
  }
  return null;
}
