import { beforeEach, describe, expect, it } from 'vitest';
import {
  taskOccurrenceId,
  taskTagId,
  type Change,
  type Op,
} from '@todoer/specs';
import {
  ALL_OPEN,
  add,
  boardTasks,
  calendarTasks,
  catalog,
  deleteStatus,
  deleteTask,
  deleteView,
  editTask,
  listTasks,
  mark,
  moveOccurrence,
  moveTask,
  saveStatus,
  saveView,
  seedStatuses,
  setCompleting,
  submit,
  taskDetails,
  undoMove,
  viewTasks,
  type Core,
} from './operations.js';
import { UsageError } from './protocol.js';
import type { Row, Store } from './store.js';
import type { Transport } from './sync.js';
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

describe('taskDetails of an ended series', () => {
  it('returns a live recurring task with no occurrence left, closed', () => {
    const store = boardStore();
    put(
      store,
      'task',
      task('a', { rrule: 'FREQ=DAILY;COUNT=1', dtstart: '2026-01-01' }),
    );
    put(store, 'task_occurrence', {
      id: 'a-occ',
      taskId: 'a',
      occurrence: '2026-01-01',
      state: 'done',
    });
    expect(viewTasks(store, TODAY, ALL_OPEN)).toEqual([]);
    expect(taskDetails(store, TODAY, 'a')).toMatchObject({
      id: 'a',
      rrule: 'FREQ=DAILY;COUNT=1',
      occurrence: null,
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

  it('counts the live tasks on each status, as deleteStatus moves them', () => {
    const store = boardStore();
    put(store, 'task', task('a', { statusId: 's1' }));
    put(store, 'task', task('b', { statusId: 's1' }));
    put(store, 'task', task('c', { statusId: 's1', deletedAt: 'x' }));
    put(store, 'task', task('d', { statusId: null }));
    expect(catalog(store).statuses.map((s) => [s.id, s.tasks])).toEqual([
      ['s1', 2],
      ['20000000-0000-4000-8000-000000000000', 0],
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

const DONE = '20000000-0000-4000-8000-000000000000';

/** A server that applies every op to its own rows and answers with the
 *  changes; `offline` makes the transport reject like a dead network. */
function fakeServer() {
  const sent: Op[] = [];
  const rows = new Map<string, Row>();
  const state = { offline: false };
  // above any seq `put` hands out, so the server's rows win the merge
  let seq = 100_000;
  const send: Transport = (request) => {
    if (state.offline) return Promise.reject(new TypeError('fetch failed'));
    const changes: Change[] = [];
    const results = request.ops.map((op) => {
      sent.push(op);
      const key = `${op.table}:${op.id}`;
      const current = rows.get(key);
      let next: Row;
      if (op.kind === 'create') {
        next = { ...current, ...op.fields, id: op.id, deletedAt: null };
      } else if (op.kind === 'set') {
        next = { ...current, [op.field]: op.value };
      } else {
        next = { ...current, deletedAt: 'deleted' };
      }
      rows.set(key, next);
      changes.push({ table: op.table, id: op.id, seq: (seq += 1), row: next });
      return { opId: op.opId, status: 'applied' as const };
    });
    return Promise.resolve(
      new Response(JSON.stringify({ cursor: seq, results, changes }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { sent, rows, state, send };
}

function coreOf(store: Store, send: Transport): Core {
  let n = 0;
  return {
    store,
    send,
    now: () => new Date('2026-10-02T12:00:00'),
    newId: () => `id-${(n += 1)}`,
  };
}

const mint = (opId: string, id?: string) =>
  id === undefined ? { opId } : { opId, id };
const sets = (store: Store, field: string) =>
  store
    .pending()
    .filter((op) => op.kind === 'set' && op.field === field)
    .map((op) => (op.kind === 'set' ? [op.id, op.value] : []));

describe('replay guard', () => {
  const op: Op = {
    opId: 'o1',
    kind: 'create',
    table: 'task',
    id: 't',
    fields: { title: 'x', rank: 'a0' },
    ts: '2026-10-02T00:00:00.000Z',
  };

  it('queues a keyed command once however often it is submitted', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    // a crash after the enqueue (mutation checks inject one) is survivable
    await submit(store, srv.send, [op], 'x', 'k1').catch(() => undefined);
    await submit(store, srv.send, [{ ...op, opId: 'o2' }], 'x', 'k1');
    expect(store.pending().map((o) => o.opId)).toEqual(['o1']);
  });

  it('writes the claim inside the enqueue transaction, so a crash after commit loses neither', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    const real = store.transaction.bind(store);
    let crash = true;
    store.transaction = (fn) => {
      const result = real(fn);
      if (crash) {
        crash = false;
        throw new Error('crash after commit');
      }
      return result;
    };
    await expect(submit(store, srv.send, [op], 'x', 'k1')).rejects.toThrow(
      'crash after commit',
    );
    await submit(store, srv.send, [op], 'x', 'k1');
    expect(store.pending().map((o) => o.opId)).toEqual(['o1']);
  });

  it('writes the claim only when the ops are queued with it', () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    return submit(
      store,
      srv.send,
      () => {
        throw new Error('boom');
      },
      'x',
      'k1',
    ).then(
      () => expect.unreachable(),
      () => {
        expect(store.seen('k1')).toBe(false);
        expect(store.pending()).toEqual([]);
      },
    );
  });

  it('add with minted ids creates the task once, even after the ops settled', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    const core = coreOf(store, srv.send);
    const first = await add(
      core,
      'Buy milk #Home @err',
      {},
      mint('m1', 't-new'),
    );
    expect(first.task?.id).toBe('t-new');
    expect(srv.sent.map((o) => o.opId)).toContain('m1');
    expect(store.pending()).toEqual([]);
    const sentBefore = srv.sent.length;

    const again = await add(
      core,
      'Buy milk #Home @err',
      {},
      mint('m1', 't-new'),
    );
    expect(srv.sent).toHaveLength(sentBefore);
    expect(again.synced).toBe(true);
    expect(again.task?.id).toBe('t-new');
    expect(store.rows('task')).toHaveLength(1);
    expect(store.rows('project')).toHaveLength(1);
    expect(store.rows('tag')).toHaveLength(1);
  });

  it('answers a replayed undo like the first one instead of "nothing to undo"', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    const core = coreOf(store, srv.send);
    put(store, 'task', task('abcd0001'));
    put(store, 'task_occurrence', {
      id: taskOccurrenceId('abcd0001', null),
      taskId: 'abcd0001',
      occurrence: null,
      state: 'done',
    });
    const first = await mark(core, 'undo', 'abcd0001', undefined, mint('u1'));
    expect(first.synced).toBe(true);
    expect(srv.sent).toHaveLength(1);
    expect(store.rows('task_occurrence')).toMatchObject([{ state: 'open' }]);
    const again = await mark(core, 'undo', 'abcd0001', undefined, mint('u1'));
    expect(again.synced).toBe(true);
    expect(srv.sent).toHaveLength(1);
  });

  it('flushes a replayed mark whose task was deleted since, instead of "no task"', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    const core = coreOf(store, srv.send);
    put(store, 'task', task('abcd0001'));
    await mark(core, 'done', 'abcd0001', undefined, mint('d1'));
    put(store, 'task', task('abcd0001', { deletedAt: '2026-10-02' }));
    srv.state.offline = false;
    const again = await mark(core, 'done', 'abcd0001', undefined, mint('d1'));
    expect(again.synced).toBe(true);
    expect(store.pending()).toEqual([]);
  });
});

describe('editTask', () => {
  function offline(extra: Record<string, unknown> = {}) {
    const store = boardStore();
    const srv = fakeServer();
    srv.state.offline = true;
    put(store, 'task', task('t1', extra));
    return { store, core: coreOf(store, srv.send) };
  }
  const refused = (changes: Parameters<typeof editTask>[3], extra = {}) => {
    const { store, core } = offline(extra);
    return expect(editTask(core, mint('e1'), 't1', changes)).rejects.toSatisfy(
      (e) => e instanceof UsageError && store.pending().length === 0,
    );
  };

  it('refuses a blank title, priority 5, a date on a recurring task and 2026-02-30', async () => {
    await refused({ title: '  ' });
    await refused({ priority: 5 });
    await refused(
      { scheduledOn: '2026-10-05' },
      { rrule: 'FREQ=DAILY', dtstart: '2026-09-30' },
    );
    await refused({ dueOn: '2026-02-30' });
  });

  it('writes one set per changed field and nothing for an unchanged one', async () => {
    const { store, core } = offline({ notes: 'keep' });
    const result = await editTask(core, mint('e1'), 't1', {
      title: ' New ',
      notes: 'keep',
      priority: 3,
      dueOn: '2026-10-09',
    });
    expect(result.synced).toBe(false);
    expect(store.pending().map((o) => o.kind === 'set' && o.field)).toEqual([
      'title',
      'priority',
      'dueOn',
    ]);
    expect(store.pending()[0]?.opId).toBe('e1');
    expect(sets(store, 'title')).toEqual([['t1', 'New']]);
  });

  it('turns empty notes into null', async () => {
    const { store, core } = offline({ notes: 'x' });
    await editTask(core, mint('e1'), 't1', { notes: '' });
    expect(sets(store, 'notes')).toEqual([['t1', null]]);
  });

  it('creates a missing project and sets projectId in one batch; null detaches', async () => {
    const { store, core } = offline();
    await editTask(core, mint('e1'), 't1', { project: 'New' });
    const [create] = store.pending();
    expect(create).toMatchObject({ kind: 'create', table: 'project' });
    expect(sets(store, 'projectId')).toEqual([['t1', create?.id]]);
    await editTask(core, mint('e2'), 't1', { project: null });
    expect(sets(store, 'projectId').at(-1)).toEqual(['t1', null]);
  });

  it('attaches the new tag and detaches the gone one, by name', async () => {
    const { store, core } = offline();
    put(store, 'tag', { id: 'ta', name: '@a' });
    put(store, 'tag', { id: 'tb', name: '@b' });
    for (const tag of ['ta', 'tb']) {
      put(store, 'task_tag', {
        id: taskTagId('t1', tag),
        taskId: 't1',
        tagId: tag,
        attached: true,
      });
    }
    await editTask(core, mint('e1'), 't1', { tags: ['@a', '@c'] });
    const ops = store.pending();
    const created = ops.filter(
      (o) => o.kind === 'create' && o.table === 'task_tag',
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ fields: { taskId: 't1' } });
    expect(
      ops.filter((o) => o.kind === 'set' && o.table === 'task_tag'),
    ).toEqual([
      expect.objectContaining({
        id: taskTagId('t1', 'tb'),
        field: 'attached',
        value: false,
      }),
    ]);
  });

  it('does nothing when its opId was already claimed', async () => {
    const { store, core } = offline();
    await editTask(core, mint('e1'), 't1', { priority: 2 });
    await editTask(core, mint('e1'), 't1', { priority: 3 });
    expect(sets(store, 'priority')).toEqual([['t1', 2]]);
  });
});

describe('moveTask', () => {
  function offline(rows: Array<[string, Record<string, unknown>]> = []) {
    const store = boardStore();
    put(store, 'status', {
      id: 's2',
      name: 'Doing',
      rank: 'a05',
      completing: false,
    });
    const srv = fakeServer();
    srv.state.offline = true;
    for (const [table, row] of rows) put(store, table, row);
    return { store, core: coreOf(store, srv.send) };
  }
  const occurrenceOps = (store: Store) =>
    store
      .pending()
      .filter((o) => o.kind === 'create' && o.table === 'task_occurrence')
      .map((o) => (o.kind === 'create' ? o.fields : {}));

  it('marks an open one-off done and sets the completing status', async () => {
    const { store, core } = offline([['task', task('a')]]);
    const result = await moveTask(core, mint('m1'), 'a', { statusId: DONE });
    expect(result).toMatchObject({ synced: false, marked: 'done' });
    expect(occurrenceOps(store)).toMatchObject([
      { state: 'done', occurrence: null },
    ]);
    expect(sets(store, 'statusId')).toEqual([['a', DONE]]);
    expect(store.pending().some((o) => o.opId === 'm1')).toBe(true);
  });

  it('marks a recurring task done at the current occurrence, open at the next', async () => {
    const { store, core } = offline([
      ['task', task('r', { rrule: 'FREQ=DAILY', dtstart: '2026-09-30' })],
    ]);
    const result = await moveTask(core, mint('m1'), 'r', { statusId: DONE });
    expect(result).toMatchObject({ marked: 'done', occurrence: TODAY });
    expect(occurrenceOps(store)).toMatchObject([
      { state: 'done', occurrence: TODAY },
    ]);
    expect(sets(store, 'statusId')).toEqual([['r', DONE]]);
    const [item] = boardTasks(store, TODAY, ALL_OPEN);
    expect(item).toMatchObject({
      occurrence: '2026-10-03',
      column: 's1',
      closed: false,
    });
  });

  it('reopens a closed one-off with undo and exactly one statusId write', async () => {
    const { store, core } = offline([
      ['task', task('a', { statusId: DONE })],
      [
        'task_occurrence',
        { id: 'a-occ', taskId: 'a', occurrence: null, state: 'done' },
      ],
    ]);
    const result = await moveTask(core, mint('m1'), 'a', { statusId: 's2' });
    expect(result.marked).toBe('undo');
    expect(occurrenceOps(store)).toMatchObject([{ state: 'open' }]);
    expect(sets(store, 'statusId')).toEqual([['a', 's2']]);
  });

  it('treats moving a skipped one-off into the completing column as a rank move', async () => {
    const { store, core } = offline([
      ['task', task('a', { statusId: DONE })],
      [
        'task_occurrence',
        { id: 'a-occ', taskId: 'a', occurrence: null, state: 'skipped' },
      ],
    ]);
    const result = await moveTask(core, mint('m1'), 'a', {
      statusId: DONE,
      ranks: [{ id: 'a', rank: 'a3' }],
    });
    expect(result.marked).toBeNull();
    expect(occurrenceOps(store)).toEqual([]);
    expect(sets(store, 'statusId')).toEqual([]);
    expect(sets(store, 'rank')).toEqual([['a', 'a3']]);
  });

  it('with two completing statuses only the lowest id closes a task', async () => {
    const { store, core } = offline([['task', task('a')]]);
    put(store, 'status', {
      id: '0-also-done',
      name: 'Also done',
      rank: 'a3',
      completing: true,
    });
    const other = await moveTask(core, mint('m1'), 'a', { statusId: DONE });
    expect(other.marked).toBeNull();
    expect(occurrenceOps(store)).toEqual([]);
    const lowest = await moveTask(core, mint('m2'), 'a', {
      statusId: '0-also-done',
    });
    expect(lowest.marked).toBe('done');
  });

  it('moves between plain statuses with one set, plus the rank writes', async () => {
    const { store, core } = offline([
      ['task', task('a')],
      ['task', task('b')],
    ]);
    const result = await moveTask(core, mint('m1'), 'a', {
      statusId: 's2',
      ranks: [
        { id: 'a', rank: 'a1' },
        { id: 'b', rank: 'a2' },
      ],
    });
    expect(result.marked).toBeNull();
    expect(store.pending()[0]?.opId).toBe('m1');
    expect(sets(store, 'statusId')).toEqual([['a', 's2']]);
    expect(sets(store, 'rank')).toEqual([
      ['a', 'a1'],
      ['b', 'a2'],
    ]);
    expect(occurrenceOps(store)).toEqual([]);
  });

  it('reorders only when statusId is undefined', async () => {
    const { store, core } = offline([['task', task('a')]]);
    await moveTask(core, mint('m1'), 'a', { ranks: [{ id: 'a', rank: 'a7' }] });
    expect(sets(store, 'statusId')).toEqual([]);
    expect(sets(store, 'rank')).toEqual([['a', 'a7']]);
  });

  it('refuses a deleted status', async () => {
    const { store, core } = offline([
      ['task', task('a')],
      [
        'status',
        {
          id: 'gone',
          name: 'G',
          rank: 'a2',
          completing: false,
          deletedAt: '2026-10-01',
        },
      ],
    ]);
    await expect(
      moveTask(core, mint('m1'), 'a', { statusId: 'gone' }),
    ).rejects.toBeInstanceOf(UsageError);
    expect(store.pending()).toEqual([]);
  });

  it('seeds the statuses when the user has none, as mark does', async () => {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    put(store, 'task', task('a'));
    const core = coreOf(store, srv.send);
    const result = await moveTask(core, mint('m1'), 'a', { statusId: 'done' });
    expect(result.marked).toBe('done');
    const creates = store
      .pending()
      .filter((o) => o.kind === 'create' && o.table === 'status');
    expect(creates).toHaveLength(3);
    expect(sets(store, 'statusId')).toEqual([['a', creates[2]?.id]]);
  });

  it('is a no-op the second time its opId is seen', async () => {
    const { store, core } = offline([['task', task('a')]]);
    await moveTask(core, mint('m1'), 'a', { statusId: DONE });
    const queued = store.pending().length;
    const again = await moveTask(core, mint('m1'), 'a', { statusId: DONE });
    expect(again.synced).toBe(false);
    expect(store.pending()).toHaveLength(queued);
  });
});

describe('views and statuses', () => {
  function offline(rows: Array<[string, Record<string, unknown>]> = []) {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    for (const [table, row] of rows) put(store, table, row);
    return { store, core: coreOf(store, srv.send) };
  }
  const view = (id: string, extra: Record<string, unknown> = {}) =>
    [
      'view',
      {
        id,
        name: id,
        layout: 'list',
        sort: 'manual',
        filter: { and: [] },
        rank: 'a0',
        version: 1,
        ...extra,
      },
    ] as [string, Record<string, unknown>];
  const status = (id: string, extra: Record<string, unknown> = {}) =>
    [
      'status',
      { id, name: id, rank: 'a0', completing: false, version: 1, ...extra },
    ] as [string, Record<string, unknown>];
  const fields: Parameters<typeof saveView>[2] = {
    name: 'Work',
    layout: 'kanban',
    sort: 'priority',
    filter: { and: [] },
  };
  const pendingOf = (store: Store, kind: string) =>
    store.pending().filter((o) => o.kind === kind);

  it('creates a view ranked after the last one', async () => {
    const { store, core } = offline([view('v1', { rank: 'a5' })]);
    await saveView(core, { opId: 'o1', id: 'v2' }, fields);
    const [op] = store.pending();
    expect(op).toMatchObject({
      opId: 'o1',
      kind: 'create',
      table: 'view',
      id: 'v2',
      fields: { ...fields },
    });
    expect(op?.kind === 'create' && String(op.fields.rank) > 'a5').toBe(true);
  });

  it('writes one set for the one field an update changes', async () => {
    const { store, core } = offline([view('v1')]);
    await saveView(
      core,
      { opId: 'o1', id: 'v1' },
      {
        name: 'v1',
        layout: 'list',
        sort: 'due',
        filter: { and: [] },
      },
    );
    expect(store.pending()).toMatchObject([
      {
        opId: 'o1',
        kind: 'set',
        table: 'view',
        id: 'v1',
        field: 'sort',
        value: 'due',
      },
    ]);
  });

  it('refuses a filter with a problem, a duplicate name, a bad layout or sort', async () => {
    const { core, store } = offline([view('v1', { name: 'Work' })]);
    await expect(
      saveView(
        core,
        { opId: 'o1', id: 'v2' },
        { ...fields, name: 'x', filter: { tag: 'Work' } },
      ),
    ).rejects.toThrow(UsageError);
    await expect(
      saveView(core, { opId: 'o2', id: 'v2' }, { ...fields, name: ' WORK ' }),
    ).rejects.toThrow(UsageError);
    await expect(
      saveView(core, { opId: 'o3', id: 'v2' }, { ...fields, name: ' ' }),
    ).rejects.toThrow(UsageError);
    await expect(
      saveView(
        core,
        { opId: 'o4', id: 'v2' },
        { ...fields, layout: 'grid' as 'list' },
      ),
    ).rejects.toThrow(UsageError);
    await expect(
      saveView(
        core,
        { opId: 'o5', id: 'v2' },
        { ...fields, sort: 'x' as 'due' },
      ),
    ).rejects.toThrow(UsageError);
    expect(store.pending()).toEqual([]);
  });

  it('carries the filterProblem text in the refusal', async () => {
    const { core } = offline();
    await expect(
      saveView(
        core,
        { opId: 'o1', id: 'v2' },
        { ...fields, filter: { tag: 'Work' } },
      ),
    ).rejects.toThrow(/filter/i);
  });

  it('refuses to delete a view that is not synced yet and deletes a synced one with its version', async () => {
    const { store, core } = offline([view('v1', { version: 3 })]);
    await saveView(core, { opId: 'o0', id: 'v2' }, fields);
    await expect(deleteView(core, { opId: 'o1' }, 'v2')).rejects.toThrow(
      /not synced yet/,
    );
    await deleteView(core, { opId: 'o2' }, 'v1');
    expect(pendingOf(store, 'delete')).toMatchObject([
      { opId: 'o2', table: 'view', id: 'v1', baseVersion: 3 },
    ]);
  });

  it('writes nothing for a view whose filter only reorders keys', async () => {
    const filter = { scheduled: { from: 0, to: 3 } };
    const { store, core } = offline([view('v1', { filter })]);
    await saveView(
      core,
      { opId: 'o1', id: 'v1' },
      {
        name: 'v1',
        layout: 'list',
        sort: 'manual',
        filter: { scheduled: { to: 3, from: 0 } },
      },
    );
    expect(store.pending()).toEqual([]);
  });

  it('writes exactly one set name for a status rename', async () => {
    const { store, core } = offline([status('s1')]);
    await saveStatus(core, { opId: 'o1', id: 's1' }, { name: 'Todo' });
    expect(store.pending()).toMatchObject([
      { kind: 'set', id: 's1', field: 'name', value: 'Todo' },
    ]);
  });

  it('creates a status between neighbours and reorders to first', async () => {
    const { store, core } = offline([
      status('s1', { rank: 'a0' }),
      status('s2', { rank: 'a1' }),
    ]);
    await saveStatus(
      core,
      { opId: 'o1', id: 'n' },
      { name: 'Review', after: 's1' },
    );
    const [op] = store.pending();
    const rank = op?.kind === 'create' ? String(op.fields.rank) : '';
    expect(rank > 'a0' && rank < 'a1').toBe(true);
    await saveStatus(core, { opId: 'o2', id: 's2' }, { after: null });
    const last = store.pending().at(-1)!;
    expect(last).toMatchObject({ kind: 'set', id: 's2', field: 'rank' });
    expect(last.kind === 'set' && String(last.value) < 'a0').toBe(true);
  });

  it('refuses a status renamed to an existing name', async () => {
    const { core } = offline([status('s1', { name: 'Todo' }), status('s2')]);
    await expect(
      saveStatus(core, { opId: 'o1', id: 's2' }, { name: ' todo' }),
    ).rejects.toThrow(UsageError);
  });

  it('keeps exactly one completing status', async () => {
    const { store, core } = offline([
      status('s1', { completing: true }),
      status('s2', { completing: true, rank: 'a1' }),
      status('s3', { rank: 'a2' }),
    ]);
    await setCompleting(core, { opId: 'o1' }, 's3');
    expect(sets(store, 'completing')).toEqual([
      ['s1', false],
      ['s2', false],
      ['s3', true],
    ]);
  });

  it('deletes a status in one batch after moving its tasks off it', async () => {
    const { store, core } = offline([
      status('s1'),
      status('s2', { rank: 'a1' }),
      status('s3', { rank: 'a2', completing: true }),
      ['task', task('a', { statusId: 's2' })],
      ['task', task('b', { statusId: 's2' })],
      ['task', task('c', { statusId: 's2' })],
      ['task', task('d', { statusId: 's1' })],
    ]);
    let submits = 0;
    const real = store.transaction.bind(store);
    store.transaction = ((fn: () => unknown) => {
      submits += 1;
      return real(fn);
    }) as typeof store.transaction;
    await deleteStatus(core, { opId: 'o1' }, 's2');
    expect(submits).toBe(1);
    expect(
      store
        .pending()
        .map((o) => [o.kind, o.id, o.kind === 'set' ? o.value : 0]),
    ).toEqual([
      ['set', 'a', null],
      ['set', 'b', null],
      ['set', 'c', null],
      ['delete', 's2', 0],
    ]);
  });

  it('refuses to delete the completing, the last open or an unsynced status', async () => {
    const { store, core } = offline([
      status('s1'),
      status('s2', { rank: 'a1', completing: true }),
    ]);
    await expect(deleteStatus(core, { opId: 'o2' }, 's1')).rejects.toThrow(
      /last open/,
    );
    put(store, 'status', {
      id: 's0',
      name: 's0',
      rank: 'a3',
      completing: false,
      version: 1,
    });
    await expect(deleteStatus(core, { opId: 'o1' }, 's2')).rejects.toThrow(
      /completing/,
    );
    expect(store.pending()).toEqual([]);
    put(store, 'status', {
      id: 's4',
      name: 'x',
      rank: 'a2',
      completing: false,
      deletedAt: null,
    });
    await saveStatus(core, { opId: 'o3', id: 's5' }, { name: 'New' });
    await expect(deleteStatus(core, { opId: 'o4' }, 's5')).rejects.toThrow(
      /not synced yet/,
    );
  });

  it('seeds Inbox, Doing, Done once, also over a tombstone', () => {
    const { store, core } = offline([status('old', { deletedAt: 'x' })]);
    expect(seedStatuses(core)).toBe(true);
    expect(
      store.pending().map((o) => o.kind === 'create' && o.fields),
    ).toMatchObject([
      { name: 'Inbox', completing: false },
      { name: 'Doing', completing: false },
      { name: 'Done', completing: true },
    ]);
    expect(seedStatuses(core)).toBe(false);
    expect(store.pending()).toHaveLength(3);
  });

  it('replays every operation to nothing', async () => {
    const { store, core } = offline([
      view('v1'),
      status('s1'),
      status('s2', { rank: 'a1', completing: true }),
      status('s3', { rank: 'a2' }),
    ]);
    const runs: Array<() => Promise<unknown>> = [
      () => saveView(core, { opId: 'r1', id: 'v9' }, fields),
      () => deleteView(core, { opId: 'r2' }, 'v1'),
      () => saveStatus(core, { opId: 'r3', id: 's9' }, { name: 'New' }),
      () => setCompleting(core, { opId: 'r4' }, 's3'),
      () => deleteStatus(core, { opId: 'r5' }, 's1'),
    ];
    for (const run of runs) {
      await run();
      const n = store.pending().length;
      await expect(run()).resolves.toBeDefined();
      expect(store.pending()).toHaveLength(n);
    }
    expect(store.pending().length).toBeGreaterThan(0);
  });
});

describe('calendarTasks', () => {
  const WED = '2026-10-07';
  const SPAN = { from: '2026-10-05', to: '2026-10-11' };
  const daily = (extra: Record<string, unknown> = {}) =>
    task('d', { rrule: 'FREQ=DAILY', dtstart: '2026-10-01', ...extra });
  const markAs = (id: string, occurrence: string | null, extra = {}) =>
    put(store, 'task_occurrence', {
      id: `${id}-${occurrence}`,
      taskId: id,
      occurrence,
      state: 'done',
      ...extra,
    });
  const read = (view = ALL_OPEN, span = SPAN) =>
    calendarTasks(store, WED, view, span);
  const days = (kind?: string) =>
    read()
      .placements.filter((p) => kind === undefined || p.kind === kind)
      .map((p) => p.date);
  let store: Store;
  beforeEach(() => {
    store = openStore(':memory:');
  });

  it('places a one-off task on its scheduled and due days', () => {
    put(
      store,
      'task',
      task('a', { scheduledOn: '2026-10-08', dueOn: '2026-10-10' }),
    );
    const { placements, items } = read();
    expect(placements).toEqual([
      {
        taskId: 'a',
        date: '2026-10-08',
        kind: 'scheduled',
        occurrence: null,
        closed: false,
      },
      {
        taskId: 'a',
        date: '2026-10-10',
        kind: 'due',
        occurrence: null,
        closed: false,
      },
    ]);
    expect(ids(items)).toEqual(['a']);
  });

  it('puts both placements on one day, scheduled first', () => {
    put(
      store,
      'task',
      task('a', { scheduledOn: '2026-10-08', dueOn: '2026-10-08' }),
    );
    expect(read().placements.map((p) => p.kind)).toEqual(['scheduled', 'due']);
  });

  it('shows a daily task from its current occurrence on', () => {
    put(store, 'task', daily());
    expect(days()).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    expect(read().placements[0]).toMatchObject({
      occurrence: WED,
      closed: false,
    });
  });

  it('shows a done occurrence closed while it is inside the window', () => {
    put(store, 'task', daily());
    markAs('d', '2026-10-06', {
      fieldTs: { state: '2026-10-01T10:00:00.000Z' },
    });
    markAs('d', '2026-10-05', {
      fieldTs: { state: '2026-09-29T10:00:00.000Z' },
    });
    expect(read().placements.filter((p) => p.closed)).toMatchObject([
      { date: '2026-10-06', occurrence: '2026-10-06' },
    ]);
  });

  it('counts a done occurrence still in the outbox as closed now', () => {
    put(store, 'task', daily());
    markAs('d', '2026-10-06');
    expect(days()).toContain('2026-10-06');
  });

  it('hides a skipped occurrence', () => {
    put(store, 'task', daily());
    markAs('d', '2026-10-09', { state: 'skipped' });
    expect(days()).not.toContain('2026-10-09');
  });

  it('gives a recurring task one due placement with no occurrence', () => {
    put(store, 'task', daily({ dueOn: '2026-10-10' }));
    expect(read().placements.filter((p) => p.kind === 'due')).toEqual([
      {
        taskId: 'd',
        date: '2026-10-10',
        kind: 'due',
        occurrence: null,
        closed: false,
      },
    ]);
  });

  it('places a subtask on its parent dates', () => {
    put(store, 'task', daily());
    put(store, 'task', task('s', { parentId: 'd' }));
    expect(
      read()
        .placements.filter((p) => p.taskId === 's')
        .map((p) => p.date),
    ).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('closes a one-off done inside the window and drops one outside', () => {
    put(store, 'task', task('a', { scheduledOn: '2026-10-08' }));
    put(store, 'task', task('b', { scheduledOn: '2026-10-08' }));
    markAs('a', null, { fieldTs: { state: `${WED}T10:00:00.000Z` } });
    markAs('b', null, { fieldTs: { state: '2026-09-29T10:00:00.000Z' } });
    expect(read().placements).toMatchObject([{ taskId: 'a', closed: true }]);
  });

  it('selects tasks with the filter', () => {
    put(store, 'task', daily());
    expect(
      read({
        ...ALL_OPEN,
        filter: { tag: '30000000-0000-4000-8000-000000000000' },
      }).placements,
    ).toEqual([]);
  });

  it('keeps every day of a recurring task under a today-only filter', () => {
    put(store, 'task', daily());
    const view = { ...ALL_OPEN, filter: { scheduled: { from: 0, to: 0 } } };
    const span = { from: '2026-10-05', to: '2026-11-15' };
    expect(read(view, span).placements.map((p) => p.date)).toHaveLength(40);
  });

  it('orders by date, then the view order', () => {
    put(store, 'task', task('a', { rank: 'a1', scheduledOn: '2026-10-08' }));
    put(store, 'task', task('b', { rank: 'a0', scheduledOn: '2026-10-08' }));
    put(store, 'task', task('c', { rank: 'a2', scheduledOn: '2026-10-07' }));
    expect(read().placements.map((p) => p.taskId)).toEqual(['c', 'b', 'a']);
  });

  it('lists only tasks with a placement in the span', () => {
    put(store, 'task', task('in', { scheduledOn: '2026-10-08' }));
    put(store, 'task', task('out', { scheduledOn: '2026-12-08' }));
    expect(ids(read().items)).toEqual(['in']);
  });

  it.each([
    { from: '2026-10-11', to: '2026-10-05' },
    { from: '2026-10-01', to: '2026-11-12' },
    { from: '2026-02-30', to: '2026-03-02' },
  ])('refuses span %j', (span) => {
    expect(() => read(ALL_OPEN, span)).toThrow(UsageError);
  });

  it('accepts a 42-day span', () => {
    expect(() =>
      read(ALL_OPEN, { from: '2026-10-01', to: '2026-11-11' }),
    ).not.toThrow();
  });

  it('refuses an invalid filter', () => {
    expect(() => read({ ...ALL_OPEN, filter: { nope: 1 } })).toThrow(
      /invalid filter/,
    );
  });
});

describe('moveOccurrence and undoMove', () => {
  const FROM = '2026-10-08';
  const TO = '2026-10-10';
  const SPAN = { from: '2026-10-05', to: '2026-10-11' };
  const daily = (extra: Record<string, unknown> = {}) =>
    task('d', {
      rrule: 'FREQ=DAILY',
      dtstart: '2026-10-01',
      title: 'Water plants',
      notes: 'twice',
      projectId: 'p1',
      priority: 3,
      statusId: 's1',
      rank: 'a5',
      dueOn: '2026-10-20',
      ...extra,
    });
  const on = (store: Store) =>
    calendarTasks(store, TODAY, ALL_OPEN, SPAN).placements.map(
      (p) => `${p.taskId}@${p.date}`,
    );
  function setup(extra: Record<string, unknown> = {}) {
    const store = boardStore();
    const srv = fakeServer();
    put(store, 'project', { id: 'p1', name: 'home', rank: 'a0' });
    for (const name of ['a', 'b']) {
      put(store, 'tag', { id: `t-${name}`, name });
      put(store, 'task_tag', {
        id: `l-${name}`,
        taskId: 'd',
        tagId: `t-${name}`,
        attached: true,
      });
    }
    put(store, 'task', daily(extra));
    return { store, srv, core: coreOf(store, srv.send) };
  }
  const move = (core: Core, opId = 'm1') =>
    moveOccurrence(core, { opId, id: 'c' }, 'd', FROM, TO);
  /** A synced copy of the 10-08 occurrence, which is skipped. */
  function moved(extra: Record<string, unknown> = {}) {
    const ctx = setup();
    ctx.srv.state.offline = true;
    put(ctx.store, 'task', {
      ...task('c', { scheduledOn: TO }),
      originTaskId: 'd',
      originOccurrence: FROM,
      version: 3,
      ...extra,
    });
    put(ctx.store, 'task_occurrence', {
      id: taskOccurrenceId('d', FROM),
      taskId: 'd',
      occurrence: FROM,
      state: 'skipped',
    });
    return ctx;
  }
  const refusedUndo = (core: Core, pattern: RegExp) =>
    expect(undoMove(core, mint('u1'), 'c')).rejects.toSatisfy(
      (e) =>
        e instanceof UsageError &&
        pattern.test(e.message) &&
        core.store.pending().length === 0,
    );

  it('queues the copy, its tags, then the skip, and the calendar follows', async () => {
    const { store, srv, core } = setup();
    srv.state.offline = true;
    expect(await move(core)).toEqual({ synced: false });
    const ops = store.pending();
    expect(ops.map((o) => `${o.kind}:${o.table}`)).toEqual([
      'create:task',
      'create:task_tag',
      'create:task_tag',
      'create:task_occurrence',
    ]);
    expect(ops[0]).toMatchObject({
      id: 'c',
      opId: 'm1',
      fields: {
        title: 'Water plants',
        notes: 'twice',
        projectId: 'p1',
        priority: 3,
        statusId: 's1',
        rank: 'a5',
        scheduledOn: TO,
        originTaskId: 'd',
        originOccurrence: FROM,
      },
    });
    const fields = (ops[0] as { fields: object }).fields;
    for (const key of ['rrule', 'dtstart', 'dueOn', 'parentId']) {
      expect(fields).not.toHaveProperty(key);
    }
    expect(ops.slice(1, 3).map((o) => o.id)).toEqual([
      taskTagId('c', 't-a'),
      taskTagId('c', 't-b'),
    ]);
    expect(ops[3]).toMatchObject({
      id: taskOccurrenceId('d', FROM),
      fields: { taskId: 'd', occurrence: FROM, state: 'skipped' },
    });
    expect(on(store)).toContain(`c@${TO}`);
    expect(on(store)).not.toContain(`d@${FROM}`);
  });

  it('copies no link to a tag deleted locally', async () => {
    const { store, srv, core } = setup();
    srv.state.offline = true;
    put(store, 'tag', {
      id: 't-b',
      name: 'b',
      deletedAt: '2026-10-01T00:00:00Z',
    });
    await move(core);
    expect(
      store
        .pending()
        .filter((o) => o.table === 'task_tag')
        .map((o) => o.id),
    ).toEqual([taskTagId('c', 't-a')]);
  });

  it('leaves null fields out of the copy', async () => {
    const { store, srv, core } = setup({
      notes: null,
      projectId: null,
      statusId: null,
    });
    srv.state.offline = true;
    await move(core);
    const fields = (store.pending()[0] as { fields: object }).fields;
    for (const key of ['notes', 'projectId', 'statusId']) {
      expect(fields).not.toHaveProperty(key);
    }
  });

  it("copies a subtask without its parent and skips it at the parent's date", async () => {
    const store = boardStore();
    const srv = fakeServer();
    srv.state.offline = true;
    const core = coreOf(store, srv.send);
    put(store, 'task', daily({ projectId: null, statusId: null }));
    put(store, 'task', task('s', { parentId: 'd', projectId: 'p1' }));
    await moveOccurrence(core, { opId: 'm1', id: 'c' }, 's', FROM, TO);
    const [copy, skip] = store.pending();
    expect(copy).toMatchObject({ fields: { projectId: 'p1' } });
    expect((copy as { fields: object }).fields).not.toHaveProperty('parentId');
    expect(skip).toMatchObject({
      id: taskOccurrenceId('s', FROM),
      fields: { taskId: 's', occurrence: FROM },
    });
    expect(on(store)).toContain(`c@${TO}`);
    expect(on(store).filter((d) => d.startsWith('c@'))).toHaveLength(1);
  });

  it('refuses what it cannot move, queuing nothing', async () => {
    const { store, core } = setup();
    put(store, 'task', task('one'));
    put(store, 'task_occurrence', {
      id: taskOccurrenceId('d', '2026-10-09'),
      taskId: 'd',
      occurrence: '2026-10-09',
      state: 'done',
    });
    put(store, 'task_occurrence', {
      id: taskOccurrenceId('d', '2026-10-06'),
      taskId: 'd',
      occurrence: '2026-10-06',
      state: 'skipped',
    });
    const refuse = (taskId: string, from: string, to: string, p: RegExp) =>
      expect(
        moveOccurrence(core, { opId: 'm1', id: 'c' }, taskId, from, to),
      ).rejects.toSatisfy(
        (e) =>
          e instanceof UsageError &&
          p.test(e.message) &&
          store.pending().length === 0 &&
          !store.seen('m1'),
      );
    await refuse('one', FROM, TO, /recurring/);
    await refuse('d', FROM, FROM, /already there/);
    await refuse('d', '2026-09-30', TO, /not an occurrence/);
    await refuse('d', FROM, '2026-02-30', /date/);
    await refuse('d', '2026-10-09', TO, /already done — undo it first/);
    await refuse('d', '2026-10-06', TO, /already skipped/);
  });

  it('works offline: queued, not synced, shown on the calendar', async () => {
    const { store, srv, core } = setup();
    srv.state.offline = true;
    expect((await move(core)).synced).toBe(false);
    expect(store.pending()).toHaveLength(4);
    expect(on(store)).toContain(`c@${TO}`);
  });

  it('lands in one batch and replays without a second copy or "already skipped"', async () => {
    const { store, srv, core } = setup();
    expect((await move(core)).synced).toBe(true);
    expect(store.pending()).toEqual([]);
    const sent = srv.sent.length;
    expect((await move(core)).synced).toBe(true);
    expect(srv.sent).toHaveLength(sent);
    expect(store.rows('task').filter((t) => t.id === 'c')).toHaveLength(1);
  });

  it('undoes a synced move: delete at its version, then open', async () => {
    const { store, core } = moved();
    expect((await undoMove(core, mint('u1'), 'c')).synced).toBe(false);
    expect(store.pending()).toMatchObject([
      { kind: 'delete', table: 'task', id: 'c', baseVersion: 3, opId: 'u1' },
      {
        kind: 'create',
        table: 'task_occurrence',
        id: taskOccurrenceId('d', FROM),
        fields: { state: 'open', completedAt: null },
      },
    ]);
    expect(store.pending()[1]).not.toHaveProperty('fields.statusId');
    expect(on(store)).toContain(`d@${FROM}`);
    expect(on(store)).not.toContain(`c@${TO}`);
  });

  it('writes only the delete when the occurrence was reopened meanwhile', async () => {
    const { store, core } = moved();
    put(store, 'task_occurrence', {
      id: taskOccurrenceId('d', FROM),
      taskId: 'd',
      occurrence: FROM,
      state: 'open',
    });
    await undoMove(core, mint('u1'), 'c');
    expect(store.pending().map((o) => o.kind)).toEqual(['delete']);
  });

  it('never reopens an occurrence that is done by the time of the undo', async () => {
    const { store, core } = moved();
    put(store, 'task_occurrence', {
      id: taskOccurrenceId('d', FROM),
      taskId: 'd',
      occurrence: FROM,
      state: 'done',
      completedAt: '2026-10-08T09:00:00.000Z',
    });
    await undoMove(core, mint('u1'), 'c');
    expect(store.pending().map((o) => o.kind)).toEqual(['delete']);
  });

  it("still reopens after the original's rule stopped producing the date", async () => {
    const { store, core } = moved();
    put(store, 'task', daily({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }));
    await undoMove(core, mint('u1'), 'c');
    expect(store.pending().map((o) => o.kind)).toEqual(['delete', 'create']);
  });

  it('refuses an undo it cannot do exactly', async () => {
    const plain = moved({ originTaskId: null, originOccurrence: null });
    await refusedUndo(plain.core, /not a moved occurrence/);

    const pendingCreate = setup();
    pendingCreate.srv.state.offline = true;
    await move(pendingCreate.core);
    await expect(undoMove(pendingCreate.core, mint('u1'), 'c')).rejects.toThrow(
      /not synced yet/,
    );
    expect(pendingCreate.store.pending()).toHaveLength(4);

    const edited = moved();
    await editTask(edited.core, mint('e1'), 'c', { title: 'x' });
    await expect(undoMove(edited.core, mint('u1'), 'c')).rejects.toThrow(
      /not synced yet/,
    );
    expect(edited.store.pending()).toHaveLength(1);

    const parent = moved();
    put(parent.store, 'task', task('kid', { parentId: 'c' }));
    await refusedUndo(parent.core, /subtasks/);

    const gone = moved();
    put(gone.store, 'task', daily({ deletedAt: '2026-10-01' }));
    await refusedUndo(gone.core, /original task of c is gone/);
  });

  it('replays an applied undo as ok, queuing nothing', async () => {
    const { store, srv, core } = moved();
    srv.state.offline = false;
    expect((await undoMove(core, mint('u1'), 'c')).synced).toBe(true);
    const sent = srv.sent.length;
    expect((await undoMove(core, mint('u1'), 'c')).synced).toBe(true);
    expect(srv.sent).toHaveLength(sent);
    expect(store.pending()).toEqual([]);
  });
});

describe('deleteTask', () => {
  /** Offline, so the queue stays inspectable; `p` has live subtasks s1, s2. */
  function family() {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    put(store, 'task', task('p', { version: 4 }));
    put(store, 'task', task('s2', { parentId: 'p', version: 3 }));
    put(store, 'task', task('s1', { parentId: 'p', version: 2 }));
    put(
      store,
      'task',
      task('s0', { parentId: 'p', version: 1, deletedAt: '2026-10-01' }),
    );
    return { store, srv, core: coreOf(store, srv.send) };
  }
  const pendingDeletes = (store: Store) =>
    store
      .pending()
      .map((o) => [o.kind, o.id, 'baseVersion' in o && o.baseVersion]);

  it('deletes live subtasks first, then the parent, at their versions', async () => {
    const { store, core } = family();
    expect((await deleteTask(core, mint('d1'), 'p')).synced).toBe(false);
    expect(pendingDeletes(store)).toEqual([
      ['delete', 's1', 2],
      ['delete', 's2', 3],
      ['delete', 'p', 4],
    ]);
    expect(store.pending()[0]?.opId).toBe('d1');
    expect(ids(viewTasks(store, TODAY, ALL_OPEN))).toEqual([]);
    for (const id of ['p', 's1', 's2']) {
      expect(taskDetails(store, TODAY, id)).toBeNull();
    }
  });

  it('deletes a subtask alone', async () => {
    const { store, core } = family();
    await deleteTask(core, mint('d1'), 's1');
    expect(pendingDeletes(store)).toEqual([['delete', 's1', 2]]);
    expect(taskDetails(store, TODAY, 'p')).not.toBeNull();
  });

  it('refuses what is not settled, queuing nothing', async () => {
    const cases: [
      string,
      (c: ReturnType<typeof family>) => Promise<unknown> | void,
      RegExp,
    ][] = [
      [
        'p',
        ({ store }) => put(store, 'task', task('p', { version: null })),
        /task p is not synced yet/,
      ],
      [
        'p',
        ({ store }) =>
          put(store, 'task', task('s2', { parentId: 'p', version: null })),
        /subtask s2 is not synced yet/,
      ],
      [
        'p',
        ({ core }) => editTask(core, mint('e1'), 'p', { title: 'x' }),
        /task p is not synced yet/,
      ],
      [
        'p',
        ({ core }) => editTask(core, mint('e1'), 's1', { priority: 2 }),
        /subtask s1 is not synced yet/,
      ],
      ['nope', () => undefined, /no task nope/],
      ['s0', () => undefined, /no task s0/],
    ];
    for (const [id, arrange, pattern] of cases) {
      const ctx = family();
      await arrange(ctx);
      const queued = ctx.store.pending().length;
      await expect(deleteTask(ctx.core, mint('d1'), id)).rejects.toThrow(
        pattern,
      );
      expect(ctx.store.pending()).toHaveLength(queued);
    }
  });

  it('syncs when online and replays without a second batch or "no task"', async () => {
    const { store, srv, core } = family();
    srv.state.offline = false;
    expect((await deleteTask(core, mint('d1'), 'p')).synced).toBe(true);
    const sent = srv.sent.length;
    expect((await deleteTask(core, mint('d1'), 'p')).synced).toBe(true);
    expect(srv.sent).toHaveLength(sent);
    expect(store.pending()).toEqual([]);
  });

  it('leaves a moved copy alive, and refuses its undo', async () => {
    const { store, core } = family();
    put(store, 'task', {
      ...task('c', { scheduledOn: '2026-10-10' }),
      originTaskId: 'p',
      originOccurrence: '2026-10-08',
      version: 5,
    });
    await deleteTask(core, mint('d1'), 'p');
    expect(ids(viewTasks(store, TODAY, ALL_OPEN))).toEqual(['c']);
    await expect(undoMove(core, mint('u1'), 'c')).rejects.toThrow(
      /original task of c is gone/,
    );
  });
});

describe('subtasks', () => {
  /** Offline, so the queue stays inspectable. */
  function homeStore() {
    const store = openStore(':memory:');
    const srv = fakeServer();
    srv.state.offline = true;
    put(store, 'project', { id: 'home-id', name: 'home' });
    put(store, 'task', task('p', { projectId: 'home-id', version: 1 }));
    return { store, core: coreOf(store, srv.send) };
  }
  const creates = (store: Store) =>
    store.pending().flatMap((op) => (op.kind === 'create' ? [op] : []));

  it('adds a subtask in the parent project with no rule', async () => {
    const { store, core } = homeStore();
    await add(core, 'Dishes', {}, mint('a1', 's1'), 'p');
    const [create] = creates(store);
    expect(create).toMatchObject({
      table: 'task',
      id: 's1',
      fields: { title: 'Dishes', parentId: 'p', projectId: 'home-id' },
    });
    expect(create?.fields).not.toHaveProperty('rrule');
    expect(create?.fields).not.toHaveProperty('dtstart');
  });

  it('takes the project the text names over the parent’s', async () => {
    const { store, core } = homeStore();
    await add(core, 'Floor #garage', {}, mint('a1', 's1'), 'p');
    const all = creates(store);
    const project = all.find((op) => op.table === 'project');
    expect(project?.fields).toMatchObject({ name: 'garage' });
    expect(all.find((op) => op.table === 'task')?.fields).toMatchObject({
      parentId: 'p',
      projectId: project?.id,
    });
  });

  it('refuses a bad parent or a rule, queuing nothing', async () => {
    const { store, core } = homeStore();
    put(store, 'task', task('c', { parentId: 'p' }));
    const rule = { rrule: 'FREQ=DAILY', dtstart: TODAY };
    const cases: [string, Record<string, string>, RegExp][] = [
      ['c', {}, /a subtask cannot have subtasks/],
      ['nope', {}, /no task nope/],
      ['p', rule, /a subtask repeats with its parent/],
    ];
    for (const [parent, recurrence, pattern] of cases) {
      await expect(
        add(core, 'X', recurrence, mint('a1', 's1'), parent),
      ).rejects.toThrow(pattern);
      expect(store.pending()).toEqual([]);
    }
  });

  it('lists live subtasks by rank then id, closed by their own one-off mark', () => {
    const store = boardStore();
    put(store, 'task', task('p', { dtstart: null }));
    put(store, 'task', task('b', { parentId: 'p', rank: 'a1' }));
    put(store, 'task', task('z', { parentId: 'p', rank: 'a0' }));
    put(store, 'task', task('a', { parentId: 'p', rank: 'a1' }));
    put(
      store,
      'task',
      task('gone', { parentId: 'p', deletedAt: '2026-10-01' }),
    );
    closeAt(store, 'z', '2026-10-01');
    const details = taskDetails(store, TODAY, 'p');
    expect(details?.subtasks).toEqual([
      { id: 'z', title: 'z', closed: true },
      { id: 'a', title: 'a', closed: false },
      { id: 'b', title: 'b', closed: false },
    ]);
    expect(details?.parentTitle).toBeNull();
    expect(details?.dtstart).toBeNull();
    const child = taskDetails(store, TODAY, 'a');
    expect(child).toMatchObject({ parentTitle: 'p', subtasks: [] });
    const items = viewTasks(store, TODAY, ALL_OPEN);
    expect(items.map((i) => [i.id, i.parentTitle])).toEqual([
      ['p', null],
      ['a', 'p'],
      ['b', 'p'],
    ]);
  });

  describe('of a weekly parent', () => {
    const weekly = () => {
      const store = boardStore();
      put(
        store,
        'task',
        task('w', {
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          dtstart: '2026-09-07',
          version: 1,
        }),
      );
      put(store, 'task', task('cafe', { parentId: 'w', version: 1 }));
      return store;
    };
    const doneAt = (store: Store, id: string, occurrence: string) =>
      put(store, 'task_occurrence', {
        id: `${id}-${occurrence}`,
        taskId: id,
        occurrence,
        state: 'done',
      });
    const closedOf = (store: Store) =>
      taskDetails(store, TODAY, 'w')?.subtasks.find((s) => s.id === 'cafe')
        ?.closed;

    it('reads a subtask at the parent’s current occurrence', () => {
      const store = weekly();
      expect(taskDetails(store, TODAY, 'w')?.dtstart).toBe('2026-09-07');
      expect(taskDetails(store, TODAY, 'w')?.occurrence).toBe('2026-09-28');
      doneAt(store, 'cafe', '2026-09-28');
      expect(closedOf(store)).toBe(true);
      doneAt(store, 'w', '2026-09-28');
      expect(taskDetails(store, TODAY, 'w')?.occurrence).toBe('2026-10-05');
      expect(closedOf(store)).toBe(false);
    });

    it('closes by the parent’s axis while the list shows its own', () => {
      const store = weekly();
      doneAt(store, 'w', '2026-09-28');
      doneAt(store, 'cafe', '2026-10-05');
      expect(closedOf(store)).toBe(true);
      const listed = viewTasks(store, TODAY, ALL_OPEN).find(
        (i) => i.id === 'cafe',
      );
      expect(listed?.occurrence).toBe('2026-09-28');
    });

    it('marks a subtask at an occurrence of the parent', async () => {
      const store = weekly();
      const srv = fakeServer();
      srv.state.offline = true;
      doneAt(store, 'w', '2026-09-28');
      await mark(
        coreOf(store, srv.send),
        'done',
        'cafe',
        '2026-10-05',
        mint('m1'),
      );
      const op = store.pending().find((o) => o.kind === 'create');
      expect(op).toMatchObject({
        id: taskOccurrenceId('cafe', '2026-10-05'),
        fields: { taskId: 'cafe', occurrence: '2026-10-05' },
      });
      expect(closedOf(store)).toBe(true);
    });
  });
});
