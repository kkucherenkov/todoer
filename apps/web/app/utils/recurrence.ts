import { parseRrule, WEEKDAYS, type Weekday } from '@todoer/client-core';
import { weekday } from './calendar';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type Preset = { freq: Freq; interval: number; byDay: Weekday[] };

/** Canonical text: FREQ, INTERVAL only when > 1, BYDAY only for WEEKLY and
 *  in WEEKDAYS order. Weekly with no day gives `FREQ=WEEKLY…` with no BYDAY;
 *  the form never sends that (FR-010). */
export function toRrule(p: Preset): string {
  const out = [`FREQ=${p.freq}`];
  if (p.interval > 1) out.push(`INTERVAL=${p.interval}`);
  if (p.freq === 'WEEKLY' && p.byDay.length > 0)
    out.push(`BYDAY=${WEEKDAYS.filter((d) => p.byDay.includes(d)).join(',')}`);
  return out.join(';');
}

/** The preset that writes exactly `rrule`, or null (raw mode): unparseable,
 *  a part beyond FREQ/INTERVAL/BYDAY, BYDAY outside WEEKLY or with an
 *  ordinal, Weekly without BYDAY, or text that is not toRrule's own. */
export function presetOf(rrule: string): Preset | null {
  const parsed = parseRrule(rrule);
  if (!parsed.ok) return null;
  const { freq, interval, byDay } = parsed.rule;
  if (byDay?.some((d) => d.n !== null)) return null;
  if (freq === 'WEEKLY' && byDay === null) return null;
  const preset: Preset = {
    freq,
    interval,
    byDay: byDay?.map((d) => d.day) ?? [],
  };
  return toRrule(preset) === rrule ? preset : null;
}

/** Daily, every 1, with the start date's weekday ready for Weekly. */
export function blankPreset(dtstart: string): Preset {
  return {
    freq: 'DAILY',
    interval: 1,
    byDay: [WEEKDAYS[weekday(dtstart)] as Weekday],
  };
}
