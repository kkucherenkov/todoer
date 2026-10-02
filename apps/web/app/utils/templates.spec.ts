import { filterProblem } from '@todoer/client-core';
import { describe, expect, it } from 'vitest';
import { filterOf, templateOf, type Template } from './templates';

const ID = '0192f3a0-0000-7000-8000-000000000001';
const all: Template[] = [
  { kind: 'today' },
  { kind: 'overdue' },
  { kind: 'next7' },
  { kind: 'project', id: ID },
  { kind: 'project', id: null },
  { kind: 'tag', id: ID },
  { kind: 'status', id: ID },
];

describe('view templates', () => {
  it.each(all)('%j writes a valid filter and reads back', (t) => {
    expect(filterProblem(filterOf(t))).toBeNull();
    expect(templateOf(filterOf(t))).toEqual(t);
  });

  it('writes lower-case ids', () => {
    expect(filterOf({ kind: 'tag', id: ID.toUpperCase() })).toEqual({
      tag: ID,
    });
  });

  it.each([
    ['a reordered or', { or: [{ due: { to: 0 } }, { scheduled: { to: 0 } }] }],
    ['an extra key', { project: ID, tag: ID }],
    ['an extra key on a fixed one', { due: { to: -1 }, tag: ID }],
    ['an empty and', { and: [] }],
    ['a non-string id', { tag: 5 }],
    ['not an object', 'today'],
  ])('%s is no template', (_, filter) => {
    expect(templateOf(filter)).toBeNull();
  });
});
