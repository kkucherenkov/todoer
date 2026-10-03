import { describe, expect, it } from 'vitest';
import type { Item } from '@todoer/client-core';
import { indentTarget, moveAfter, outline } from './outline-tree.js';

const item = (
  id: string,
  extra: Partial<Item> & { parentId?: string } = {},
): Item =>
  ({
    id,
    title: id,
    ref: id,
    occurrence: null,
    project: null,
    tags: [],
    status: null,
    column: null,
    closed: false,
    parentTitle: null,
    subtasks: null,
    ...extra,
  }) as Item;

describe('outline', () => {
  const items = [
    item('a'),
    item('a1', { parentId: 'a' }),
    item('b'),
    item('a2', { parentId: 'a', closed: true }),
    item('x1', { parentId: 'x', parentTitle: 'x' }), // parent not listed
  ];

  it('nests listed subtasks under their parent, in view order', () => {
    expect(outline(items, new Set()).map((r) => [r.item.id, r.depth])).toEqual([
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
      ['x1', 0],
    ]);
  });

  it('counts children and open children', () => {
    const [a] = outline(items, new Set());
    expect(a).toMatchObject({ children: 2, open: 1, folded: false });
  });

  it('hides a folded parent’s subtasks', () => {
    expect(outline(items, new Set(['a'])).map((r) => r.item.id)).toEqual([
      'a',
      'b',
      'x1',
    ]);
    expect(outline(items, new Set(['a']))[0]?.folded).toBe(true);
  });

  it('does not fold a task without listed subtasks', () => {
    expect(outline(items, new Set(['b']))[3]?.folded).toBe(false);
  });
});

describe('indentTarget', () => {
  const rows = outline(
    [item('a'), item('a1', { parentId: 'a' }), item('b'), item('c')],
    new Set(),
  );
  it('is the nearest top-level row above', () => {
    expect(indentTarget(rows, 2)).toBe('a'); // b under a, past a1
    expect(indentTarget(rows, 3)).toBe('b');
  });
  it('is null for the first row and for a subtask', () => {
    expect(indentTarget(rows, 0)).toBeNull();
    expect(indentTarget(rows, 1)).toBeNull();
  });
});

describe('moveAfter', () => {
  const items = [
    item('a'),
    item('a1', { parentId: 'a' }),
    item('a2', { parentId: 'a' }),
    item('b'),
    item('c'),
  ];
  it('up: after the sibling two above, or first', () => {
    expect(moveAfter(items, 'c', -1)).toBe('a');
    expect(moveAfter(items, 'b', -1)).toBeNull();
    expect(moveAfter(items, 'a2', -1)).toBeNull();
  });
  it('down: after the next sibling', () => {
    expect(moveAfter(items, 'a', 1)).toBe('b');
    expect(moveAfter(items, 'a1', 1)).toBe('a2');
  });
  it('undefined at either end of its siblings', () => {
    expect(moveAfter(items, 'a', -1)).toBeUndefined();
    expect(moveAfter(items, 'c', 1)).toBeUndefined();
    expect(moveAfter(items, 'a2', 1)).toBeUndefined();
  });
});
