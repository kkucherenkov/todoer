import { describe, expect, it } from 'vitest';
import { labelsOf, resolveLabels, winner } from './labels.js';

function ids() {
  let n = 0;
  return () => `n${String(++n)}`;
}

describe('winner', () => {
  it('is the lowest id, case-insensitively', () => {
    expect(winner([{ id: 'B2' }, { id: 'a9' }, { id: 'b1' }])?.id).toBe('a9');
  });
});

describe('resolveLabels', () => {
  const tags = [
    { id: 'b', name: '@PHONE', deletedAt: null },
    { id: 'a', name: '@phone', deletedAt: null },
    { id: 'z', name: '@gone', deletedAt: '2026-09-01T00:00:00Z' },
  ];

  it('reuses a tag by name key, picking the lowest id among duplicates', () => {
    const labels = resolveLabels(
      { project: undefined, tags: ['@Phone'] },
      { projects: [], tags },
      ids(),
      'T',
    );
    expect(labels).toEqual({
      projectId: null,
      tagIds: ['a'],
      creates: [],
      created: [],
    });
  });

  it('creates an unknown tag, and a deleted one counts as unknown', () => {
    const labels = resolveLabels(
      { project: undefined, tags: ['@gone'] },
      { projects: [], tags },
      ids(),
      'T',
    );
    expect(labels.tagIds).toEqual(['n1']);
    expect(labels.creates).toEqual([
      {
        opId: 'n2',
        kind: 'create',
        table: 'tag',
        id: 'n1',
        fields: { name: '@gone' },
        ts: 'T',
      },
    ]);
    expect(labels.created).toEqual(['@gone']);
  });

  it('counts a tag named twice in one add once', () => {
    const labels = resolveLabels(
      { project: undefined, tags: ['@home', '@Home'] },
      { projects: [], tags: [] },
      ids(),
      'T',
    );
    expect(labels.tagIds).toEqual(['n1']);
    expect(labels.creates).toHaveLength(1);
  });

  it('ignores an archived project and creates a new one', () => {
    const projects = [
      {
        id: 'p0',
        name: 'finance',
        archivedAt: '2026-01-01T00:00:00Z',
        deletedAt: null,
      },
    ];
    const labels = resolveLabels(
      { project: 'finance', tags: [] },
      { projects, tags: [] },
      ids(),
      'T',
    );
    expect(labels.projectId).toBe('n1');
    expect(labels.creates[0]).toMatchObject({
      table: 'project',
      id: 'n1',
      fields: { name: 'finance', rank: 'a0' },
    });
    expect(labels.created).toEqual(['#finance']);
  });

  it('reuses a live project', () => {
    const projects = [
      { id: 'p1', name: 'Finance', archivedAt: null, deletedAt: null },
    ];
    expect(
      resolveLabels(
        { project: 'finance', tags: [] },
        { projects, tags: [] },
        ids(),
        'T',
      ).projectId,
    ).toBe('p1');
  });
});

describe('labelsOf', () => {
  const rows = {
    projects: [{ id: 'p', name: 'finance', deletedAt: null }],
    tags: [
      { id: 'b', name: '@Phone', deletedAt: null },
      { id: 'a', name: '@phone', deletedAt: null },
      { id: 'c', name: '@home', deletedAt: null },
      { id: 'd', name: '@desk', deletedAt: '2026-09-01T00:00:00Z' },
    ],
    links: [
      { taskId: 't', tagId: 'b', deletedAt: null },
      { taskId: 't', tagId: 'a', deletedAt: null },
      { taskId: 't', tagId: 'c', deletedAt: null, attached: false },
      { taskId: 't', tagId: 'd', deletedAt: null },
      { taskId: 'u', tagId: 'c', deletedAt: null },
    ],
  };

  it("lists a task's project and attached live tags, a duplicate pair once in the winner's spelling", () => {
    expect(labelsOf({ id: 't', projectId: 'p' }, rows)).toEqual({
      project: 'finance',
      tags: ['@phone'],
    });
  });

  it('has no project for a task without one or with a deleted one', () => {
    expect(labelsOf({ id: 'u', projectId: null }, rows)).toEqual({
      project: null,
      tags: ['@home'],
    });
  });
});
