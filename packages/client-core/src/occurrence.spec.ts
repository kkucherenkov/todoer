import { describe, expect, it } from 'vitest';
import {
  currentOccurrence,
  isOccurrence,
  latestClosed,
  localDate,
  recurrenceOf,
  type Recurrence,
  type StateOf,
} from './occurrence.js';

function recurring(rrule: string, dtstart: string): Recurrence {
  const recurrence = recurrenceOf({ id: 't', rrule, dtstart }, undefined);
  if (recurrence === null) throw new Error('expected a recurrence');
  return recurrence;
}

const nothing: StateOf = () => undefined;
const closedOn =
  (...dates: string[]): StateOf =>
  (occurrence) =>
    occurrence !== null && dates.includes(occurrence) ? 'done' : undefined;

describe('localDate', () => {
  it('is the local calendar date', () => {
    expect(localDate(new Date(2026, 8, 28, 23, 59))).toBe('2026-09-28');
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  // I1: vitest pins TZ=UTC, so getUTC* would pass here just as well as the
  // local getters do — only a runtime change of TZ tells them apart.
  it('is the local date, not UTC, under a real offset', () => {
    try {
      process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
      expect(localDate(new Date('2026-09-26T12:00:00Z'))).toBe('2026-09-27');
      process.env.TZ = 'Pacific/Pago_Pago'; // UTC-11
      expect(localDate(new Date('2026-09-26T05:00:00Z'))).toBe('2026-09-25');
    } finally {
      process.env.TZ = 'UTC';
    }
  });
});

describe('recurrenceOf', () => {
  it('is null for a task without a rule', () => {
    expect(recurrenceOf({ id: 't', rrule: null }, undefined)).toBeNull();
  });

  it("uses a subtask's parent rule (ADR 0009)", () => {
    const parent = { id: 'p', rrule: 'FREQ=DAILY', dtstart: '2026-09-01' };
    expect(recurrenceOf({ id: 's', parentId: 'p' }, parent)?.dtstart).toBe(
      '2026-09-01',
    );
  });

  it('refuses a rule it cannot expand', () => {
    expect(() =>
      recurrenceOf(
        { id: 't', rrule: 'FREQ=HOURLY', dtstart: '2026-09-01' },
        undefined,
      ),
    ).toThrow(/cannot expand/);
  });
});

describe('currentOccurrence', () => {
  const daily = recurring('FREQ=DAILY', '2026-09-01');

  // Review Focus 3.
  it('collapses missed days into today', () => {
    expect(currentOccurrence(daily, nothing, '2026-09-28')).toEqual({
      occurrence: '2026-09-28',
    });
  });

  it('moves on once today is closed', () => {
    expect(
      currentOccurrence(daily, closedOn('2026-09-28'), '2026-09-28'),
    ).toEqual({
      occurrence: '2026-09-29',
    });
  });

  it('skips a future occurrence already closed in advance', () => {
    expect(
      currentOccurrence(
        daily,
        closedOn('2026-09-28', '2026-09-29'),
        '2026-09-28',
      ),
    ).toEqual({ occurrence: '2026-09-30' });
  });

  it('is the first occurrence when today is before dtstart', () => {
    expect(
      currentOccurrence(
        recurring('FREQ=WEEKLY;BYDAY=MO', '2026-10-05'),
        nothing,
        '2026-09-28',
      ),
    ).toEqual({ occurrence: '2026-10-05' });
  });

  // Review Focus 5.
  it('is null when a rule has ended and its last occurrence is closed', () => {
    const twice = recurring('FREQ=DAILY;COUNT=2', '2026-09-01');
    expect(
      currentOccurrence(twice, closedOn('2026-09-02'), '2026-09-28'),
    ).toBeNull();
    expect(currentOccurrence(twice, nothing, '2026-09-28')).toEqual({
      occurrence: '2026-09-02',
    });
  });

  it('is null when UNTIL has passed and its last occurrence is closed, and current there while open', () => {
    const ended = recurring('FREQ=DAILY;UNTIL=20260905', '2026-09-01');
    expect(
      currentOccurrence(ended, closedOn('2026-09-05'), '2026-09-28'),
    ).toBeNull();
    expect(currentOccurrence(ended, nothing, '2026-09-28')).toEqual({
      occurrence: '2026-09-05',
    });
  });

  it('treats a one-off task as current until it is done or skipped', () => {
    expect(currentOccurrence(null, nothing, '2026-09-28')).toEqual({
      occurrence: null,
    });
    expect(currentOccurrence(null, () => 'open', '2026-09-28')).toEqual({
      occurrence: null,
    });
    expect(currentOccurrence(null, () => 'done', '2026-09-28')).toBeNull();
    expect(currentOccurrence(null, () => 'skipped', '2026-09-28')).toBeNull();
  });
});

describe('isOccurrence', () => {
  it('is true only for a date the rule produces', () => {
    const mondays = recurring('FREQ=WEEKLY;BYDAY=MO', '2026-09-28');
    expect(isOccurrence(mondays, '2026-10-05')).toBe(true);
    expect(isOccurrence(mondays, '2026-10-06')).toBe(false);
  });
});

describe('latestClosed', () => {
  it("is the task's latest done or skipped occurrence, by date", () => {
    const rows = [
      { taskId: 't', occurrence: '2026-09-03', state: 'skipped' },
      { taskId: 't', occurrence: '2026-09-05', state: 'open' },
      { taskId: 't', occurrence: '2026-09-02', state: 'done' },
      { taskId: 'u', occurrence: '2026-09-09', state: 'done' },
    ];
    expect(latestClosed(rows, 't')).toEqual({ occurrence: '2026-09-03' });
  });

  it('is null occurrence for a done one-off task, and null when nothing is closed', () => {
    expect(
      latestClosed([{ taskId: 't', occurrence: null, state: 'done' }], 't'),
    ).toEqual({
      occurrence: null,
    });
    expect(
      latestClosed([{ taskId: 't', occurrence: null, state: 'open' }], 't'),
    ).toBeNull();
  });

  // "Notes for C1": completedAt says nothing on its own.
  it('reads state, not completedAt', () => {
    expect(
      latestClosed(
        [
          {
            taskId: 't',
            occurrence: null,
            state: 'open',
            completedAt: '2026-09-28T08:00:00Z',
          },
        ],
        't',
      ),
    ).toBeNull();
  });
});
