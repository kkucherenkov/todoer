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

  it('plans nothing when no two live names collide', () => {
    expect(
      planMerge(
        {
          tasks: [],
          projects: [],
          tags: [{ id: 'a', name: '@a', version: 1, deletedAt: null }],
          links: [],
        },
        ids(),
        'T',
      ),
    ).toEqual({ ops: [], merged: [] });
  });
});
