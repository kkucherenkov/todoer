import { ruleProblem, type Weekday } from '@todoer/client-core';
import { afterEach, describe, expect, it } from 'vitest';
import { blankPreset, presetOf, toRrule, type Preset } from './recurrence';

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
      expect(ruleProblem(toRrule(preset), '2026-10-05'), text).toBeNull();
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
