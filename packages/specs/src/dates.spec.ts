import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate } from './dates';

describe('isIsoDate', () => {
  it.each(['2026-09-28', '2024-02-29', '1997-08-05'])('accepts %s', (d) => {
    expect(isIsoDate(d)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-9-28',
    '2026-09-28T00:00:00Z',
    '20260928',
    '',
    null,
    20260928,
  ])('refuses %s', (d) => {
    expect(isIsoDate(d)).toBe(false);
  });
});

describe('addDays', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-10-01', 0, '2026-10-01'],
    ['2026-10-01', -365, '2025-10-01'],
  ])('%s %+d → %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});
