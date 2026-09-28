import { describe, expect, it } from 'vitest';
import { rowRejection } from './row-rules.js';

const recurring = {
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  dtstart: '2026-09-28',
  parentId: null,
};

describe('rowRejection', () => {
  it('accepts a valid recurring task and a plain one', () => {
    expect(rowRejection('task', recurring)).toBeNull();
    expect(rowRejection('task', { title: 'x' })).toBeNull();
    expect(rowRejection('task', { rrule: null, dtstart: null })).toBeNull();
  });

  it('accepts a dtstart stored as a Date', () => {
    expect(
      rowRejection('task', { ...recurring, dtstart: new Date('2026-09-28') }),
    ).toBeNull();
  });

  it('rejects a rule outside the subset, with the parser’s reason', () => {
    expect(
      rowRejection('task', { ...recurring, rrule: 'FREQ=DAILY;BYHOUR=9' }),
    ).toBe(
      'rrule: BYHOUR is not supported: v1 has dates, never times (ADR 0010)',
    );
    expect(rowRejection('task', { ...recurring, rrule: 42 })).toBe(
      'rrule must be a string',
    );
  });

  it('rejects a rule without dtstart', () => {
    expect(rowRejection('task', { ...recurring, dtstart: null })).toBe(
      'rrule requires dtstart',
    );
    expect(rowRejection('task', { rrule: 'FREQ=DAILY' })).toBe(
      'rrule requires dtstart',
    );
  });

  it('rejects a rule on a subtask', () => {
    expect(
      rowRejection('task', {
        ...recurring,
        parentId: '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      }),
    ).toBe('a subtask cannot carry an rrule (ADR 0009)');
  });

  it('checks a task occurrence’s state', () => {
    expect(rowRejection('task_occurrence', { state: 'done' })).toBeNull();
    expect(rowRejection('task_occurrence', {})).toBeNull();
    expect(rowRejection('task_occurrence', { state: 'finished' })).toBe(
      'state must be one of open, done, skipped',
    );
  });

  it('has nothing to say about other tables', () => {
    expect(rowRejection('project', { rrule: 'nonsense' })).toBeNull();
  });
});
