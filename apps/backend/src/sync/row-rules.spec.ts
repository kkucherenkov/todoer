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

const view = {
  name: 'Today',
  layout: 'list',
  sort: 'due',
  rank: 'a0',
  filter: { due: { from: 0, to: 0 } },
};

describe('view rows', () => {
  it('accepts a valid view', () => {
    expect(rowRejection('view', view)).toBeNull();
  });
  it.each([
    [{ ...view, name: '' }, 'name must be a non-empty string'],
    [{ ...view, name: undefined }, 'name must be a non-empty string'],
    [
      { ...view, layout: 'grid' },
      'layout must be one of list, kanban, calendar',
    ],
    [
      { ...view, sort: 'title' },
      'sort must be one of manual, priority, due, scheduled',
    ],
    [{ ...view, rank: 3 }, 'rank must be a string'],
    [{ ...view, filter: { tag: 'x' } }, 'filter: filter.tag: not a uuid'],
    [{ ...view, filter: undefined }, 'filter: filter: not an object'],
  ])('rejects %o', (row, reason) => {
    expect(rowRejection('view', row)).toBe(reason);
  });
});

describe('status rows', () => {
  const status = { name: 'Doing', rank: 'a1', completing: false, color: null };
  it('accepts a valid status, with or without completing', () => {
    expect(rowRejection('status', status)).toBeNull();
    expect(rowRejection('status', { name: 'Doing', rank: 'a1' })).toBeNull();
  });
  it.each([
    [{ ...status, name: ' ' }, 'name must be a non-empty string'],
    [{ ...status, rank: null }, 'rank must be a string'],
    [{ ...status, completing: 'yes' }, 'completing must be a boolean'],
    [{ ...status, color: 7 }, 'color must be a string or null'],
  ])('rejects %o', (row, reason) => {
    expect(rowRejection('status', row)).toBe(reason);
  });
});

describe('task origin', () => {
  const ORIGIN = '018f0000-0000-7000-8000-000000000001';
  it('accepts both or neither', () => {
    expect(
      rowRejection('task', {
        originTaskId: ORIGIN,
        originOccurrence: '2026-10-05',
      }),
    ).toBeNull();
    expect(
      rowRejection('task', { originTaskId: null, originOccurrence: null }),
    ).toBeNull();
  });
  it('rejects one without the other, also on a recurring task', () => {
    const reason = 'originTaskId and originOccurrence are set together';
    expect(rowRejection('task', { originTaskId: ORIGIN })).toBe(reason);
    expect(
      rowRejection('task', { ...recurring, originOccurrence: '2026-10-05' }),
    ).toBe(reason);
  });
});
