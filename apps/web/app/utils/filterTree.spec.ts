import {
  filterProblem,
  filterSize,
  type Catalog,
  type Filter,
} from '@todoer/client-core';
import { describe, expect, it } from 'vitest';
import vectors from '../../../../packages/specs/vectors/filters.json';
import {
  append,
  at,
  blank,
  canAdd,
  canToggleNot,
  children,
  editable,
  remove,
  replace,
  setGroup,
  toggleNot,
  type Path,
} from './filterTree';
import { filterOf, type Template } from './templates';

const ID = '0192f3a0-0000-7000-8000-000000000001';
const ID2 = '0192f3a0-0000-7000-8000-000000000002';
const templates: Template[] = [
  { kind: 'today' },
  { kind: 'overdue' },
  { kind: 'next7' },
  { kind: 'project', id: ID },
  { kind: 'project', id: null },
  { kind: 'tag', id: ID },
  { kind: 'status', id: ID },
];
const raw: Filter[] = [
  { and: [] },
  { not: { or: [{ tag: ID }, { and: [{ priority: [4, 0] }] }] } },
  {
    and: [
      { scheduled: {} },
      { due: { from: '2026-01-01', to: 3 } },
      { recurring: false },
    ],
  },
];
const valid = (vectors.cases as { filter: unknown }[])
  .map((c) => c.filter)
  .filter((f) => filterProblem(f) === null) as Filter[];
const corpus = [...templates.map(filterOf), ...raw, ...valid];

/** Every path `children` reaches, root first. */
function paths(f: Filter, at0: Path = []): Path[] {
  return [at0, ...children(f).flatMap((c, i) => paths(c, [...at0, i]))];
}
const chain = (depth: number): Filter => {
  let f: Filter = { and: [] };
  for (let i = 1; i < depth; i++) f = { not: f };
  return f;
};
const wide = (n: number): Filter => ({
  and: Array.from({ length: n }, () => ({ recurring: true })),
});
const catalog = (tags: string[] = [], statuses: string[] = []): Catalog =>
  ({
    views: [],
    projects: [],
    tags: tags.map((id) => ({ id, name: id })),
    statuses: statuses.map((id) => ({ id, name: id })),
  }) as unknown as Catalog;

describe('editable', () => {
  it('holds for every template, raw and vector filter', () => {
    expect(corpus.length).toBeGreaterThan(10);
    for (const f of corpus) expect(editable(f)).toBe(true);
  });

  it.each([
    ['two keys', { tag: 'x', and: [] }],
    ['an object under and', { and: {} }],
    ['an array under not', { not: [] }],
    ['an unknown key', { foo: 1 }],
    ['a non-object', 'x'],
    ['null', null],
    ['a nested bad node', { or: [{ and: [{ foo: 1 }] }] }],
    [
      'a 10-deep not chain',
      {
        not: {
          not: {
            not: {
              not: {
                not: { not: { not: { not: { not: { not: { tag: ID } } } } } },
              },
            },
          },
        },
      },
    ],
  ])('is false for %s', (_, f) => {
    expect(editable(f)).toBe(false);
  });

  it('is true for an incomplete leaf and over the filter limits, false past its own', () => {
    expect(editable({ tag: '' })).toBe(true);
    expect(filterProblem({ tag: '' })).not.toBeNull();
    expect(editable(chain(9))).toBe(true);
    expect(editable(chain(10))).toBe(false);
    expect(editable(wide(256))).toBe(true);
    expect(editable(wide(257))).toBe(false);
  });
});

describe('round trip', () => {
  it('replace with the node already there changes nothing, and JSON keeps it', () => {
    for (const f of corpus) {
      for (const p of paths(f)) {
        expect(at(f, p)).toBeDefined();
        const same = replace(f, p, at(f, p));
        expect(same).toEqual(f);
        expect(same === f).toBe(true);
      }
      expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    }
  });

  it('replace(f, [], f) is f', () => {
    for (const f of corpus) expect(replace(f, [], f)).toBe(f);
  });
});

describe('replace', () => {
  it('keeps every other child and the untouched subtrees the same object', () => {
    const a = { tag: ID };
    const b = { and: [{ recurring: true }, { priority: [1] }] };
    const c = { not: { due: {} } };
    const root: Filter = { or: [a, { or: [b, c] }] };
    const next = replace(root, [1, 0, 1], { recurring: false });
    expect(next).toEqual({
      or: [
        a,
        { or: [{ and: [{ recurring: true }, { recurring: false }] }, c] },
      ],
    });
    expect(next).not.toBe(root);
    const [na, mid] = (next as { or: Filter[] }).or;
    expect(na).toBe(a);
    expect((mid as { or: Filter[] }).or[1]).toBe(c);
    expect((mid as { or: Filter[] }).or[0]).not.toBe(b);
    expect(root).toEqual({ or: [a, { or: [b, c] }] });
  });
});

describe('remove', () => {
  it('drops a child from its group', () => {
    expect(remove({ and: [{ tag: ID }, { recurring: true }] }, [0])).toEqual({
      and: [{ recurring: true }],
    });
  });
  it('removes the not with its only child', () => {
    expect(
      remove({ and: [{ not: { tag: ID } }, { recurring: true }] }, [0, 0]),
    ).toEqual({ and: [{ recurring: true }] });
    expect(remove({ not: { tag: ID } }, [0])).toEqual({ and: [] });
  });
  it('turns the root into an empty and', () => {
    expect(remove({ tag: ID }, [])).toEqual({ and: [] });
  });
});

describe('append, toggleNot, setGroup', () => {
  it('appends to a group', () => {
    const f: Filter = { or: [{ and: [] }] };
    expect(append(f, [0], { tag: ID })).toEqual({
      or: [{ and: [{ tag: ID }] }],
    });
  });
  it('wraps and unwraps a not; twice is the same tree', () => {
    for (const f of corpus) {
      for (const p of paths(f)) {
        const once = toggleNot(f, p);
        expect(once).not.toEqual(f);
        expect(toggleNot(once, p)).toEqual(f);
      }
    }
  });
  it('setGroup switches the operator and keeps the children', () => {
    const kids = [{ tag: ID }, { tag: ID2 }];
    const next = setGroup({ and: [{ or: kids }] }, [0], 'and');
    const [g] = (next as { and: Filter[] }).and as [{ and: Filter[] }];
    expect(g.and[0]).toBe(kids[0]);
    expect(g.and[1]).toBe(kids[1]);
    expect(setGroup({ and: kids }, [], 'or')).toEqual({ or: kids });
  });
});

describe('blank', () => {
  it('lower-cases catalog ids', () => {
    const up = ID.toUpperCase();
    expect(blank('tag', catalog([up]))).toEqual({ tag: ID });
    expect(blank('status', catalog([], [up]))).toEqual({ status: ID });
  });
  it('is an incomplete leaf when the catalog is empty', () => {
    const f = blank('tag', catalog());
    expect(f).toEqual({ tag: '' });
    expect(editable(f)).toBe(true);
    expect(filterProblem(f)).not.toBeNull();
    expect(blank('status', catalog())).toEqual({ status: '' });
  });
  it('writes the rest as the brief says', () => {
    const c = catalog();
    expect(blank('project', c)).toEqual({ project: null });
    expect(blank('priority', c)).toEqual({ priority: [4] });
    expect(blank('scheduled', c)).toEqual({ scheduled: {} });
    expect(blank('due', c)).toEqual({ due: {} });
    expect(blank('recurring', c)).toEqual({ recurring: true });
    expect(blank('and', c)).toEqual({ and: [] });
    expect(blank('or', c)).toEqual({ or: [] });
  });
  it('every kind but an empty tag or status passes filterProblem', () => {
    for (const k of [
      'project',
      'priority',
      'scheduled',
      'due',
      'recurring',
      'and',
      'or',
    ] as const) {
      expect(filterProblem(blank(k, catalog()))).toBeNull();
    }
    expect(filterProblem(blank('tag', catalog([ID])))).toBeNull();
  });
});

describe('canAdd', () => {
  it('stops at depth 8', () => {
    // a group nested n deep: the child would sit at depth n + 1
    const nest = (n: number): Filter =>
      n === 1 ? { and: [] } : { and: [nest(n - 1)] };
    const deep = (n: number): Path => Array.from({ length: n - 1 }, () => 0);
    expect(canAdd(nest(7), deep(7))).toBe(true);
    expect(canAdd(nest(8), deep(8))).toBe(false);
  });
  it('stops at 256 nodes', () => {
    expect(canAdd(wide(254), [])).toBe(true); // 255 nodes
    expect(canAdd(wide(255), [])).toBe(false); // 256 nodes
    expect(canAdd(wide(256), [])).toBe(false);
  });
  it('edits that pass canAdd pass filterSize', () => {
    const f = wide(254);
    const next = append(f, [], blank('recurring', catalog()));
    expect(filterSize(next).nodes).toBeLessThanOrEqual(256);
    expect(filterProblem(next)).toBeNull();
  });
});

describe('only groups take children', () => {
  const f: Filter = { and: [{ tag: ID }, { not: { tag: ID2 } }] };
  it.each([
    ['a leaf', [0]],
    ['a not', [1]],
  ])('%s: canAdd is false, append and setGroup throw', (_, path) => {
    expect(canAdd(f, path)).toBe(false);
    expect(() => append(f, path, { recurring: true })).toThrow();
    expect(() => setGroup(f, path, 'or')).toThrow();
  });
});

describe('canToggleNot', () => {
  it('stops a wrap at depth 8 and at 256 nodes, never an unwrap', () => {
    const nest = (n: number): Filter =>
      n === 1 ? { tag: ID } : { and: [nest(n - 1)] };
    const deep = (n: number): Path => Array.from({ length: n - 1 }, () => 0);
    expect(canToggleNot(nest(7), deep(7))).toBe(true);
    expect(canToggleNot(nest(8), deep(8))).toBe(false);
    expect(canToggleNot(wide(254), [])).toBe(true); // 255 + not = 256
    expect(canToggleNot(wide(255), [])).toBe(false);
    const over = toggleNot(wide(254), []);
    expect(canToggleNot(append(over, [0], { tag: ID }), [])).toBe(true);
    expect(canToggleNot({ not: nest(8) }, [])).toBe(true);
  });
});
