import type { Item, Placement, Span, Write } from '@todoer/client-core';
import type { Draft } from '../db/client';

export type Mode = 'week' | 'month';

/** The write a move minted: its `id` is the copy undoMove deletes. */
type Minted = Extract<Write, { kind: 'moveOccurrence' }>;

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A calendar date has no zone (ADR 0010): everything below is UTC arithmetic
// on epoch days, never a local `Date`.
const epoch = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const parts = (date: string) =>
  date.split('-').map(Number) as [number, number, number];

function real(value: unknown): value is string {
  return (
    typeof value === 'string' && ISO.test(value) && iso(epoch(value)) === value
  );
}

/** 0 = Monday … 6 = Sunday (departure 7). UTC: a date has no zone. */
export function weekday(date: string): number {
  return (new Date(epoch(date)).getUTCDay() + 6) % 7;
}

const monday = (date: string): string => iso(epoch(date) - weekday(date) * DAY);

/** The days a grid shows: Monday to Sunday of `at`'s week, or every week
 *  that holds a day of `at`'s month (28 to 42 days). */
export function gridSpan(mode: Mode, at: string): Span {
  if (mode === 'week') {
    const from = monday(at);
    return { from, to: iso(epoch(from) + 6 * DAY) };
  }
  const [y, m] = parts(at);
  const first = iso(Date.UTC(y, m - 1, 1));
  const last = iso(Date.UTC(y, m, 0));
  return {
    from: monday(first),
    to: iso(epoch(monday(last)) + 6 * DAY),
  };
}

/** Every date of a span, in order. */
export function days(span: Span): string[] {
  const out: string[] = [];
  for (let t = epoch(span.from); t <= epoch(span.to); t += DAY)
    out.push(iso(t));
  return out;
}

/** `at` moved by `n` weeks or months; a month move lands on the 1st. */
export function shift(mode: Mode, at: string, n: number): string {
  if (mode === 'week') return iso(epoch(at) + n * 7 * DAY);
  const [y, m] = parts(at);
  return iso(Date.UTC(y, m - 1 + n, 1));
}

/** The `?mode=&at=` query read back; anything invalid falls back to
 *  week mode at `today`. */
export function fromQuery(
  query: Record<string, unknown>,
  today: string,
): { mode: Mode; at: string } {
  const { mode, at } = query;
  return (mode === 'week' || mode === 'month') && real(at)
    ? { mode, at }
    : { mode: 'week', at: today };
}

/** The write a placement dropped on `to` sends, and the write that undoes
 *  it (departure 6). A recurring scheduled placement moves its occurrence;
 *  any other sets its own date. null when `to` is the placement's day. */
export function placeWrite(
  p: Placement,
  task: Item,
  to: string,
): { write: Draft; undo: (minted: Minted) => Draft } | null {
  if (to === p.date) return null;
  const taskId = String(task.id);
  if (p.occurrence !== null) {
    return {
      write: {
        kind: 'moveOccurrence',
        taskId: taskId,
        occurrence: p.occurrence,
        to,
      },
      undo: (minted) => ({ kind: 'undoMove', taskId: minted.id }),
    };
  }
  const field = p.kind === 'due' ? 'dueOn' : 'scheduledOn';
  return {
    write: { kind: 'edit', taskId: taskId, changes: { [field]: to } },
    undo: () => ({
      kind: 'edit',
      taskId: taskId,
      changes: { [field]: p.date },
    }),
  };
}
