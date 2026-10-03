import { ruleProblem, type Rule } from '@todoer/client-core';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real date; empty clears (null); false when the
 *  text is not a date. */
export function parseDate(text: string): string | null | false {
  const t = text.trim();
  if (t === '') return null;
  if (!ISO.test(t)) return false;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t
    ? false
    : t;
}

/** Tags as the store keeps them, with their `@` (labels.ts). */
export function parseTags(text: string): string[] {
  const names = text
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((t) => (t.startsWith('@') ? t : `@${t}`));
  return [...new Set(names)];
}

export function parsePriority(text: string): number | 'invalid' {
  const t = text.trim().replace(/^p/, '');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 'invalid';
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export type Preset = {
  id: string;
  label: string;
  rule: (dtstart: string) => Rule | null;
};

/** The recurrence choices, weekday and day of month taken from `dtstart`. */
export function presets(dtstart: string): Preset[] {
  const d = new Date(`${dtstart}T00:00:00Z`);
  const day = d.getUTCDay();
  const date = d.getUTCDate();
  const r = (rrule: string) => (start: string) => ({ rrule, dtstart: start });
  return [
    { id: 'none', label: 'does not repeat', rule: () => null },
    { id: 'daily', label: 'daily', rule: r('FREQ=DAILY') },
    {
      id: 'weekdays',
      label: 'every weekday',
      rule: r('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'),
    },
    {
      id: 'weekly',
      label: `weekly on ${NAMES[day] ?? ''}`,
      rule: r(`FREQ=WEEKLY;BYDAY=${DAYS[day] ?? 'MO'}`),
    },
    {
      id: 'monthly',
      label: `monthly on day ${String(date)}`,
      rule: r(`FREQ=MONTHLY;BYMONTHDAY=${String(date)}`),
    },
  ];
}

/** A raw RRULE the core would take from `dtstart`, or why not. */
export function customRule(rrule: string, dtstart: string): Rule | string {
  const text = rrule.trim();
  return ruleProblem(text, dtstart) ?? { rrule: text, dtstart };
}

export function describeRule(rrule: string | null): string {
  if (rrule === null) return '—';
  if (rrule === 'FREQ=DAILY') return 'daily';
  const weekly = /^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/.exec(rrule);
  if (weekly?.[1] !== undefined) return `weekly · ${weekly[1]}`;
  const monthly = /^FREQ=MONTHLY;BYMONTHDAY=(\d+)$/.exec(rrule);
  if (monthly?.[1] !== undefined) return `monthly · day ${monthly[1]}`;
  return rrule;
}
