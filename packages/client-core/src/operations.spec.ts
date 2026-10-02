import { describe, expect, it } from 'vitest';
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
  catalog,
  deleteStatus,
  deleteView,
  editTask,
  listTasks,
  mark,
  moveTask,
  saveStatus,
  saveView,
  seedStatuses,
  setCompleting,
  submit,
  taskDetails,
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
