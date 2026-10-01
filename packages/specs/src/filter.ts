import { addDays, isIsoDate } from './dates';

/** A day offset from the client's local today, or an absolute date. */
export type DateBound = number | string;
/** Inclusive; an absent bound is open. `{}` matches any date at all. */
export type DateRange = { from?: DateBound; to?: DateBound };

/**
 * A view's filter (views design, Q6): a boolean tree over predicates,
 * referencing rows by id and dates by offsets from today. Check one with
 * `filterProblem` before storing or evaluating it.
 */
export type Filter =
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter }
  | { tag: string }
  | { project: string | null }
  | { status: string }
  | { priority: number[] }
  | { scheduled: DateRange }
  | { due: DateRange }
  | { recurring: boolean };

/**
 * What the evaluator needs to know about one task, resolved by the caller:
 * the tags it is attached to, the status a board shows it in (see
 * `displayStatus`), and for a recurring task the dates of its current
 * occurrence.
 */
export type FilterTask = {
  tagIds: readonly string[];
  projectId: string | null;
  statusId: string | null;
  priority: number;
  scheduledOn: string | null;
  dueOn: string | null;
  recurring: boolean;
};

export const FILTER_MAX_DEPTH = 8;
export const FILTER_MAX_NODES = 256;
const MAX_OFFSET_DAYS = 36_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): boolean =>
  typeof value === 'string' && UUID.test(value);

function rangeProblem(value: unknown, path: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${path}: not an object`;
  }
  for (const [key, bound] of Object.entries(value)) {
    if (key !== 'from' && key !== 'to') return `${path}: unknown key ${key}`;
    const offset =
      typeof bound === 'number' &&
      Number.isInteger(bound) &&
      Math.abs(bound) <= MAX_OFFSET_DAYS;
    if (!offset && !isIsoDate(bound)) {
      return `${path}.${key}: not a day offset or a YYYY-MM-DD date`;
    }
  }
  return null;
}

/**
 * Why `filter` is not a valid filter, or `null`. The server calls this on
 * every view write and clients before writing one, so a stored filter is
 * always one `matches` can evaluate. The node budget is checked as the walk
 * goes, so an enormous tree is refused without being walked.
 */
export function filterProblem(filter: unknown): string | null {
  let nodes = 0;
  const check = (node: unknown, depth: number, path: string): string | null => {
    if (depth > FILTER_MAX_DEPTH) {
      return `${path}: deeper than ${FILTER_MAX_DEPTH} levels`;
    }
    nodes += 1;
    if (nodes > FILTER_MAX_NODES) {
      return `more than ${FILTER_MAX_NODES} nodes`;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return `${path}: not an object`;
    }
    const keys = Object.keys(node);
    if (keys.length !== 1) return `${path}: needs exactly one key`;
    const key = keys[0] as string;
    const value = (node as Record<string, unknown>)[key];
    const at = `${path}.${key}`;
    switch (key) {
      case 'and':
      case 'or': {
        if (!Array.isArray(value)) return `${at}: not an array`;
        for (const [i, child] of value.entries()) {
          const problem = check(child, depth + 1, `${at}[${i}]`);
          if (problem !== null) return problem;
        }
        return null;
      }
      case 'not':
        return check(value, depth + 1, at);
      case 'tag':
      case 'status':
        return isUuid(value) ? null : `${at}: not a uuid`;
      case 'project':
        return value === null || isUuid(value)
          ? null
          : `${at}: not a uuid or null`;
      case 'priority':
        return Array.isArray(value) &&
          value.length > 0 &&
          Array.from(value).every(
            (p) => Number.isInteger(p) && p >= 0 && p <= 4,
          )
          ? null
          : `${at}: not a non-empty list of priorities 0-4`;
      case 'scheduled':
      case 'due':
        return rangeProblem(value, at);
      case 'recurring':
        return typeof value === 'boolean' ? null : `${at}: not a boolean`;
      default:
        return `${path}: unknown key ${key}`;
    }
  };
  return check(filter, 1, 'filter');
}

function inRange(
  date: string | null,
  range: DateRange,
  today: string,
): boolean {
  if (date === null) return false;
  const day = (bound: DateBound): string =>
    typeof bound === 'string' ? bound : addDays(today, bound);
  return (
    (range.from === undefined || date >= day(range.from)) &&
    (range.to === undefined || date <= day(range.to))
  );
}

/**
 * Whether `task` is in a view with `filter`, on the client's local `today`
 * (`YYYY-MM-DD`). `filter` must have passed `filterProblem`. `today` must be
 * a valid date: an invalid one makes `addDays` throw a RangeError, and there
 * is no guard because callers pass their own clock.
 */
export function matches(
  filter: Filter,
  task: FilterTask,
  today: string,
): boolean {
  if ('and' in filter) return filter.and.every((f) => matches(f, task, today));
  if ('or' in filter) return filter.or.some((f) => matches(f, task, today));
  if ('not' in filter) return !matches(filter.not, task, today);
  if ('tag' in filter) return task.tagIds.includes(filter.tag);
  if ('project' in filter) return task.projectId === filter.project;
  if ('status' in filter) return task.statusId === filter.status;
  if ('priority' in filter) return filter.priority.includes(task.priority);
  if ('scheduled' in filter) {
    return inRange(task.scheduledOn, filter.scheduled, today);
  }
  if ('due' in filter) return inRange(task.dueOn, filter.due, today);
  return task.recurring === filter.recurring;
}
