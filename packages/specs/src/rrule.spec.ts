import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRrule } from './rrule';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/rrule.json', import.meta.url), 'utf8'),
) as { cases: Array<{ name: string; rrule: string }> };

describe('parseRrule', () => {
  it.each(vectors.cases)('parses the vector "$name"', ({ rrule }) => {
    expect(parseRrule(rrule)).toMatchObject({ ok: true });
  });

  it('reads ordinals, defaults and UNTIL', () => {
    expect(parseRrule('FREQ=MONTHLY;BYDAY=-1FR,MO;UNTIL=20261231')).toEqual({
      ok: true,
      rule: {
        freq: 'MONTHLY',
        interval: 1,
        byDay: [
          { n: -1, day: 'FR' },
          { n: null, day: 'MO' },
        ],
        byMonthDay: null,
        byMonth: null,
        bySetPos: null,
        count: null,
        until: '2026-12-31',
        wkst: 'MO',
      },
    });
  });

  it.each([
    ['', 'malformed part'],
    ['FREQ=DAILY;', 'malformed part'],
    ['INTERVAL=2', 'FREQ is required'],
    ['FREQ=HOURLY', 'FREQ=HOURLY is not supported'],
    ['FREQ=DAILY;BYHOUR=9', 'never times'],
    ['FREQ=DAILY;BYMINUTE=0', 'never times'],
    ['freq=daily', 'freq is not supported'],
    ['FREQ=DAILY;RDATE=20261001', 'RDATE is not supported'],
    ['FREQ=DAILY;FREQ=WEEKLY', 'appears twice'],
    ['FREQ=DAILY;INTERVAL=0', 'positive integer'],
    ['FREQ=DAILY;COUNT=3;UNTIL=20261231', 'COUNT and UNTIL'],
    ['FREQ=DAILY;UNTIL=20261231T000000Z', 'UNTIL must be a date'],
    ['FREQ=DAILY;UNTIL=20260230', 'UNTIL must be a date'],
    ['FREQ=WEEKLY;BYMONTHDAY=1', 'FREQ=WEEKLY'],
    ['FREQ=WEEKLY;BYDAY=1MO', 'ordinal'],
    ['FREQ=MONTHLY;BYDAY=0MO', 'out of range'],
    ['FREQ=MONTHLY;BYDAY=MON', 'not a weekday'],
    ['FREQ=MONTHLY;BYMONTHDAY=0', 'out of range'],
    ['FREQ=MONTHLY;BYMONTHDAY=1.5', 'out of range'],
    ['FREQ=YEARLY;BYMONTH=13', 'out of range'],
    ['FREQ=YEARLY;BYMONTH=+2', 'out of range'],
    ['FREQ=DAILY;BYSETPOS=1', 'another BY part'],
    ['FREQ=DAILY;WKST=XX', 'not a weekday'],
  ])('refuses %j', (text, reason) => {
    const parsed = parseRrule(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).toContain(reason);
  });
});
