import { describe, expect, it } from 'vitest';
import type { Catalog, Item } from '@todoer/client-core';
import { columns, moveAfterIn, visible } from './board-columns.js';

const item = (id: string, column: string | null): Item =>
  ({ id, title: id, column, closed: false, tags: [], project: null }) as Item;
const status = (
  id: string,
  completing = false,
): Catalog['statuses'][number] => ({
  id,
  name: id.toUpperCase(),
  rank: id,
  color: null,
  completing,
  tasks: 0,
  version: 1,
});

describe('columns', () => {
  it('groups by column over the statuses, keeping the view order', () => {
    const cols = columns(
      [item('t1', 'b'), item('t2', 'a'), item('t3', 'b')],
      [status('a'), status('b'), status('c', true)],
    );
    expect(cols.map((c) => [c.id, c.items.map((i) => i.id)])).toEqual([
      ['a', ['t2']],
      ['b', ['t1', 't3']],
      ['c', []],
    ]);
    expect(cols[2]?.completing).toBe(true);
  });

  it('is one "Tasks" column when there are no statuses', () => {
    const cols = columns([item('t1', null)], []);
    expect(cols).toEqual([
      { id: null, name: 'Tasks', completing: false, items: [item('t1', null)] },
    ]);
  });
});

describe('visible', () => {
  it('shows everything that fits', () => {
    expect(visible(3, 0, 5)).toEqual({ from: 0, to: 3 });
  });
  it('slides to keep the cursor in view', () => {
    expect(visible(6, 0, 3)).toEqual({ from: 0, to: 3 });
    expect(visible(6, 4, 3)).toEqual({ from: 2, to: 5 });
    expect(visible(6, 5, 3)).toEqual({ from: 3, to: 6 });
  });
});

describe('moveAfterIn', () => {
  const col = [item('a', 's'), item('b', 's'), item('c', 's')];
  it('up and down among the column’s cards', () => {
    expect(moveAfterIn(col, 'c', -1)).toBe('a');
    expect(moveAfterIn(col, 'b', -1)).toBeNull();
    expect(moveAfterIn(col, 'a', 1)).toBe('b');
  });
  it('undefined at the ends', () => {
    expect(moveAfterIn(col, 'a', -1)).toBeUndefined();
    expect(moveAfterIn(col, 'c', 1)).toBeUndefined();
  });
});
