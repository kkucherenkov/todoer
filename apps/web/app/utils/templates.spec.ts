import { filterProblem } from '@todoer/client-core';
import { describe, expect, it } from 'vitest';
import { filterOf, type Template } from './templates';

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
  it.each(all)('%j writes a valid filter', (t) => {
    expect(filterProblem(filterOf(t))).toBeNull();
  });

  it('writes lower-case ids', () => {
    expect(filterOf({ kind: 'tag', id: ID.toUpperCase() })).toEqual({
      tag: ID,
    });
  });
});
