import { describe, expect, it } from 'vitest';
import { taskTagId } from '@todoer/specs';
import { planMerge } from './merge.js';

function ids() {
  let n = 0;
  return () => `n${String(++n)}`;
}

const view = {
  tasks: [
    { id: 't1', projectId: 'pb', deletedAt: null },
    { id: 't2', projectId: 'pa', deletedAt: null },
    { id: 't3', projectId: 'pb', deletedAt: '2026-09-01T00:00:00Z' },
  ],
  projects: [
    {
      id: 'pb',
      name: 'Finance',
      version: 2,
      deletedAt: null,
      archivedAt: null,
    },
    {
      id: 'pa',
      name: 'finance',
      version: 1,
      deletedAt: null,
      archivedAt: null,
    },
    {
      id: 'pz',
      name: 'finance',
      version: 1,
      deletedAt: null,
      archivedAt: '2026-01-01T00:00:00Z',
    },
  ],
  tags: [
    { id: 'gb', name: '@phone', version: 3, deletedAt: null },
    { id: 'ga', name: '@Phone', version: 1, deletedAt: null },
    { id: 'gp', name: '@phone', deletedAt: null },
  ],
  links: [
    { id: 'l1', taskId: 't1', tagId: 'gb', deletedAt: null },
    { id: 'l2', taskId: 't2', tagId: 'gb', deletedAt: null, attached: false },
  ],
  statuses: [],
  views: [],
};

describe('planMerge', () => {
  it('moves attached links and tasks to the lowest id and deletes the losers', () => {
    expect(planMerge(view, ids(), 'T')).toEqual({
      ops: [
        {
          opId: 'n1',
          kind: 'create',
          table: 'task_tag',
          id: taskTagId('t1', 'ga'),
          fields: { taskId: 't1', tagId: 'ga', attached: true },
          ts: 'T',
        },
        {
          opId: 'n2',
          kind: 'set',
          table: 'task_tag',
          id: 'l1',
          field: 'attached',
          value: false,
          ts: 'T',
        },
        { opId: 'n3', kind: 'delete', table: 'tag', id: 'gb', baseVersion: 3 },
        {
          opId: 'n4',
          kind: 'set',
          table: 'task',
          id: 't1',
          field: 'projectId',
          value: 'pa',
          ts: 'T',
        },
        {
          opId: 'n5',
          kind: 'delete',
          table: 'project',
          id: 'pb',
          baseVersion: 2,
        },
      ],
      merged: ['@Phone (2)', '#finance (2)'],
    });
  });

  // Review Focus 4, departure 1: a detached link stays detached, an archived
  // project and a row the server has not confirmed are left alone. A deleted
  // task is never moved, even if its project loses the merge.
  it('leaves detached links, archived projects and unconfirmed rows out', () => {
    const { ops } = planMerge(view, ids(), 'T');
    expect(ops.some((op) => op.id === 'l2')).toBe(false);
    expect(ops.some((op) => op.id === 'pz')).toBe(false);
    expect(ops.some((op) => op.id === 'gp')).toBe(false);
    expect(ops.some((op) => op.id === 't3')).toBe(false);
  });

  // Two clients that see the same rows in different orders must send the
  // same ops, or the repeated creates and deletes stop being idempotent.
  it('plans the same ops whatever order the rows arrive in', () => {
    const reversed = {
      tasks: [...view.tasks].reverse(),
      projects: [...view.projects].reverse(),
      tags: [...view.tags].reverse(),
      links: [...view.links].reverse(),
      statuses: [],
      views: [],
    };
    expect(planMerge(reversed, ids(), 'T')).toEqual(
      planMerge(view, ids(), 'T'),
    );
    const two = {
      ...view,
      tags: [
        ...view.tags,
        { id: 'hb', name: '@b', version: 1, deletedAt: null },
        { id: 'ha', name: '@B', version: 1, deletedAt: null },
      ],
    };
    expect(
      planMerge({ ...two, tags: [...two.tags].reverse() }, ids(), 'T'),
    ).toEqual(planMerge(two, ids(), 'T'));
  });

  it('does not move a link whose task is deleted or unknown', () => {
    const { ops } = planMerge(
      {
        ...view,
        links: [
          ...view.links,
          { id: 'l3', taskId: 't3', tagId: 'gb', deletedAt: null },
          { id: 'l4', taskId: 'gone', tagId: 'gb', deletedAt: null },
        ],
      },
      ids(),
      'T',
    );
    expect(ops.some((op) => op.id === 'l3' || op.id === 'l4')).toBe(false);
    expect(ops.filter((op) => op.table === 'task_tag')).toHaveLength(2);
    expect(ops.some((op) => op.id === 'gb' && op.kind === 'delete')).toBe(true);
  });

  it('merges a group of three, moving the links of both losers', () => {
    const tag = (id: string, name: string) => ({
      id,
      name,
      version: 1,
      deletedAt: null,
    });
    const link = (
      id: string,
      taskId: string,
      tagId: string,
      deletedAt: string | null = null,
    ) => ({
      id,
      taskId,
      tagId,
      deletedAt,
    });
    const { ops, merged } = planMerge(
      {
        tasks: [
          { id: 't1', deletedAt: null },
          { id: 't2', deletedAt: null },
          { id: 't3', deletedAt: null },
        ],
        projects: [],
        tags: [tag('a3', '@x'), tag('a1', '@X'), tag('a2', '@x')],
        links: [
          link('l1', 't1', 'a2'),
          link('l2', 't2', 'a3'),
          // Deleted link: not moved.
          link('l3', 't3', 'a3', '2026-09-01T00:00:00Z'),
        ],
        statuses: [],
        views: [],
      },
      ids(),
      'T',
    );
    expect(ops.map((op) => `${op.kind} ${op.table} ${op.id}`)).toEqual([
      `create task_tag ${taskTagId('t1', 'a1')}`,
      'set task_tag l1',
      'delete tag a2',
      `create task_tag ${taskTagId('t2', 'a1')}`,
      'set task_tag l2',
      'delete tag a3',
    ]);
    expect(merged).toEqual(['@X (3)']);
  });

  it('treats composed and decomposed spellings as one group', () => {
    const { ops, merged } = planMerge(
      {
        tasks: [],
        projects: [],
        tags: [
          { id: 'b2', name: '@cafe\u0301', version: 1, deletedAt: null },
          { id: 'b1', name: '@caf\u00e9', version: 4, deletedAt: null },
        ],
        links: [],
        statuses: [],
        views: [],
      },
      ids(),
      'T',
    );
    expect(ops).toEqual([
      { opId: 'n1', kind: 'delete', table: 'tag', id: 'b2', baseVersion: 1 },
    ]);
    expect(merged).toEqual(['@caf\u00e9 (2)']);
  });

  it('plans nothing when no two live names collide', () => {
    expect(
      planMerge(
        {
          tasks: [],
          projects: [],
          tags: [{ id: 'a', name: '@a', version: 1, deletedAt: null }],
          links: [],
          statuses: [],
          views: [],
        },
        ids(),
        'T',
      ),
    ).toEqual({ ops: [], merged: [] });
  });

  describe('late links and tasks on a merged-away row', () => {
    const DEL = '2026-09-01T00:00:00Z';
    const tasks = [
      { id: 't1', projectId: 'pa', deletedAt: null },
      { id: 't2', projectId: 'pb', deletedAt: null },
    ];

    it('moves a live link of a tombstoned tag to the live same-named tag', () => {
      const { ops, merged } = planMerge(
        {
          tasks,
          projects: [],
          tags: [
            { id: 'g2', name: '@phone', version: 4, deletedAt: DEL },
            { id: 'g1', name: '@Phone', version: 2, deletedAt: null },
          ],
          links: [{ id: 'l1', taskId: 't1', tagId: 'g2', deletedAt: null }],
          statuses: [],
          views: [],
        },
        ids(),
        'T',
      );
      expect(ops.map((op) => `${op.kind} ${op.table} ${op.id}`)).toEqual([
        `create task_tag ${taskTagId('t1', 'g1')}`,
        'set task_tag l1',
      ]);
      expect(merged).toEqual(['@Phone (late links)']);
    });

    it('plans nothing when no live tag has the name', () => {
      const { ops, merged } = planMerge(
        {
          tasks,
          projects: [],
          tags: [{ id: 'g2', name: '@phone', version: 4, deletedAt: DEL }],
          links: [{ id: 'l1', taskId: 't1', tagId: 'g2', deletedAt: null }],
          statuses: [],
          views: [],
        },
        ids(),
        'T',
      );
      expect({ ops, merged }).toEqual({ ops: [], merged: [] });
    });

    it('moves a live task of a tombstoned project to the live same-named one', () => {
      const { ops, merged } = planMerge(
        {
          tasks,
          projects: [
            { id: 'pb', name: 'Finance', version: 3, deletedAt: DEL },
            {
              id: 'pa',
              name: 'finance',
              version: 1,
              deletedAt: null,
              archivedAt: null,
            },
          ],
          tags: [],
          links: [],
          statuses: [],
          views: [],
        },
        ids(),
        'T',
      );
      expect(ops).toEqual([
        {
          opId: 'n1',
          kind: 'set',
          table: 'task',
          id: 't2',
          field: 'projectId',
          value: 'pa',
          ts: 'T',
        },
      ]);
      expect(merged).toEqual(['#finance (late tasks)']);
    });

    it('leaves the task of an archived (not deleted) project alone', () => {
      const { ops } = planMerge(
        {
          tasks,
          projects: [
            {
              id: 'pb',
              name: 'Finance',
              version: 3,
              deletedAt: null,
              archivedAt: DEL,
            },
            {
              id: 'pa',
              name: 'finance',
              version: 1,
              deletedAt: null,
              archivedAt: null,
            },
          ],
          tags: [],
          links: [],
          statuses: [],
          views: [],
        },
        ids(),
        'T',
      );
      expect(ops).toEqual([]);
    });
  });

  describe('statuses and views', () => {
    const DEL = '2026-09-01T00:00:00Z';
    const status = (
      id: string,
      name: string,
      deletedAt: string | null = null,
    ) => ({
      id,
      name,
      version: 2,
      deletedAt,
    });
    const viewRow = (
      id: string,
      filter: unknown,
      deletedAt: string | null = null,
    ) => ({ id, name: id, filter, deletedAt });
    const GA = '00000000-0000-4000-8000-00000000000a';
    const GB = '00000000-0000-4000-8000-00000000000b';
    const PA = '00000000-0000-4000-8000-0000000000a0';
    const PB = '00000000-0000-4000-8000-0000000000b0';
    const empty = {
      tasks: [],
      projects: [],
      tags: [],
      links: [],
      statuses: [],
      views: [],
    };
    const setFilter = (id: string, value: unknown) => ({
      opId: expect.any(String) as string,
      kind: 'set',
      table: 'view',
      id,
      field: 'filter',
      value,
      ts: 'T',
    });

    it('moves the live tasks of a losing status to the winner, then deletes it', () => {
      const { ops, merged } = planMerge(
        {
          ...empty,
          tasks: [
            { id: 't1', statusId: 's2', deletedAt: null },
            { id: 't2', statusId: 's1', deletedAt: null },
            { id: 't3', statusId: 's2', deletedAt: DEL },
          ],
          statuses: [status('s2', 'doing'), status('s1', 'Doing')],
        },
        ids(),
        'T',
      );
      expect(ops).toEqual([
        {
          opId: 'n1',
          kind: 'set',
          table: 'task',
          id: 't1',
          field: 'statusId',
          value: 's1',
          ts: 'T',
        },
        {
          opId: 'n2',
          kind: 'delete',
          table: 'status',
          id: 's2',
          baseVersion: 2,
        },
      ]);
      expect(merged).toEqual(['Doing (2)']);
    });

    it('rewrites a view that names a live losing status, after the delete', () => {
      const SA = '00000000-0000-4000-8000-0000000000a5';
      const SB = '00000000-0000-4000-8000-0000000000b5';
      const { ops } = planMerge(
        {
          ...empty,
          statuses: [status(SB, 'doing'), status(SA, 'Doing')],
          views: [viewRow('v1', { status: SB })],
        },
        ids(),
        'T',
      );
      expect(ops.map((op) => `${op.kind} ${op.table} ${op.id}`)).toEqual([
        `delete status ${SB}`,
        'set view v1',
      ]);
      expect(ops[1]).toEqual(setFilter('v1', { status: SA }));
    });

    it('moves a live task of a tombstoned status to the live same-named one', () => {
      const { ops, merged } = planMerge(
        {
          ...empty,
          tasks: [{ id: 't1', statusId: 's2', deletedAt: null }],
          statuses: [status('s2', 'doing', DEL), status('s1', 'Doing')],
        },
        ids(),
        'T',
      );
      expect(ops.map((op) => `${op.kind} ${op.table} ${op.id}`)).toEqual([
        'set task t1',
      ]);
      expect(merged).toEqual(['Doing (late tasks)']);
    });

    it('rewrites a view that names a losing tag in a nested not, before the delete', () => {
      const { ops } = planMerge(
        {
          ...empty,
          tasks: [{ id: 't1', deletedAt: null }],
          tags: [
            { id: GB, name: '@x', version: 1, deletedAt: null },
            { id: GA, name: '@X', version: 1, deletedAt: null },
          ],
          links: [{ id: 'l1', taskId: 't1', tagId: GB, deletedAt: null }],
          views: [
            viewRow('v1', { and: [{ priority: [1] }, { not: { tag: GB } }] }),
            viewRow('v2', { tag: GA }),
            viewRow('v3', { tag: GB }, DEL),
          ],
        },
        ids(),
        'T',
      );
      expect(ops.map((op) => `${op.kind} ${op.table} ${op.id}`)).toEqual([
        `create task_tag ${taskTagId('t1', GA)}`,
        'set task_tag l1',
        `delete tag ${GB}`,
        'set view v1',
      ]);
      expect(ops[3]).toEqual(
        setFilter('v1', { and: [{ priority: [1] }, { not: { tag: GA } }] }),
      );
    });

    it('writes one set filter for a view naming two losers', () => {
      const { ops } = planMerge(
        {
          ...empty,
          projects: [
            {
              id: PB,
              name: 'F',
              version: 1,
              deletedAt: null,
              archivedAt: null,
            },
            {
              id: PA,
              name: 'f',
              version: 1,
              deletedAt: null,
              archivedAt: null,
            },
          ],
          tags: [
            { id: GB, name: '@x', version: 1, deletedAt: null },
            { id: GA, name: '@X', version: 1, deletedAt: null },
          ],
          views: [viewRow('v1', { or: [{ tag: GB }, { project: PB }] })],
        },
        ids(),
        'T',
      );
      const sets = ops.filter((op) => op.table === 'view');
      expect(sets).toEqual([
        setFilter('v1', { or: [{ tag: GA }, { project: PA }] }),
      ]);
    });

    it('plans the same view writes whatever the order the views arrive in', () => {
      const replica = {
        ...empty,
        tags: [
          { id: GB, name: '@x', version: 1, deletedAt: null },
          { id: GA, name: '@X', version: 1, deletedAt: null },
        ],
        views: [
          viewRow('v1', { tag: GB }),
          viewRow('v2', { not: { tag: GB } }),
        ],
      };
      const plan = (views: (typeof replica.views)[number][]) =>
        planMerge({ ...replica, views }, ids(), 'T').ops.map((op) => ({
          ...op,
          opId: undefined,
        }));
      const forward = plan(replica.views);
      expect(forward.filter((op) => op.table === 'view')).toHaveLength(2);
      expect(plan([...replica.views].reverse())).toEqual(forward);
    });

    it.each([
      ['tag', 'tags', GA, GB],
      ['status', 'statuses', GA, GB],
    ])(
      'rewrites a view naming a late %s tombstone to the live winner',
      (key, table, live, tomb) => {
        const row = (id: string, deletedAt: string | null) => ({
          id,
          name: key === 'tag' ? '@x' : 'x',
          version: 2,
          deletedAt,
        });
        const { ops } = planMerge(
          {
            ...empty,
            [table]: [row(tomb, DEL), row(live, null)],
            views: [viewRow('v1', { [key]: tomb })],
          },
          ids(),
          'T',
        );
        expect(ops.filter((op) => op.table === 'view')).toEqual([
          setFilter('v1', { [key]: live }),
        ]);
      },
    );

    it('leaves a view whose stored filter is invalid alone, without throwing', () => {
      const { ops } = planMerge(
        {
          ...empty,
          tags: [
            { id: 'gb', name: '@x', version: 1, deletedAt: null },
            { id: 'ga', name: '@X', version: 1, deletedAt: null },
          ],
          views: [viewRow('v1', { tag: 'gb', priority: [1] })],
        },
        ids(),
        'T',
      );
      expect(ops.some((op) => op.table === 'view')).toBe(false);
    });
  });
});
