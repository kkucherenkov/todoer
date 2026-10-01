import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseRrule, type Rrule } from '@todoer/specs';
import { expand } from './expand.js';

type Vector = {
  name: string;
  rrule: string;
  dtstart: string;
  window: { from: string; to: string };
  expected: string[];
};

const vectors = JSON.parse(
  readFileSync(
    createRequire(import.meta.url).resolve('@todoer/specs/vectors/rrule.json'),
    'utf8',
  ),
) as { cases: Vector[] };

function rule(text: string): Rrule {
  const parsed = parseRrule(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.rule;
}

describe('expand', () => {
  it.each(vectors.cases)('matches the vector "$name"', (v) => {
    expect(
      expand(rule(v.rrule), v.dtstart, v.window.from, v.window.to),
    ).toEqual(v.expected);
  });

  it('terminates on a rule that never matches', () => {
    expect(
      expand(
        rule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=31'),
        '2026-01-01',
        '2026-01-01',
        '2126-01-01',
      ),
    ).toEqual([]);
  });

  it('stops after limit occurrences', () => {
    expect(
      expand(rule('FREQ=DAILY'), '2026-09-01', '2026-09-10', '2026-12-31', 2),
    ).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('returns nothing for a window that ends before dtstart', () => {
    expect(
      expand(rule('FREQ=WEEKLY'), '2026-10-05', '2026-09-01', '2026-10-04'),
    ).toEqual([]);
  });
});
