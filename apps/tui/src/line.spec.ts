import { describe, expect, it } from 'vitest';
import { lineChanges, lineOf } from './line.js';

const item = {
  title: 'milk',
  tags: ['@shop'],
  project: 'home',
  priority: 2,
};

describe('lineOf', () => {
  it('writes title, tags, project and priority as quick-add reads them', () => {
    expect(lineOf(item)).toBe('milk @shop #home p2');
    expect(lineOf({ title: 'x', tags: [], project: null, priority: 0 })).toBe(
      'x',
    );
  });
});

describe('lineChanges', () => {
  it('is empty for an unchanged line', () => {
    expect(lineChanges(item, 'milk @shop #home p2')).toEqual({});
  });

  it('names only what changed', () => {
    expect(lineChanges(item, 'oat milk @shop #home p2')).toEqual({
      title: 'oat milk',
    });
    expect(lineChanges(item, 'milk @shop @dairy #home p2')).toEqual({
      tags: ['@shop', '@dairy'],
    });
    expect(lineChanges(item, 'milk @shop p2')).toEqual({ project: null });
    expect(lineChanges(item, 'milk @shop #home')).toEqual({ priority: 0 });
  });

  it('compares tags as a set', () => {
    const two = { ...item, tags: ['@a', '@b'] };
    expect(lineChanges(two, 'milk @b @a #home p2')).toEqual({});
  });
});
