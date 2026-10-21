import type { ChildItem, Item } from '@todoer/client-core';
import { describe, expect, it } from 'vitest';
import { canIndent, dropAfter, outline, siblings } from './outline';

const child = (id: string, fields: Partial<ChildItem> = {}): ChildItem => ({
  id,
  title: id,
  closed: false,
  statusId: null,
  projectId: null,
  priority: 4,
  scheduledOn: null,
  dueOn: null,
  inView: true,
  ...fields,
});

/** Only the fields the outline reads; the rest of an Item is irrelevant. */
const item = (
  id: string,
  fields: {
    projectId?: string;
    project?: string;
    parentId?: string;
    children?: ChildItem[];
    rrule?: string;
  } = {},
): Item =>
  ({
    id,
    title: id,
    projectId: fields.projectId ?? null,
    project: fields.project ?? null,
    parentId: fields.parentId ?? null,
    rrule: fields.rrule ?? null,
    children: fields.children ?? [],
    subtasks: fields.children?.length
      ? { done: 0, total: fields.children.length }
      : null,
  }) as unknown as Item;

const ids = (groups: ReturnType<typeof outline>) =>
  groups.map((g) => ({
    project: g.project,
    count: g.count,
    branches: g.branches.map((b) => [
      String(b.item.id),
      b.nested.map((n) => String(n.id)),
      b.context.map((c) => c.id),
    ]),
  }));

describe('outline', () => {
  it('groups top-level rows by project, by name, No project last', () => {
    const items = [
      item('a'),
      item('b', { projectId: 'pw', project: 'work' }),
      item('c', { projectId: 'ph', project: 'Home' }),
      item('d', { projectId: 'pw', project: 'work' }),
    ];
    expect(ids(outline(items, 'en'))).toEqual([
      { project: 'Home', count: 1, branches: [['c', [], []]] },
      {
        project: 'work',
        count: 2,
        branches: [
          ['b', [], []],
          ['d', [], []],
        ],
      },
      { project: null, count: 1, branches: [['a', [], []]] },
    ]);
    expect(outline([...items].reverse(), 'en').map((g) => g.project)).toEqual([
      'Home',
      'work',
      null,
    ]);
  });

  it('nests a listed child once under its listed parent, any project', () => {
    const items = [
      item('p', {
        projectId: 'ph',
        project: 'home',
        children: [child('k1', { projectId: 'pg' }), child('k2')],
      }),
      item('k2', { parentId: 'p' }),
      item('k1', { parentId: 'p', projectId: 'pg', project: 'garage' }),
    ];
    // In view order, not the children's rank order.
    expect(ids(outline(items, 'en'))).toEqual([
      { project: 'home', count: 3, branches: [['p', ['k2', 'k1'], []]] },
    ]);
  });

  it('keeps a child whose parent is not listed in its own project', () => {
    const items = [
      item('k', { parentId: 'gone', projectId: 'pw', project: 'work' }),
    ];
    expect(ids(outline(items, 'en'))).toEqual([
      { project: 'work', count: 1, branches: [['k', [], []]] },
    ]);
  });

  it('shows unlisted children as context, never counted', () => {
    const items = [
      item('p', {
        children: [
          child('in'),
          child('out', { inView: false }),
          child('done', { inView: false, closed: true }),
        ],
      }),
      item('in', { parentId: 'p' }),
    ];
    expect(ids(outline(items, 'en'))).toEqual([
      { project: null, count: 2, branches: [['p', ['in'], ['out', 'done']]] },
    ]);
  });

  it('reads context from the listing, not only from inView', () => {
    // A child the engine marks in view but this listing lacks is context:
    // it must not vanish from the disclosure.
    const items = [item('p', { children: [child('k')] })];
    expect(
      outline(items, 'en')[0]!.branches[0]!.context.map((c) => c.id),
    ).toEqual(['k']);
  });
});

describe('dropAfter', () => {
  const [group] = outline(
    [
      item('r1', { children: [child('c1'), child('c2')] }),
      item('c1', { parentId: 'r1' }),
      item('c2', { parentId: 'r1' }),
      item('r2'),
    ],
    'en',
  );

  it('moves a root after a root, or first', () => {
    expect(dropAfter(group!, 'r2', 'r1')).toBe('r1');
    expect(dropAfter(group!, 'r1', 'r2')).toBe('r2');
    expect(dropAfter(group!, 'r2', null)).toBeNull();
  });

  it('reads a root dropped among children as after their parent', () => {
    expect(dropAfter(group!, 'r2', 'c2')).toBe('r1');
  });

  it('ignores a root dropped among its own children', () => {
    expect(dropAfter(group!, 'r1', 'c1')).toBeUndefined();
  });

  it('moves a child among its siblings; after its parent is first', () => {
    expect(dropAfter(group!, 'c1', 'c2')).toBe('c2');
    expect(dropAfter(group!, 'c2', 'r1')).toBeNull();
  });

  it('ignores a child dropped outside its siblings', () => {
    expect(dropAfter(group!, 'c1', 'r2')).toBeUndefined();
    expect(dropAfter(group!, 'c1', null)).toBeUndefined();
  });

  it('ignores a task from another group', () => {
    expect(dropAfter(group!, 'elsewhere', 'r1')).toBeUndefined();
  });
});

describe('siblings', () => {
  const [group] = outline(
    [
      item('r1', { children: [child('c1'), child('c2')] }),
      item('c1', { parentId: 'r1' }),
      item('c2', { parentId: 'r1' }),
      item('r2'),
    ],
    'en',
  );

  it("is the group's roots for a root, the parent's listed children for a child", () => {
    expect(siblings(group!, 'r2')).toEqual(['r1', 'r2']);
    expect(siblings(group!, 'c2')).toEqual(['c1', 'c2']);
  });
});

describe('canIndent', () => {
  it('only a top-level one-off task without children', () => {
    expect(canIndent(item('a'))).toBe(true);
    expect(canIndent(item('a', { parentId: 'p' }))).toBe(false);
    expect(canIndent(item('a', { children: [child('k')] }))).toBe(false);
    expect(canIndent(item('a', { rrule: 'FREQ=DAILY' }))).toBe(false);
  });
});
