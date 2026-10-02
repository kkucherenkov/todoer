import { ruleProblem, type Weekday } from '@todoer/client-core';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRrule } from '@todoer/client-core';
import {
  blankPreset,
  presetOf,
  reasonKey,
  toRrule,
  type Preset,
} from './recurrence';

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const cases: Array<[Preset, string]> = [
  [{ freq: 'DAILY', interval: 1, byDay: [] }, 'FREQ=DAILY'],
  [
    { freq: 'WEEKLY', interval: 2, byDay: ['MO', 'WE'] },
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
  ],
  [{ freq: 'MONTHLY', interval: 3, byDay: [] }, 'FREQ=MONTHLY;INTERVAL=3'],
  [{ freq: 'YEARLY', interval: 1, byDay: [] }, 'FREQ=YEARLY'],
];

describe('toRrule', () => {
  it('writes the canonical text', () => {
    for (const [preset, text] of cases) expect(toRrule(preset)).toBe(text);
  });

  it('orders BYDAY by WEEKDAYS', () => {
    const byDay: Weekday[] = ['WE', 'MO'];
    expect(toRrule({ freq: 'WEEKLY', interval: 2, byDay })).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    );
  });

  it('writes no BYDAY outside WEEKLY', () => {
    expect(toRrule({ freq: 'DAILY', interval: 1, byDay: ['MO'] })).toBe(
      'FREQ=DAILY',
    );
  });

  it('is accepted by ruleProblem when it has a weekday', () => {
    for (const [preset, text] of cases)
      expect(ruleProblem(toRrule(preset) ?? '', '2026-10-05'), text).toBeNull();
  });
});

describe('toRrule interval', () => {
  it.each([null, 0, -1, 1.5, Number.NaN])('refuses %s', (interval) => {
    expect(toRrule({ freq: 'DAILY', interval, byDay: [] })).toBeNull();
  });
});

describe('reasonKey', () => {
  it.each([
    ['FREQ is required', 'freqRequired', {}],
    ['FREQ=HOURLY is not supported', 'freqUnsupported', { value: 'HOURLY' }],
    ['INTERVAL must be a positive integer', 'positive', { key: 'INTERVAL' }],
    ['BYDAY: "XX" is not a weekday', 'notWeekday', { item: 'XX' }],
    [
      'BYMONTHDAY: "0" is out of range',
      'outOfRange',
      { key: 'BYMONTHDAY', item: '0' },
    ],
    ['the start must be a date, YYYY-MM-DD', 'startDate', {}],
    [
      'this rule produces no date from 2026-10-05',
      'noDate',
      { date: '2026-10-05' },
    ],
  ])('maps "%s"', (reason, key, params) => {
    expect(reasonKey(reason)).toEqual({
      key: `recurrence.problem.${key}`,
      params,
    });
  });

  it('maps every reason the parser and ruleProblem give', () => {
    const texts = [
      'x',
      'BYHOUR=1',
      'FOO=1',
      'FREQ=DAILY;FREQ=DAILY',
      'INTERVAL=2',
      'FREQ=HOURLY',
      'FREQ=DAILY;COUNT=0',
      'FREQ=DAILY;BYMONTH=13',
      'FREQ=DAILY;BYDAY=XX',
      'FREQ=DAILY;BYDAY=0MO',
      'FREQ=DAILY;BYDAY=1MO',
      'FREQ=DAILY;UNTIL=2026',
      'FREQ=DAILY;WKST=XX',
      'FREQ=DAILY;COUNT=1;UNTIL=20261001',
      'FREQ=WEEKLY;BYMONTHDAY=1',
      'FREQ=MONTHLY;BYSETPOS=1',
    ];
    for (const text of texts) {
      const parsed = parseRrule(text);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok)
        expect(reasonKey(parsed.error), parsed.error).not.toBeNull();
    }
    for (const [text, start] of [
      ['FREQ=DAILY', '2026-02-30'],
      ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-10-05'],
    ] as const) {
      const problem = ruleProblem(text, start);
      expect(reasonKey(problem ?? ''), String(problem)).not.toBeNull();
    }
  });

  it('leaves an unknown reason to the caller', () => {
    expect(reasonKey('something new')).toBeNull();
  });
});

describe('presetOf', () => {
  it('round-trips the canonical presets', () => {
    for (const [preset, text] of cases) expect(presetOf(text)).toEqual(preset);
  });

  it.each([
    'FREQ=WEEKLY',
    'FREQ=WEEKLY;BYDAY=WE,MO',
    'FREQ=DAILY;INTERVAL=1',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=MONTHLY;BYDAY=1MO',
    'FREQ=DAILY;COUNT=5',
    'FREQ=WEEKLY;BYDAY=MO;WKST=SU',
    'FREQ=HOURLY',
  ])('leaves %s to the raw field', (text) => {
    expect(presetOf(text)).toBeNull();
  });
});

describe('blankPreset', () => {
  it.each(['Pacific/Kiritimati', 'America/Adak'])(
    "takes the start date's weekday in UTC under %s",
    (tz) => {
      process.env.TZ = tz;
      expect(blankPreset('2026-10-04').byDay).toEqual(['SU']);
    },
  );
});
