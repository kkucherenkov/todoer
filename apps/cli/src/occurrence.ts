import { parseRrule, type Rrule } from '@todoer/specs';
import { expand } from './expand.js';
import type { Row } from './store.js';

const DAY_MS = 86_400_000;
/** How far ahead the next open occurrence is looked for; also how far ahead
 *  `add --rrule` checks for a rule producing nothing at all (M5). */
// ponytail: ten years; a rule sparser than that shows as ended.
export const HORIZON_DAYS = 3660;
/** How many upcoming occurrences are checked for one that is still open. */
const LOOKAHEAD = 100;
const CLOSED: ReadonlySet<unknown> = new Set(['done', 'skipped']);

/** The caller's calendar date, `YYYY-MM-DD` — local, not UTC (ADR 0010). */
export function localDate(now: Date): string {
  const pad = (n: number, width: number): string =>
    String(n).padStart(width, '0');
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export type Recurrence = { rule: Rrule; dtstart: string };

/**
 * A task's rule and anchor — its own, or its parent's for a subtask, which
 * lives on the parent's occurrence axis (ADR 0009). `null` for a one-off
 * task. The server refuses a rule it cannot parse (plan C2), so one arriving
 * here is a bug worth failing loudly on, not a task to show wrongly.
 */
export function recurrenceOf(
  task: Row,
  parent: Row | undefined,
): Recurrence | null {
  const isSubtask = task.parentId !== null && task.parentId !== undefined;
  const owner = isSubtask && parent !== undefined ? parent : task;
  const { rrule, dtstart } = owner;
  if (rrule === null || rrule === undefined) return null;
  if (typeof rrule !== 'string' || typeof dtstart !== 'string') {
    throw new Error(
      `task ${String(owner.id)} has a rule without a readable dtstart`,
    );
  }
  const parsed = parseRrule(rrule);
  if (!parsed.ok) {
    throw new Error(
      `task ${String(owner.id)} has a rule this client cannot expand: ${parsed.error}`,
    );
  }
  return { rule: parsed.rule, dtstart };
}

/** A task occurrence's `state` for one date (`null`: a one-off task), or
 *  `undefined` when there is no row. */
export type StateOf = (occurrence: string | null) => unknown;

/**
 * The occurrence `list` shows and `done`/`skip` act on (plan C design, Q11):
 * the latest one on or before today while it is open, otherwise the first
 * open one after today (plan C1, departure 2). `null` when there is none — a
 * one-off task done or skipped, or a rule that has run out.
 */
export function currentOccurrence(
  recurrence: Recurrence | null,
  stateOf: StateOf,
  today: string,
): { occurrence: string | null } | null {
  if (recurrence === null) {
    return CLOSED.has(stateOf(null)) ? null : { occurrence: null };
  }
  const { rule, dtstart } = recurrence;
  const latest = expand(rule, dtstart, dtstart, today).at(-1);
  if (latest !== undefined && !CLOSED.has(stateOf(latest))) {
    return { occurrence: latest };
  }
  const next = expand(
    rule,
    dtstart,
    addDays(today, 1),
    addDays(today, HORIZON_DAYS),
    LOOKAHEAD,
  ).find((occurrence) => !CLOSED.has(stateOf(occurrence)));
  return next === undefined ? null : { occurrence: next };
}

/** Whether the rule produces `date` — what `--on` must name. */
export function isOccurrence(recurrence: Recurrence, date: string): boolean {
  return expand(recurrence.rule, recurrence.dtstart, date, date).length === 1;
}

/**
 * What a plain `undo` reopens: the task's latest done or skipped occurrence
 * by date (plan C1, departure 1). Read from `state` alone — a `completedAt`
 * can outlive the state that set it under per-field LWW ("Notes for C1").
 */
export function latestClosed(
  occurrences: Row[],
  taskId: string,
): { occurrence: string | null } | null {
  const closed = occurrences
    .filter((row) => row.taskId === taskId && CLOSED.has(row.state))
    .map((row) => (typeof row.occurrence === 'string' ? row.occurrence : null))
    .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const last = closed.at(-1);
  return last === undefined ? null : { occurrence: last };
}
