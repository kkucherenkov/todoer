import { describe, expect, it } from 'vitest';
import { isIsoDate } from './dates';

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
