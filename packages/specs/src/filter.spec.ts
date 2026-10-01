import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FILTER_MAX_DEPTH,
  FILTER_MAX_NODES,
  filterProblem,
  matches,
  replaceIds,
  type Filter,
  type FilterTask,
} from './filter';

type Vectors = {
  today: string;
  base: FilterTask;
  cases: Array<{
    name: string;
    filter: Filter;
    task: Partial<FilterTask>;
    matches: boolean;
  }>;
  invalid: Array<{ name: string; filter: unknown }>;
};
const vectors = JSON.parse(
  readFileSync(new URL('../vectors/filters.json', import.meta.url), 'utf8'),
) as Vectors;

const TAG = '018f0000-0000-7000-8000-00000000000a';

/** A chain of `not`s around one leaf: `levels` = the tree's depth. */
function nested(levels: number): unknown {
  let node: unknown = { tag: TAG };
  for (let i = 1; i < levels; i += 1) node = { not: node };
  return node;
}

describe('matches', () => {
  it.each(vectors.cases)('$name', ({ filter, task, matches: expected }) => {
    expect(filterProblem(filter)).toBeNull();
    expect(matches(filter, { ...vectors.base, ...task }, vectors.today)).toBe(
      expected,
    );
  });
});

describe('filterProblem', () => {
  it.each(vectors.invalid)('refuses $name', ({ filter }) => {
    expect(filterProblem(filter)).toEqual(expect.any(String));
  });

  it('accepts the deepest tree and refuses one level more', () => {
    expect(filterProblem(nested(FILTER_MAX_DEPTH))).toBeNull();
    expect(filterProblem(nested(FILTER_MAX_DEPTH + 1))).toMatch(/deeper/);
  });

  it('accepts the most nodes and refuses one more', () => {
    const leaves = (n: number) => ({
      or: Array.from({ length: n }, () => ({ recurring: true })),
    });
    // The `or` node counts too.
    expect(filterProblem(leaves(FILTER_MAX_NODES - 1))).toBeNull();
    expect(filterProblem(leaves(FILTER_MAX_NODES))).toMatch(/nodes/);
  });

  it('refuses ten thousand leaves without walking them all', () => {
    const huge = {
      or: Array.from({ length: 10_000 }, () => ({ recurring: true })),
    };
    expect(filterProblem(huge)).toMatch(/nodes/);
  });

  it('refuses a sparse priority list: holes are not priorities', () => {
    expect(filterProblem({ priority: new Array(3) })).toMatch(/priorities/);
  });

  it('names where the problem is', () => {
    expect(filterProblem({ and: [{ recurring: true }, { tag: 'x' }] })).toBe(
      'filter.and[1].tag: not a uuid',
    );
  });
});

describe('replaceIds', () => {
  const A = '018f0000-0000-7000-8000-00000000000a';
  const B = '018f0000-0000-7000-8000-00000000000b';
  const ids = new Map([[A, B]]);
  it('rewrites tag, project and status leaves at any depth', () => {
    expect(
      replaceIds(
        { and: [{ tag: A }, { not: { or: [{ project: A }, { status: A }] } }] },
        ids,
      ),
    ).toEqual({
      and: [{ tag: B }, { not: { or: [{ project: B }, { status: B }] } }],
    });
  });
  it('returns the same object when nothing names a replaced id', () => {
    const filter = {
      and: [{ tag: B }, { project: null }, { recurring: true }],
    };
    expect(replaceIds(filter, ids)).toBe(filter);
  });
});
