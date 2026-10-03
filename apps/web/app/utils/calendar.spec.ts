import { MAX_SPAN_DAYS, type Item, type Placement } from '@todoer/client-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  days,
  fromQuery,
  gridSpan,
  placeWrite,
  shift,
  weekday,
} from './calendar';

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const ZONES = ['Pacific/Kiritimati', 'America/Adak'];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('weekday', () => {
  it('counts from Monday', () => {
    expect(weekday('2026-10-05')).toBe(0);
    expect(weekday('2026-10-11')).toBe(6);
  });
});

describe('gridSpan', () => {
  it('a week runs Monday to Sunday', () => {
    expect(gridSpan('week', '2026-10-07')).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    });
  });

  it('February 2027 is exactly four weeks', () => {
    expect(days(gridSpan('month', '2027-02-10'))).toHaveLength(28);
  });

  it('August 2026 needs six weeks', () => {
    expect(days(gridSpan('month', '2026-08-15'))).toHaveLength(42);
  });

  it('holds for every month of 1990 to 2060', () => {
    for (let y = 1990; y <= 2060; y++) {
      for (let m = 0; m < 12; m++) {
        const at = iso(Date.UTC(y, m, 1 + ((y + m) % 28)));
        const span = gridSpan('month', at);
        const all = days(span);
        const first = iso(Date.UTC(y, m, 1));
        const last = iso(Date.UTC(y, m + 1, 0));
        expect(weekday(span.from)).toBe(0);
        expect(weekday(span.to)).toBe(6);
        expect([28, 35, 42]).toContain(all.length);
        expect(all.length).toBeLessThanOrEqual(MAX_SPAN_DAYS);
        expect(all.includes(first) && all.includes(last)).toBe(true);
        // a week holding no day of the month would be one too many
        expect(
          span.from <= first &&
            first < iso(Date.parse(span.from) + 7 * 86_400_000),
        ).toBe(true);
        expect(
          last <= span.to && iso(Date.parse(span.to) - 7 * 86_400_000) < last,
        ).toBe(true);
        // consecutive days: no DST shift repeats or skips one
        all.forEach((d, i) =>
          expect(d).toBe(iso(Date.parse(span.from) + i * 86_400_000)),
        );
        const w = gridSpan('week', at);
        expect(days(w)).toHaveLength(7);
        expect(days(w)).toContain(at);
      }
    }
  });
});

describe('shift', () => {
  it('a month move lands on the 1st', () => {
    expect(shift('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shift('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shift('month', '2026-11-30', 14)).toBe('2028-01-01');
  });

  it('a week move crosses the year', () => {
    expect(shift('week', '2026-12-28', 1)).toBe('2027-01-04');
  });
});

describe.each(ZONES)('in %s', (tz) => {
  it('gives the same dates as in UTC', () => {
    process.env.TZ = tz;
    expect(weekday('2026-10-05')).toBe(0);
    expect(weekday('2026-10-11')).toBe(6);
    expect(gridSpan('week', '2026-10-07')).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    });
    expect(days(gridSpan('month', '2027-02-10'))).toHaveLength(28);
    expect(days(gridSpan('month', '2026-08-15'))).toHaveLength(42);
    expect(shift('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shift('week', '2026-12-28', 1)).toBe('2027-01-04');
  });
});

describe('fromQuery', () => {
  const today = '2026-10-02';
  it('reads a valid query back', () => {
    expect(fromQuery({ mode: 'month', at: '2026-02-01' }, today)).toEqual({
      mode: 'month',
      at: '2026-02-01',
    });
  });

  it.each<Record<string, unknown>>([
    { mode: 'year', at: '2026-02-30' },
    { mode: 'month', at: '2026-02-30' },
    { mode: 'year', at: '2026-02-01' },
    { mode: ['week'], at: ['2026-02-01'] },
    {},
  ])('falls back to week at today for %j', (query) => {
    expect(fromQuery(query, today)).toEqual({
      mode: 'week',
      at: today,
    });
  });
});

describe('placeWrite', () => {
  const task = { id: 'task-1' } as unknown as Item;
  const place = (over: Partial<Placement>): Placement => ({
    taskId: 'task-1',
    date: '2026-10-05',
    kind: 'scheduled',
    occurrence: null,
    closed: false,
    ...over,
  });

  it('moves the occurrence of a recurring scheduled placement', () => {
    const r = placeWrite(
      place({ occurrence: '2026-10-05' }),
      task,
      '2026-10-07',
    )!;
    expect(r.write).toEqual({
      kind: 'moveOccurrence',
      taskId: 'task-1',
      occurrence: '2026-10-05',
      to: '2026-10-07',
    });
    expect(r.undo({ kind: 'moveOccurrence', id: 'copy-1' } as never)).toEqual({
      kind: 'undoMove',
      taskId: 'copy-1',
    });
  });

  it('edits dueOn for a due placement', () => {
    const r = placeWrite(place({ kind: 'due' }), task, '2026-10-07')!;
    expect(r.write).toEqual({
      kind: 'edit',
      taskId: 'task-1',
      changes: { dueOn: '2026-10-07' },
    });
    expect(r.undo({} as never)).toEqual({
      kind: 'edit',
      taskId: 'task-1',
      changes: { dueOn: '2026-10-05' },
    });
  });

  it('edits scheduledOn for a one-off, undone with the old date', () => {
    const r = placeWrite(place({}), task, '2026-10-07')!;
    expect(r.write).toEqual({
      kind: 'edit',
      taskId: 'task-1',
      changes: { scheduledOn: '2026-10-07' },
    });
    expect(r.undo({} as never)).toEqual({
      kind: 'edit',
      taskId: 'task-1',
      changes: { scheduledOn: '2026-10-05' },
    });
  });

  it('a recurring due placement edits dueOn, never moves', () => {
    const r = placeWrite(
      place({ kind: 'due', occurrence: null }),
      task,
      '2026-10-06',
    )!;
    expect(r.write.kind).toBe('edit');
  });

  it('a drop on the same day writes nothing', () => {
    expect(placeWrite(place({}), task, '2026-10-05')).toBeNull();
  });
});
