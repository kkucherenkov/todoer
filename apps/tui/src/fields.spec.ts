import { describe, expect, it } from 'vitest';
import {
  customRule,
  describeRule,
  parseDate,
  parsePriority,
  parseTags,
  presets,
} from './fields.js';

describe('parseDate', () => {
  it('takes YYYY-MM-DD, clears on empty, refuses the rest', () => {
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('  ')).toBeNull();
    expect(parseDate('2026-13-01')).toBe(false);
    expect(parseDate('2026-02-30')).toBe(false);
    expect(parseDate('tomorrow')).toBe(false);
  });
});

describe('parseTags', () => {
  it('adds the @ the store keeps, drops duplicates', () => {
    expect(parseTags('@a b  @a')).toEqual(['@a', '@b']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('parsePriority', () => {
  it('takes 0-4 with or without p', () => {
    expect(parsePriority('p2')).toBe(2);
    expect(parsePriority('3')).toBe(3);
    expect(parsePriority('')).toBe(0);
    expect(parsePriority('p7')).toBe('invalid');
  });
});

describe('presets', () => {
  // 2026-10-05 is a Monday.
  const all = presets('2026-10-05');
  const rule = (id: string) => all.find((p) => p.id === id)?.rule('2026-10-05');
  it('builds each rule from dtstart', () => {
    expect(rule('none')).toBeNull();
    expect(rule('daily')).toEqual({
      rrule: 'FREQ=DAILY',
      dtstart: '2026-10-05',
    });
    expect(rule('weekdays')?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(rule('weekly')?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(rule('monthly')?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=5');
  });
  it('labels name the day', () => {
    expect(all.find((p) => p.id === 'weekly')?.label).toMatch(/Mon/);
  });
});

describe('customRule', () => {
  it('accepts what the core accepts, explains what it does not', () => {
    expect(customRule(' FREQ=WEEKLY;INTERVAL=2 ', '2026-10-05')).toEqual({
      rrule: 'FREQ=WEEKLY;INTERVAL=2',
      dtstart: '2026-10-05',
    });
    expect(typeof customRule('FREQ=SOMETIMES', '2026-10-05')).toBe('string');
  });
});

describe('describeRule', () => {
  it('reads common rules back', () => {
    expect(describeRule(null)).toBe('—');
    expect(describeRule('FREQ=DAILY')).toBe('daily');
    expect(describeRule('FREQ=WEEKLY;BYDAY=MO')).toBe('weekly · MO');
    expect(describeRule('FREQ=MONTHLY;BYMONTHDAY=5')).toBe('monthly · day 5');
    expect(describeRule('FREQ=YEARLY')).toBe('FREQ=YEARLY');
  });
});
