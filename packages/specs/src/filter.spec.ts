import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FILTER_MAX_DEPTH,
  FILTER_MAX_NODES,
  filterProblem,
  filterSize,
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

describe('filterSize', () => {
  const tags = (n: number) => ({
    and: Array.from({ length: n }, () => ({ tag: TAG })),
  });
  it('counts every object as a node, the root as depth 1', () => {
    expect(filterSize({ and: [] })).toEqual({ nodes: 1, depth: 1 });
    expect(filterSize({ not: { tag: TAG } })).toEqual({ nodes: 2, depth: 2 });
  });
  it('counts a non-object as one node at its depth', () => {
    expect(filterSize(null)).toEqual({ nodes: 1, depth: 1 });
    expect(filterSize({ not: 5 })).toEqual({ nodes: 2, depth: 2 });
  });
  it('keeps every valid vector within the limits', () => {
    for (const { filter } of vectors.cases) {
      const { nodes, depth } = filterSize(filter);
      expect(nodes).toBeLessThanOrEqual(FILTER_MAX_NODES);
      expect(depth).toBeLessThanOrEqual(FILTER_MAX_DEPTH);
    }
  });
  it('agrees with filterProblem on depth', () => {
    expect(filterSize(nested(FILTER_MAX_DEPTH)).depth).toBe(FILTER_MAX_DEPTH);
    expect(filterProblem(nested(FILTER_MAX_DEPTH))).toBeNull();
    expect(filterSize(nested(FILTER_MAX_DEPTH + 1)).depth).toBe(
      FILTER_MAX_DEPTH + 1,
    );
    expect(filterProblem(nested(FILTER_MAX_DEPTH + 1))).toMatch(/deeper/);
  });
  it('agrees with filterProblem on nodes', () => {
    expect(filterSize(tags(FILTER_MAX_NODES - 1)).nodes).toBe(FILTER_MAX_NODES);
    expect(filterProblem(tags(FILTER_MAX_NODES - 1))).toBeNull();
    expect(filterSize(tags(FILTER_MAX_NODES)).nodes).toBe(FILTER_MAX_NODES + 1);
    expect(filterProblem(tags(FILTER_MAX_NODES))).toMatch(
      /more than 256 nodes/,
    );
  });
});
