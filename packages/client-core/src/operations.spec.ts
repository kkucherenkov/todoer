import { describe, expect, it } from 'vitest';
import {
  ALL_OPEN,
  boardTasks,
  catalog,
  listTasks,
  taskDetails,
  viewTasks,
} from './operations.js';
import type { Row, Store } from './store.js';
import { openStore } from './test-store.js';

const TODAY = '2026-10-02';

let seq = 0;
function put(store: Store, table: string, row: Record<string, unknown>): void {
  seq += 1;
  store.mergeChanges([
    {
      table,
      id: String(row.id),
      seq,
      row: { deletedAt: null, ...row },
    },
  ]);
}

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  priority: 0,
  rank: 'a0',
  ...extra,
});

function closeAt(store: Store, id: string, closedOn: string) {
  put(store, 'task_occurrence', {
    id: `${id}-occ`,
    taskId: id,
    occurrence: null,
    state: 'done',
    fieldTs: { state: `${closedOn}T10:00:00.000Z` },
  });
}

function boardStore(): Store {
  const store = openStore(':memory:');
  put(store, 'status', {
    id: 's1',
    name: 'Todo',
    rank: 'a0',
    completing: false,
  });
  put(store, 'status', {
    id: '20000000-0000-4000-8000-000000000000',
    name: 'Done',
    rank: 'a1',
    completing: true,
  });
  return store;
}

const ids = (items: Row[]) => items.map((i) => i.id);

describe('viewTasks', () => {
  it('lists open tasks by rank then id and hides a done one-off task', () => {
    const store = openStore(':memory:');
    put(store, 'task', task('b', { rank: 'a1' }));
    put(store, 'task', task('c', { rank: 'a0' }));
    put(store, 'task', task('a', { rank: 'a0' }));
    put(store, 'task', task('d'));
    closeAt(store, 'd', TODAY);
    expect(ids(viewTasks(store, TODAY, ALL_OPEN))).toEqual(['a', 'c', 'b']);
  });

  it('filters by tag, by no project and by overdue', () => {
    const store = openStore(':memory:');
    put(store, 'tag', {
      id: '30000000-0000-4000-8000-000000000000',
      name: 'work',
    });
    put(store, 'project', { id: 'p1', name: 'home', rank: 'a0' });
    put(store, 'task', task('a', { dueOn: '2026-10-01' }));
    put(store, 'task', task('b', { projectId: 'p1', dueOn: '2026-10-05' }));
    put(store, 'task_tag', {
      id: 'l1',
      taskId: 'b',
      tagId: '30000000-0000-4000-8000-000000000000',
      attached: true,
    });
    const view = (filter: unknown) => ({ ...ALL_OPEN, filter });
    expect(
      ids(
        viewTasks(
          store,
          TODAY,
          view({ tag: '30000000-0000-4000-8000-000000000000' }),
        ),
      ),
    ).toEqual(['b']);
    expect(ids(viewTasks(store, TODAY, view({ project: null })))).toEqual([
      'a',
    ]);
    expect(ids(viewTasks(store, TODAY, view({ due: { to: -1 } })))).toEqual([
      'a',
    ]);
  });

  it('sorts by priority (4 first) and due (nulls last), ending in rank then id', () => {
    const store = openStore(':memory:');
    put(store, 'task', task('a', { priority: 1, dueOn: '2026-10-09' }));
    put(store, 'task', task('b', { priority: 4 }));
    put(store, 'task', task('c', { priority: 1, dueOn: '2026-10-03' }));
    put(
      store,
      'task',
      task('d', { priority: 1, dueOn: '2026-10-03', rank: 'a1' }),
    );
    const sorted = (sort: string) =>
      ids(viewTasks(store, TODAY, { ...ALL_OPEN, sort }));
    expect(sorted('priority')).toEqual(['b', 'a', 'c', 'd']);
    expect(sorted('due')).toEqual(['c', 'd', 'a', 'b']);
  });

  it('lists a recurring task once at its current occurrence', () => {
    const store = openStore(':memory:');
    put(
      store,
      'task',
      task('r', { rrule: 'FREQ=DAILY', dtstart: '2026-09-30' }),
    );
    const items = viewTasks(store, TODAY, ALL_OPEN);
    expect(items.map((i) => [i.id, i.occurrence])).toEqual([['r', TODAY]]);
    const scheduled = {
      ...ALL_OPEN,
      filter: { scheduled: { from: 0, to: 0 } },
    };
    expect(ids(viewTasks(store, TODAY, scheduled))).toEqual(['r']);
  });

  it('refuses an invalid filter', () => {
    const store = openStore(':memory:');
    expect(() =>
      viewTasks(store, TODAY, { ...ALL_OPEN, filter: { tag: 1, x: 2 } }),
    ).toThrow(/invalid filter/);
  });
});

describe('boardTasks', () => {
  it('puts a one-off task done today in the completing column, closed', () => {
    const store = boardStore();
    put(store, 'task', task('a'));
    closeAt(store, 'a', TODAY);
    const [item] = boardTasks(store, TODAY, ALL_OPEN);
    expect(item).toMatchObject({
      id: 'a',
      column: '20000000-0000-4000-8000-000000000000',
      closed: true,
    });
    // the facts carry the column, so a status filter sees it
    const inDone = {
      ...ALL_OPEN,
      filter: { status: '20000000-0000-4000-8000-000000000000' },
    };
    expect(ids(boardTasks(store, TODAY, inDone))).toEqual(['a']);
  });

  it('drops a one-off task closed 8 days ago but keeps one closed 7 days ago', () => {
    const store = boardStore();
    put(store, 'task', task('old'));
    put(store, 'task', task('edge'));
    closeAt(store, 'old', '2026-09-24');
    closeAt(store, 'edge', '2026-09-25');
    expect(ids(boardTasks(store, TODAY, ALL_OPEN))).toEqual(['edge']);
  });

  it('counts a mark still in the outbox as now', () => {
    const store = boardStore();
    put(store, 'task', task('a'));
    put(store, 'task_occurrence', {
      id: 'a-occ',
      taskId: 'a',
      occurrence: null,
      state: 'done',
    });
    expect(ids(boardTasks(store, TODAY, ALL_OPEN))).toEqual(['a']);
  });

  it('shows a recurring task done today open in the first status', () => {
    const store = boardStore();
    put(
      store,
      'task',
      task('r', {
        rrule: 'FREQ=DAILY',
        dtstart: '2026-09-30',
        statusId: '20000000-0000-4000-8000-000000000000',
      }),
    );
    put(store, 'task_occurrence', {
      id: 'r1',
      taskId: 'r',
      occurrence: TODAY,
      state: 'done',
    });
    const [item] = boardTasks(store, TODAY, ALL_OPEN);
    expect(item).toMatchObject({
      id: 'r',
      occurrence: '2026-10-03',
      column: 's1',
      closed: false,
    });
  });

  it('shows a task whose status was deleted in the first status (Q8)', () => {
    const store = boardStore();
    put(store, 'status', {
      id: '10000000-0000-4000-8000-000000000000',
      name: 'Gone',
      rank: 'a00',
      completing: false,
      deletedAt: '2026-10-01',
    });
    put(
      store,
      'task',
      task('a', { statusId: '10000000-0000-4000-8000-000000000000' }),
    );
    expect(boardTasks(store, TODAY, ALL_OPEN)[0]?.column).toBe('s1');
  });

  it('picks the lowest id among completing statuses (Q9)', () => {
    const store = boardStore();
    put(store, 'status', {
      id: '10000000-0000-4000-8000-000000000000',
      name: 'Done too',
      rank: 'a2',
      completing: true,
    });
    put(store, 'task', task('a'));
    closeAt(store, 'a', TODAY);
    expect(boardTasks(store, TODAY, ALL_OPEN)[0]?.column).toBe(
      '10000000-0000-4000-8000-000000000000',
    );
  });
});

describe('taskDetails', () => {
  it('is null for a deleted or unknown id', () => {
    const store = boardStore();
    put(store, 'task', task('a', { deletedAt: '2026-10-01' }));
    expect(taskDetails(store, TODAY, 'a')).toBeNull();
    expect(taskDetails(store, TODAY, 'nope')).toBeNull();
  });

  it('returns notes, rule and the column of a closed one-off task', () => {
    const store = boardStore();
    put(store, 'task', task('a', { notes: 'n' }));
    closeAt(store, 'a', '2026-01-01');
    expect(taskDetails(store, TODAY, 'a')).toMatchObject({
      id: 'a',
      notes: 'n',
      rrule: null,
      column: '20000000-0000-4000-8000-000000000000',
      closed: true,
    });
  });
});

describe('catalog', () => {
  it('flags a view with an invalid filter and orders views by rank then id', () => {
    const store = boardStore();
    put(store, 'view', {
      id: 'v2',
      name: 'B',
      layout: 'list',
      sort: 'manual',
      rank: 'a0',
      filter: { and: [] },
      version: 1,
    });
    put(store, 'view', {
      id: 'v1',
      name: 'A',
      layout: 'list',
      sort: 'manual',
      rank: 'a0',
      filter: { tag: 'X' },
    });
    const { views, statuses } = catalog(store);
    expect(views.map((v) => [v.id, v.problem === null])).toEqual([
      ['v1', false],
      ['v2', true],
    ]);
    expect(views[1]?.version).toBe(1);
    expect(statuses.map((s) => [s.id, s.completing])).toEqual([
      ['s1', false],
      ['20000000-0000-4000-8000-000000000000', true],
    ]);
  });
});

describe('listTasks', () => {
  it('keeps the store order without a view and sorts with one', () => {
    const store = openStore(':memory:');
    put(store, 'task', task('b', { rank: 'a1' }));
    put(store, 'task', task('a', { rank: 'a2', priority: 4 }));
    put(store, 'view', {
      id: 'v',
      name: 'Hot',
      layout: 'list',
      sort: 'priority',
      rank: 'a0',
      filter: { and: [] },
    });
    expect(ids(listTasks(store, TODAY, [], undefined))).toEqual(['b', 'a']);
    expect(ids(listTasks(store, TODAY, [], 'hot'))).toEqual(['a', 'b']);
    expect(
      Object.keys(listTasks(store, TODAY, [], undefined)[0] ?? {}),
    ).not.toContain('closed');
  });
});
