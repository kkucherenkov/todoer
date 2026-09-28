import { WEEKDAYS, type Rrule, type Weekday } from '@todoer/specs';

const DAY_MS = 86_400_000;

/** Days since 1970-01-01, UTC. A date is a whole number of days (ADR 0010). */
function toDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`) / DAY_MS;
}

function toIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function parts(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday, the order of WEEKDAYS. */
function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function weekdayIndex(day: Weekday): number {
  return WEEKDAYS.indexOf(day);
}

/** Month day `n` of a month with `dim` days: negative counts from the end. */
function monthDay(n: number, dim: number): number {
  return n > 0 ? n : dim + n + 1;
}

type Scope = { first: number; last: number };

/**
 * Whether `day` matches a BYDAY entry. An ordinal counts within `scope` —
 * the month, or the whole year for YEARLY without BYMONTH (RFC 5545
 * §3.3.10) — from the end when negative.
 */
function matchesByDay(
  day: number,
  byDay: NonNullable<Rrule['byDay']>,
  scope: Scope,
): boolean {
  const wd = weekday(day);
  return byDay.some(({ n, day: name }) => {
    if (weekdayIndex(name) !== wd) return false;
    if (n === null) return true;
    return n > 0
      ? Math.floor((day - scope.first) / 7) + 1 === n
      : -(Math.floor((scope.last - day) / 7) + 1) === n;
  });
}

/** One month's candidate days, for MONTHLY and YEARLY. */
function monthCandidates(
  y: number,
  m: number,
  rule: Rrule,
  startDom: number,
  yearScope: Scope | null,
): number[] {
  const dim = daysInMonth(y, m);
  const doms =
    rule.byMonthDay !== null
      ? rule.byMonthDay.map((n) => monthDay(n, dim))
      : rule.byDay !== null
        ? Array.from({ length: dim }, (_, i) => i + 1)
        : [startDom];
  const scope = yearScope ?? { first: dayOf(y, m, 1), last: dayOf(y, m, dim) };
  return [...new Set(doms)]
    .filter((d) => d >= 1 && d <= dim)
    .sort((a, b) => a - b)
    .map((d) => dayOf(y, m, d))
    .filter(
      (day) => rule.byDay === null || matchesByDay(day, rule.byDay, scope),
    );
}

/** Period `k` of the rule: its first day, and its candidate days, sorted. */
function period(
  rule: Rrule,
  start: number,
  k: number,
): { first: number; days: number[] } {
  const s = parts(start);
  const inMonths = (day: number): boolean =>
    rule.byMonth === null || rule.byMonth.includes(parts(day).m);

  if (rule.freq === 'DAILY') {
    const day = start + k * rule.interval;
    const { y, m, d } = parts(day);
    const ok =
      inMonths(day) &&
      (rule.byMonthDay === null ||
        rule.byMonthDay.some((n) => monthDay(n, daysInMonth(y, m)) === d)) &&
      (rule.byDay === null ||
        rule.byDay.some(
          ({ day: name }) => weekdayIndex(name) === weekday(day),
        ));
    return { first: day, days: ok ? [day] : [] };
  }
  if (rule.freq === 'WEEKLY') {
    const first =
      start -
      ((weekday(start) - weekdayIndex(rule.wkst) + 7) % 7) +
      7 * rule.interval * k;
    const wanted =
      rule.byDay === null
        ? [weekday(start)]
        : rule.byDay.map(({ day }) => weekdayIndex(day));
    // Days before dtstart are not candidates at all, so BYSETPOS never counts
    // them — python-dateutil's reading, which the vectors follow; RFC 5545 is
    // silent. MONTHLY and YEARLY do count them, and drop them afterwards.
    const days = Array.from({ length: 7 }, (_, i) => first + i).filter(
      (day) => day >= start && wanted.includes(weekday(day)) && inMonths(day),
    );
    return { first, days };
  }
  if (rule.freq === 'MONTHLY') {
    const index = s.y * 12 + (s.m - 1) + k * rule.interval;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const days =
      rule.byMonth === null || rule.byMonth.includes(m)
        ? monthCandidates(y, m, rule, s.d, null)
        : [];
    return { first: dayOf(y, m, 1), days };
  }
  const y = s.y + k * rule.interval;
  const months =
    rule.byMonth !== null
      ? [...new Set(rule.byMonth)].sort((a, b) => a - b)
      : rule.byMonthDay !== null || rule.byDay !== null
        ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        : [s.m];
  const yearScope =
    rule.byMonth === null
      ? { first: dayOf(y, 1, 1), last: dayOf(y, 12, 31) }
      : null;
  const days = months.flatMap((m) =>
    monthCandidates(y, m, rule, s.d, yearScope),
  );
  return { first: dayOf(y, 1, 1), days };
}

/** BYSETPOS: the positions kept from one period's sorted set, 1-based, or
 *  from the end when negative. */
function atPositions(days: number[], positions: number[]): number[] {
  const kept = new Set<number>();
  for (const p of positions) {
    const day = days[p > 0 ? p - 1 : days.length + p];
    if (day !== undefined) kept.add(day);
  }
  return [...kept].sort((a, b) => a - b);
}

/**
 * Every occurrence of `rule` anchored at `dtstart` that falls in
 * [`from`, `to`], both inclusive, as `YYYY-MM-DD` (domain design §4), at
 * most `limit` of them.
 *
 * COUNT counts from dtstart, not from the window, and a dtstart the rule does
 * not produce is not an occurrence — both as `vectors/rrule.json` pins them.
 * Terminates for any rule, including one that never matches (BYMONTH=2;
 * BYMONTHDAY=31): periods only move forward, and the loop stops at the first
 * period that starts after the window or UNTIL.
 */
// ponytail: walks every period from dtstart, so a daily rule anchored decades
// back costs ~10k iterations per call. Skip ahead to the window when a rule
// has no COUNT if `list` ever feels it.
export function expand(
  rule: Rrule,
  dtstart: string,
  from: string,
  to: string,
  limit = Infinity,
): string[] {
  const start = toDay(dtstart);
  const lo = toDay(from);
  const hi = Math.min(
    toDay(to),
    rule.until === null ? Infinity : toDay(rule.until),
  );
  const out: string[] = [];
  let count = 0;
  for (let k = 0; ; k++) {
    const { first, days } = period(rule, start, k);
    if (first > hi) return out;
    const kept =
      rule.bySetPos === null ? days : atPositions(days, rule.bySetPos);
    for (const day of kept) {
      if (day < start) continue;
      if (day > hi) return out;
      count++;
      if (rule.count !== null && count > rule.count) return out;
      if (day >= lo) {
        out.push(toIso(day));
        if (out.length >= limit) return out;
      }
    }
  }
}
