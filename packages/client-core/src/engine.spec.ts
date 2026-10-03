import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import {
  cookieTokenSource,
  type CookieAuthApi,
  type CookieTokenSource,
} from './auth.js';
import { localDate } from './occurrence.js';
import { ALL_OPEN, taskDetails, viewTasks } from './operations.js';
import { RefusalError } from './protocol.js';
import type { AccessGrant, Store } from './store.js';
import type { Transport } from './sync.js';
import { httpTransport } from './transport.js';
import { openWasmStore } from './sqlite-wasm.js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createEngine, dispatcher, type Engine } from './engine.js';
import type { Result, ToWorker, Topic, Topics } from './engine-protocol.js';

// A spy that calls through, so one test can make a computation throw.
vi.mock('./operations.js', async (original) => {
  const actual = await original<typeof import('./operations.js')>();
  return { ...actual, taskDetails: vi.fn(actual.taskDetails) };
});

type Op = Parameters<Store['enqueue']>[0];

const NOW = new Date('2026-10-02T10:00:00.000Z');
const LATER = '2026-10-02T11:00:00.000Z';
const EARLIER = '2026-10-02T09:00:00.000Z';

/** An access token whose first segment is base64url(JSON) with `sub`. */
const token = (sub: string, n = 0) =>
  `${btoa(JSON.stringify({ sub, n })).replace(/=+$/, '')}.mac`;
const grant = (sub: string, n = 0, expires = LATER): AccessGrant => ({
  accessToken: token(sub, n),
  accessExpiresAt: expires,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const task = (id: string) => ({
  table: 'task',
  id,
  seq: 1,
  row: { id, title: id, deletedAt: null },
});
/** A status, so that a first sync has nothing to seed (departure 5). */
const status = {
  table: 'status',
  id: 's',
  seq: 1,
  row: {
    id: 's',
    name: 'To do',
    rank: 'a0',
    completing: false,
    deletedAt: null,
    version: 1,
  },
};
/** The canned answer: two live tasks and one deleted, and a status. */
const CANNED = {
  cursor: 3,
  results: [],
  changes: [
    status,
    task('a'),
    task('b'),
    { ...task('c'), row: { id: 'c', title: 'c', deletedAt: EARLIER } },
  ],
};

const create = (opId: string): Op => ({
  opId,
  kind: 'create',
  table: 'task',
  id: `task-${opId}`,
  fields: { title: opId, rank: 'a0' },
  ts: EARLIER,
});

const offline = () => Promise.reject(new TypeError('fetch failed'));

let sqlite3: Sqlite3Static;
let store: Store;
let auth: {
  [K in keyof CookieAuthApi]: ReturnType<typeof vi.fn>;
} & CookieAuthApi;
let tokens: CookieTokenSource;
let send: ReturnType<typeof vi.fn> & Transport;
let published: { [T in Topic]?: Topics[T][] };

beforeAll(async () => {
  const init = sqlite3InitModule as (m: object) => Promise<Sqlite3Static>;
  sqlite3 = await init({ print() {}, printErr() {} });
});

beforeEach(() => {
  store = openWasmStore(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'));
  const fns = {
    login: vi.fn(() => Promise.resolve(grant('u1'))),
    register: vi.fn(() => Promise.resolve(grant('u1'))),
    refresh: vi.fn(() => Promise.resolve(grant('u1'))),
    logout: vi.fn(() => Promise.resolve(undefined)),
  };
  auth = fns as typeof auth;
  tokens = cookieTokenSource(auth, () => NOW);
  send = vi.fn(() => Promise.resolve(json(CANNED))) as typeof send;
  published = {};
  clock = NOW;
});

afterEach(() => {
  vi.mocked(taskDetails).mockReset();
  vi.restoreAllMocks();
  store.close();
  vi.unstubAllGlobals();
});

let clock = NOW;
let minted = 0;
/** A uuid-shaped id, as filters and refs need; `n` in the last group. */
const uuid = (n: number) =>
  `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const engine = (transport: Transport = send) =>
  createEngine({
    store,
    auth,
    tokens,
    send: transport,
    now: () => clock,
    newId: () => uuid(0x100000 + (minted += 1)),
    publish: (topic, value) => {
      (published[topic] ??= [] as never[]).push(value as never);
    },
  });

const last = <T extends Topic>(topic: T): Topics[T] | undefined =>
  (published[topic] as Topics[T][] | undefined)?.at(-1);

describe('start', () => {
  it('without the hint: signed-out, and no auth call', async () => {
    await engine().start(false);
    expect(last('session')).toEqual({ state: 'signed-out', reason: null });
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('with the hint and a refresh that succeeds: signed-in, then one sync', async () => {
    await engine().start(true);
    expect(last('session')?.state).toBe('signed-in');
    expect(send).toHaveBeenCalledTimes(1);
    expect(last('summary')).toEqual({ tasks: 2 });
    expect(last('sync')).toMatchObject({
      running: false,
      reached: true,
      lastSyncedAt: NOW.toISOString(),
      problem: null,
    });
    expect(store.owner()).toBe('u1');
  });

  it("with a refresh refused ('invalid'): signed-out, no sync", async () => {
    auth.refresh.mockResolvedValue('invalid');
    await engine().start(true);
    expect(last('session')?.state).toBe('signed-out');
    expect(send).not.toHaveBeenCalled();
  });

  it('offline with an owner on record: signed-in, not reached', async () => {
    store.setOwner('u1');
    auth.refresh.mockImplementation(offline);
    await engine().start(true);
    expect(last('session')?.state).toBe('signed-in');
    expect(last('sync')?.reached).toBe(false);
  });

  it('offline without an owner: signed-out', async () => {
    auth.refresh.mockImplementation(offline);
    await engine().start(true);
    expect(last('session')?.state).toBe('signed-out');
  });

  it('a refresh answered 429 keeps the session and says why', async () => {
    store.setOwner('u1');
    auth.refresh.mockRejectedValue(new RefusalError('refresh refused: 429'));
    await engine().start(true);
    expect(last('session')?.state).toBe('signed-in');
    expect(last('sync')?.problem).toContain('429');
  });
});

describe('signIn', () => {
  it('401 → invalid-credentials, and the session stays signed-out', async () => {
    auth.login.mockResolvedValue('invalid');
    const e = engine();
    await e.start(false);
    const result = await e.handle({
      kind: 'signIn',
      email: 'a@b.c',
      password: 'x',
    });
    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'invalid-credentials' },
    });
    expect(last('session')?.state).toBe('signed-out');
  });

  it('as another account with a pending op: refused, logged out, replica untouched', async () => {
    store.setOwner('u1');
    store.enqueue(create('mine'));
    tokens.adopt(undefined); // u1 signed out earlier
    auth.login.mockResolvedValue(grant('u2'));
    const e = engine();
    await e.start(false);
    const result = await e.handle({
      kind: 'signIn',
      email: 'a@b.c',
      password: 'x',
    });
    expect(result).toMatchObject({ ok: false, failure: { kind: 'refused' } });
    expect(auth.logout).toHaveBeenCalledWith(token('u2'));
    expect(tokens.signedIn()).toBe(false);
    expect(store.owner()).toBe('u1');
    expect(store.pending()).toHaveLength(1);
    expect(last('session')?.state).toBe('signed-out');
    expect(send).not.toHaveBeenCalled();
  });

  it("waits for the previous account's sync: its answer never reaches the new replica", async () => {
    // Cursor 0 on both sides: store.applyResponse's guard cannot tell them apart.
    const answer = (id?: string) =>
      json({
        cursor: id ? 3 : 0,
        results: [],
        changes: id ? [status, task(id)] : [status],
      });
    send.mockImplementation(() => Promise.resolve(answer()));
    const e = engine();
    await e.start(true);
    let release = () => {};
    send.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(answer('of-u1'));
        }),
    );
    const syncing = e.handle({ kind: 'sync', reason: 'manual' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    send.mockImplementation(() => Promise.resolve(answer('of-u2')));
    auth.login.mockResolvedValue(grant('u2'));
    const signIn = e.handle({ kind: 'signIn', email: 'b@b.c', password: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([syncing, signIn]);
    expect(store.rows('task').map((r) => r.id)).toEqual(['of-u2']);
  });

  it('as another account with an empty outbox: the replica reset, then signed-in', async () => {
    store.setOwner('u1');
    store.mergeChanges([task('old')]);
    auth.login.mockResolvedValue(grant('u2'));
    send.mockImplementation(() =>
      Promise.resolve(json({ cursor: 1, results: [], changes: [] })),
    );
    const e = engine();
    await e.start(false);
    const result = await e.handle({
      kind: 'signIn',
      email: 'a@b.c',
      password: 'x',
    });
    expect(result).toEqual({ ok: true });
    expect(store.owner()).toBe('u2');
    expect(store.rows('task')).toEqual([]);
    expect(last('session')?.state).toBe('signed-in');
    expect(last('summary')).toEqual({ tasks: 0 });
  });
});

describe('register', () => {
  it('signs in with the grant and syncs, like a sign-in', async () => {
    const e = engine();
    await e.start(false);
    const result = await e.handle({
      kind: 'register',
      email: 'a@b.c',
      password: 'x',
    });
    expect(result).toEqual({ ok: true });
    expect(auth.register).toHaveBeenCalledWith('a@b.c', 'x');
    expect(auth.login).not.toHaveBeenCalled();
    expect(store.owner()).toBe('u1');
    expect(last('session')?.state).toBe('signed-in');
    expect(send).toHaveBeenCalled();
  });

  it("a refusal → refused with the server's reason, still signed out", async () => {
    auth.register.mockRejectedValue(new RefusalError('registration is closed'));
    const e = engine();
    await e.start(false);
    const result = await e.handle({
      kind: 'register',
      email: 'a@b.c',
      password: 'x',
    });
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'refused', detail: 'registration is closed' },
    });
    expect(last('session')?.state).toBe('signed-out');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('refreshes an expired grant first, then logs out with the new bearer', async () => {
    auth.login.mockResolvedValue(grant('u1', 0, EARLIER));
    auth.refresh.mockResolvedValue(grant('u1', 1));
    const e = engine();
    await e.start(false);
    await e.handle({ kind: 'signIn', email: 'a@b.c', password: 'x' });
    send.mockClear();

    expect(await e.handle({ kind: 'signOut' })).toEqual({ ok: true });
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledWith(token('u1', 1));
    expect(last('session')?.state).toBe('signed-out');
    expect(tokens.signedIn()).toBe(false);

    await e.handle({ kind: 'sync', reason: 'manual' });
    expect(send).not.toHaveBeenCalled();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('waits for a sync in flight: its 401 is not a session that ended', async () => {
    const e = engine(
      httpTransport({ base: '/api/v1', timeoutMs: 1000 }, tokens),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(CANNED))),
    );
    await e.start(true);
    let release = () => {};
    const fetched = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json({}, 401));
        }),
    );
    vi.stubGlobal('fetch', fetched);
    auth.refresh.mockResolvedValue('invalid');
    const syncing = e.handle({ kind: 'sync', reason: 'manual' });
    await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
    const out = e.handle({ kind: 'signOut' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([syncing, out]);
    expect(last('session')).toEqual({ state: 'signed-out', reason: null });
  });

  it("renews once on 'unauthorized' and logs out with the renewed token", async () => {
    auth.refresh
      .mockResolvedValueOnce(grant('u1', 1))
      .mockResolvedValueOnce(grant('u1', 2));
    auth.logout.mockResolvedValueOnce('unauthorized');
    const e = engine();
    await e.start(true);
    await e.handle({ kind: 'signOut' });
    expect(auth.logout.mock.calls.map(([bearer]) => bearer as string)).toEqual([
      token('u1', 1),
      token('u1', 2),
    ]);
    expect(last('session')?.state).toBe('signed-out');
  });

  it('offline: still signed out locally', async () => {
    const e = engine();
    await e.start(true);
    auth.logout.mockImplementation(offline);
    expect(await e.handle({ kind: 'signOut' })).toEqual({ ok: true });
    expect(last('session')?.state).toBe('signed-out');
  });
});

describe('sync', () => {
  const held = () => {
    let release = () => {};
    send.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(CANNED));
        }),
    );
    return () => release();
  };

  it('three calls during one in-flight run cause exactly two exchanges', async () => {
    const e = engine();
    await e.start(true);
    send.mockClear();
    const release = held();
    const first = e.handle({ kind: 'sync', reason: 'manual' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const rest = [
      e.handle({ kind: 'sync', reason: 'focus' }),
      e.handle({ kind: 'sync', reason: 'online' }),
      e.handle({ kind: 'sync', reason: 'write' }),
    ];
    release();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    release();
    await Promise.all([first, ...rest]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a tick during a run causes none', async () => {
    const e = engine();
    await e.start(true);
    send.mockClear();
    const release = held();
    const first = e.handle({ kind: 'sync', reason: 'manual' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const tick = e.handle({ kind: 'sync', reason: 'tick' });
    release();
    await Promise.all([first, tick]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a tick within 25 s of the last sync is dropped; any other trigger runs', async () => {
    const e = engine();
    await e.start(true);
    send.mockClear();
    clock = new Date(NOW.getTime() + 24_999);
    await e.handle({ kind: 'sync', reason: 'tick' });
    expect(send).not.toHaveBeenCalled();
    for (const reason of ['focus', 'online', 'write', 'manual'] as const) {
      await e.handle({ kind: 'sync', reason });
    }
    expect(send).toHaveBeenCalledTimes(4);
    send.mockClear();
    clock = new Date(clock.getTime() + 25_000);
    await e.handle({ kind: 'sync', reason: 'tick' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a 401 that a refresh cannot fix → signed-out, reason 'signed-out'", async () => {
    const e = engine(
      httpTransport({ base: '/api/v1', timeoutMs: 1000 }, tokens),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(CANNED))),
    );
    await e.start(true);
    expect(last('session')?.state).toBe('signed-in');
    // The held token is fresh, so the 401 is what makes the transport renew.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({}, 401))),
    );
    auth.refresh.mockResolvedValue('invalid');
    await e.handle({ kind: 'sync', reason: 'manual' });
    expect(last('session')).toEqual({
      state: 'signed-out',
      reason: 'signed-out',
    });
  });

  it('a refresh answered 429 during a sync keeps the session and says why', async () => {
    const e = engine(
      httpTransport({ base: '/api/v1', timeoutMs: 1000 }, tokens),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(CANNED))),
    );
    await e.start(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({}, 401))),
    );
    auth.refresh.mockRejectedValue(new RefusalError('refresh refused: 429'));
    await e.handle({ kind: 'sync', reason: 'manual' });
    expect(last('session')?.state).toBe('signed-in');
    expect(last('sync')?.problem).toContain('429');
  });

  it('a sync asked for while the session restores waits for it', async () => {
    let release = () => {};
    auth.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(grant('u1'));
        }),
    );
    const e = engine();
    const started = e.start(true);
    const answer = e.handle({ kind: 'sync', reason: 'manual' });
    await vi.waitFor(() => expect(auth.refresh).toHaveBeenCalled());
    release();
    expect(await answer).toEqual({ ok: true });
    await started;
  });

  it("a sync before start is answered 'unavailable', not signed-out", async () => {
    expect(await engine().handle({ kind: 'sync', reason: 'manual' })).toEqual({
      ok: false,
      failure: { kind: 'unavailable', detail: expect.any(String) },
    });
  });

  it('a pending task op shows in summary.tasks before it is synced', async () => {
    const e = engine();
    await e.start(true);
    expect(last('summary')).toEqual({ tasks: 2 });
    store.enqueue(create('new'));
    e.snapshot();
    expect(last('summary')).toEqual({ tasks: 3 });
    expect(last('sync')).toMatchObject({ pending: 1 });
  });
});

describe('dispatcher', () => {
  const signIn = (id: number, build = 'b1', tab = 't1'): ToWorker => ({
    type: 'request',
    tab,
    id,
    command: { kind: 'signIn', email: 'a@b.c', password: 'x' },
    build,
  });
  const setup = (keepMs?: number) => {
    const e = engine();
    const replies: [string, number, Result][] = [];
    const dispatch = dispatcher(
      'b1',
      e,
      (tab, id, result) => replies.push([tab, id, result]),
      keepMs,
    );
    return { e, replies, dispatch };
  };

  it('keys a run by tab, so two tabs sharing an id each get a run', async () => {
    const { e, replies, dispatch } = setup();
    await e.start(false);
    dispatch(signIn(1, 'b1', 't1'));
    dispatch(signIn(1, 'b1', 't2'));
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(auth.login).toHaveBeenCalledTimes(2);
    expect(replies.map(([tab]) => tab).sort()).toEqual(['t1', 't2']);
  });

  it('attaches a resent request to the run already in flight', async () => {
    let release = () => {};
    auth.login.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(grant('u1'));
        }),
    );
    const { e, replies, dispatch } = setup();
    await e.start(false);
    dispatch(signIn(1));
    dispatch(signIn(1)); // the tab saw a `ready` and resent it
    await vi.waitFor(() => expect(auth.login).toHaveBeenCalled());
    release();
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(replies).toEqual([
      ['t1', 1, { ok: true }],
      ['t1', 1, { ok: true }],
    ]);
  });

  it('answers a late resend from the settled run, then forgets it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { e, replies, dispatch } = setup(1000);
      await e.start(false);
      dispatch(signIn(1));
      await vi.waitFor(() => expect(replies).toHaveLength(1));
      dispatch(signIn(1));
      await vi.waitFor(() => expect(replies).toHaveLength(2));
      expect(auth.login).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      dispatch(signIn(1));
      await vi.waitFor(() => expect(auth.login).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers another build with the snapshot, never a run', async () => {
    const { e, replies, dispatch } = setup();
    await e.start(false);
    published = {};
    dispatch({ type: 'hello', tab: 'stale', build: 'b0' });
    dispatch(signIn(1, 'b0'));
    await Promise.resolve();
    // Topics stamped with this build tell the stale tab; same-build tabs
    // take them as a no-op, where `ready` would make them resend.
    expect(last('session')).toEqual({ state: 'signed-out', reason: null });
    expect(last('engine')).toEqual({ state: 'ready', reason: null });
    expect(auth.login).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });
});

// ── writes, watches and view topics (Task 6) ────────────────────────────

type Fields = Record<string, unknown>;
type Change = { table: string; id: string; seq: number; row: Fields };

/**
 * A server that applies every op, bumps the row's version and answers with
 * what changed since the last pull. `put` stages a row for the next pull,
 * as another client's write would.
 */
function server(...initial: [table: string, row: Fields][]) {
  const sent: Op[] = [];
  const rows = new Map<string, Fields>();
  const queue: Change[] = [];
  let seq = 100_000;
  const put = (table: string, row: Fields) => {
    const key = `${table}:${String(row.id)}`;
    const version = ((rows.get(key)?.version as number | undefined) ?? 0) + 1;
    const next = { deletedAt: null, ...row, version };
    rows.set(key, next);
    queue.push({ table, id: String(row.id), seq: (seq += 1), row: next });
  };
  for (const [table, row] of initial) put(table, row);
  const fn: Transport = (request) => {
    const results = request.ops.map((op) => {
      sent.push(op);
      const current = rows.get(`${op.table}:${op.id}`) ?? {};
      put(
        op.table,
        op.kind === 'create'
          ? { ...current, ...op.fields, id: op.id }
          : op.kind === 'set'
            ? { ...current, [op.field]: op.value }
            : { ...current, deletedAt: EARLIER },
      );
      return { opId: op.opId, status: 'applied' as const };
    });
    return Promise.resolve(
      json({ cursor: seq, results, changes: queue.splice(0) }),
    );
  };
  return { sent, put, send: fn };
}

const S1 = uuid(0x51);
const S2 = uuid(0x52);
const DONE = uuid(0x5d);
const statusRow = (
  id: string,
  name: string,
  rank: string,
  completing = false,
) => ['status', { id, name, rank, completing }] as [string, Fields];
const TODO = statusRow(S1, 'To do', 'a0');
const taskRow = (n: number, extra: Fields = {}) =>
  [
    'task',
    { id: uuid(n), title: `t${n}`, priority: 2, rank: 'a0', ...extra },
  ] as [string, Fields];
const viewRow = (id: string, extra: Fields = {}) =>
  [
    'view',
    {
      id,
      name: id.slice(-4),
      layout: 'list',
      sort: 'manual',
      filter: { and: [] },
      rank: 'a0',
      ...extra,
    },
  ] as [string, Fields];

/** Signed in over `srv`, after the first sync. */
async function signedIn(srv: ReturnType<typeof server>) {
  send.mockImplementation(srv.send);
  const e = engine();
  await e.start(true);
  return e;
}

const views = (key: string) =>
  (published.view ?? []).filter((v) => v.key === key);
const lastView = (key: string) => views(key).at(-1);
const titles = (key: string) => lastView(key)?.items.map((i) => i.title);
const sentOps = (srv: ReturnType<typeof server>, table: string) =>
  srv.sent.filter((op) => op.table === table);

describe('watches and view topics', () => {
  const V = uuid(0x71);

  it('two tabs watch two views: each publish carries its key, both after a write', async () => {
    const srv = server(TODO, viewRow(V, { sort: 'priority' }), taskRow(1));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    await e.handle({ kind: 'watch', view: 'all', task: null }, 'B');
    expect(lastView(V)).toMatchObject({
      key: V,
      sort: 'priority',
      problem: null,
    });
    expect(lastView('all')).toMatchObject({ key: 'all', sort: 'manual' });
    published = {};
    const result = await e.handle(
      { kind: 'add', opId: uuid(0xa1), id: uuid(0xa2), text: 'buy milk' },
      'A',
    );
    expect(result).toEqual({ ok: true });
    expect(titles(V)).toContain('buy milk');
    expect(titles('all')).toContain('buy milk');
    expect(published.catalog?.length).toBeGreaterThan(0);
  });

  it('an add shows in the view while the transport is still pending', async () => {
    const srv = server(TODO, taskRow(1));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: 'all', task: null }, 'A');
    send.mockImplementation(() => new Promise<Response>(() => {}));
    void e.handle(
      { kind: 'add', opId: uuid(0xa1), id: uuid(0xa2), text: 'offline add' },
      'A',
    );
    await vi.waitFor(() => expect(titles('all')).toContain('offline add'));
    expect(last('sync')?.pending).toBe(1);
  });

  it('stops publishing a key nobody watches any more', async () => {
    const srv = server(TODO, viewRow(V));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: uuid(0xa2) }, 'A');
    await e.handle({ kind: 'watch', view: null, task: null }, 'A');
    published = {};
    await e.handle(
      { kind: 'add', opId: uuid(0xa1), id: uuid(0xa2), text: 'x' },
      'A',
    );
    expect(published.view).toBeUndefined();
    expect(published.task).toBeUndefined();
    expect(published.catalog?.length).toBeGreaterThan(0);
  });

  it('publishes the watched task after an edit and after a pull', async () => {
    const T = uuid(1);
    const srv = server(TODO, taskRow(1));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: null, task: T }, 'A');
    expect(last('task')).toMatchObject({ id: T, task: { title: 't1' } });
    await e.handle(
      {
        kind: 'edit',
        opId: uuid(0xe1),
        taskId: T,
        changes: { title: 'renamed' },
      },
      'A',
    );
    expect(last('task')?.task?.title).toBe('renamed');
    srv.put('task', {
      id: T,
      title: 'from elsewhere',
      priority: 2,
      rank: 'a0',
    });
    await e.handle({ kind: 'sync', reason: 'manual' });
    expect(last('task')?.task?.title).toBe('from elsewhere');
  });

  it('the day changes: the next sync publishes against the new today', async () => {
    const tomorrow = localDate(new Date(NOW.getTime() + 86_400_000));
    const srv = server(
      TODO,
      viewRow(V, { filter: { scheduled: { from: 0, to: 0 } } }),
      taskRow(1, { scheduledOn: tomorrow }),
    );
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    expect(titles(V)).toEqual([]);
    clock = new Date(NOW.getTime() + 86_400_000);
    await e.handle({ kind: 'sync', reason: 'tick' });
    expect(titles(V)).toEqual(['t1']);
  });

  it('a deleted view is published as deleted, with no items', async () => {
    const srv = server(TODO, taskRow(1));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    expect(lastView(V)).toMatchObject({ problem: 'deleted', items: [] });
  });

  it('a view with an invalid filter (from the server) publishes its problem, not every task', async () => {
    const srv = server(
      TODO,
      taskRow(1),
      viewRow(V, { filter: { tag: 'not-a-uuid' } }),
    );
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    expect(lastView(V)?.problem).toContain('not a uuid');
    expect(lastView(V)?.items).toEqual([]);
  });

  it('a pull that brings a duplicate tag: the view already matches by the winner, and the merge is sent', async () => {
    const WIN = uuid(0x7a);
    const LOSE = uuid(0x7b);
    const T = uuid(1);
    const srv = server(
      TODO,
      ['tag', { id: WIN, name: 'Work' }],
      ['tag', { id: LOSE, name: 'work' }],
      taskRow(1),
      ['task_tag', { id: uuid(0x7c), taskId: T, tagId: WIN }],
      viewRow(V, { filter: { tag: LOSE } }),
    );
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    expect(titles(V)).toEqual(['t1']);
    await vi.waitFor(() =>
      expect(
        srv.sent.filter(
          (op) =>
            op.kind === 'set' && op.table === 'view' && op.field === 'filter',
        ),
      ).toMatchObject([{ id: V, value: { tag: WIN } }]),
    );
  });
});

describe('a session that is not signed in', () => {
  const EMPTY = { views: [], statuses: [], projects: [], tags: [] };

  it('publishes nothing of the replica after signOut, and replaces what was shown', async () => {
    const srv = server(TODO, taskRow(1), viewRow(uuid(0x71)));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: 'all', task: uuid(1) }, 'A');
    expect(titles('all')).toEqual(['t1']);
    expect(last('catalog')?.views).toHaveLength(1);
    await e.handle({ kind: 'signOut' });
    expect(lastView('all')).toMatchObject({ problem: 'signed-out', items: [] });
    expect(last('task')).toEqual({ id: uuid(1), task: null });
    expect(last('catalog')).toEqual(EMPTY);
    // A tab that says hello now, or starts watching, gets the same.
    published = {};
    e.snapshot();
    await e.handle({ kind: 'watch', view: 'all', task: null }, 'B');
    expect(published.catalog?.every((c) => c.views.length === 0)).toBe(true);
    expect(views('all').every((v) => v.items.length === 0)).toBe(true);
  });

  it('shows no counters of the replica when signed out, and when restoring', async () => {
    const srv = server(TODO, taskRow(1));
    const e = await signedIn(srv);
    store.enqueue(create('queued')); // a pending op of the account
    e.snapshot();
    expect(last('summary')).toEqual({ tasks: 2 });
    expect(last('sync')).toMatchObject({ pending: 1 });
    await e.handle({ kind: 'signOut' });
    expect(last('summary')).toEqual({ tasks: 0 });
    expect(last('sync')).toMatchObject({ pending: 0, failed: 0 });
    // A fresh engine over the same replica, before its session is known.
    const again = engine();
    again.snapshot();
    expect(last('session')?.state).toBe('restoring');
    expect(last('summary')).toEqual({ tasks: 0 });
    expect(last('sync')).toMatchObject({ pending: 0, failed: 0 });
  });

  it('publishes nothing of the replica while the session restores', async () => {
    const srv = server(TODO, taskRow(1), viewRow(uuid(0x71)));
    await signedIn(srv); // fills the replica, then a fresh engine over it
    published = {};
    const e = engine();
    e.snapshot();
    await e.handle({ kind: 'watch', view: 'all', task: uuid(1) }, 'A');
    expect(last('session')?.state).toBe('restoring');
    expect(last('catalog')).toEqual(EMPTY);
    expect(lastView('all')).toMatchObject({ problem: 'signed-out', items: [] });
    expect(last('task')).toEqual({ id: uuid(1), task: null });
  });
});

describe('publication that throws', () => {
  it('does not replace a write result or stop the other keys; logs once', async () => {
    const BAD = uuid(2);
    const srv = server(TODO, taskRow(1), taskRow(2));
    const e = await signedIn(srv);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(taskDetails).mockImplementation(() => {
      throw new Error('boom');
    });
    await e.handle({ kind: 'watch', view: 'all', task: BAD }, 'A');
    expect(
      await e.handle(
        { kind: 'add', opId: uuid(0xa1), id: uuid(0xa2), text: 'milk' },
        'A',
      ),
    ).toEqual({ ok: true });
    expect(titles('all')).toContain('milk');
    expect(last('task')).toEqual({ id: BAD, task: null });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('status seeding', () => {
  it('the first sync that reaches the server with no statuses queues the seed', async () => {
    const srv = server(taskRow(1));
    await signedIn(srv);
    await vi.waitFor(() => expect(sentOps(srv, 'status')).toHaveLength(3));
  });

  it('a start that never reaches the server seeds nothing', async () => {
    send.mockImplementation(offline);
    await engine().start(true);
    expect(last('sync')?.reached).toBe(false);
    expect(store.pending()).toEqual([]);
  });

  it('a replica that already has a status seeds nothing', async () => {
    const srv = server(TODO);
    await signedIn(srv);
    expect(store.pending()).toEqual([]);
    expect(sentOps(srv, 'status')).toEqual([]);
  });
});

describe('write commands', () => {
  it('reach their operations with the tab ids', async () => {
    const T = uuid(1);
    const V = uuid(0x71);
    const srv = server(
      TODO,
      statusRow(S2, 'Doing', 'a1'),
      statusRow(DONE, 'Done', 'a2', true),
      taskRow(1),
    );
    const e = await signedIn(srv);
    const first = (opId: string) => srv.sent.find((op) => op.opId === opId);
    const ok = async (command: Parameters<typeof e.handle>[0]) =>
      expect(await e.handle(command, 'A')).toMatchObject({ ok: true });

    await ok({
      kind: 'add',
      opId: uuid(0xa1),
      id: uuid(0xa2),
      text: 'x #p @t',
    });
    expect(first(uuid(0xa1))).toMatchObject({
      kind: 'create',
      table: 'task',
      id: uuid(0xa2),
    });
    await ok({
      kind: 'edit',
      opId: uuid(0xa3),
      taskId: T,
      changes: { priority: 0 },
    });
    expect(first(uuid(0xa3))).toMatchObject({
      field: 'priority',
      value: 0,
      id: T,
    });
    await ok({
      kind: 'move',
      opId: uuid(0xa4),
      taskId: T,
      view: 'all',
      statusId: S2,
    });
    expect(first(uuid(0xa4))).toMatchObject({ field: 'statusId', value: S2 });
    await ok({
      kind: 'saveView',
      opId: uuid(0xa5),
      id: V,
      fields: {
        name: 'Mine',
        layout: 'kanban',
        sort: 'manual',
        filter: { and: [] },
      },
    });
    expect(first(uuid(0xa5))).toMatchObject({
      kind: 'create',
      table: 'view',
      id: V,
    });
    await ok({ kind: 'deleteView', opId: uuid(0xa6), id: V });
    expect(first(uuid(0xa6))).toMatchObject({
      kind: 'delete',
      table: 'view',
      id: V,
    });
    const S3 = uuid(0x53);
    await ok({
      kind: 'saveStatus',
      opId: uuid(0xa7),
      id: S3,
      name: 'Review',
      after: S2,
    });
    expect(first(uuid(0xa7))).toMatchObject({
      kind: 'create',
      table: 'status',
      id: S3,
    });
    await ok({ kind: 'setCompleting', opId: uuid(0xa8), id: S3 });
    expect(first(uuid(0xa8))).toMatchObject({
      table: 'status',
      field: 'completing',
    });
    await ok({ kind: 'deleteStatus', opId: uuid(0xa9), id: S2 });
    expect(srv.sent.at(-1)).toMatchObject({
      kind: 'delete',
      table: 'status',
      id: S2,
    });
    expect(first(uuid(0xa9))).toBeDefined();
    await ok({
      kind: 'mark',
      opId: uuid(0xaa),
      taskId: uuid(0xa2),
      mark: 'done',
    });
    expect(first(uuid(0xaa))).toMatchObject({ table: 'task_occurrence' });
  });

  it('a recurring mark answers with the occurrence and the next one', async () => {
    const today = localDate(NOW);
    const srv = server(
      TODO,
      statusRow(DONE, 'Done', 'a2', true),
      taskRow(1, { rrule: 'FREQ=DAILY', dtstart: today }),
    );
    const e = await signedIn(srv);
    const result = await e.handle(
      { kind: 'mark', opId: uuid(0xb1), taskId: uuid(1), mark: 'done' },
      'A',
    );
    expect(result).toEqual({
      ok: true,
      note: { marked: 'done', occurrence: today, next: expect.any(String) },
    });
    if (result.ok) expect(String(result.note?.next) > today).toBe(true);
  });

  it('an edit with an empty title is invalid', async () => {
    const e = await signedIn(server(TODO, taskRow(1)));
    expect(
      await e.handle(
        {
          kind: 'edit',
          opId: uuid(0xc1),
          taskId: uuid(1),
          changes: { title: ' ' },
        },
        'A',
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'invalid' } });
  });

  it('a write while signed out is signed-out, and queues nothing', async () => {
    const e = engine();
    await e.start(false);
    expect(
      await e.handle(
        { kind: 'add', opId: uuid(0xc2), id: uuid(0xc3), text: 'x' },
        'A',
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'signed-out' } });
    expect(store.pending()).toEqual([]);
  });

  it('a move with `after` in a priority-sorted view writes no rank', async () => {
    const V = uuid(0x71);
    const srv = server(
      TODO,
      viewRow(V, { sort: 'priority' }),
      taskRow(1),
      taskRow(2),
    );
    const e = await signedIn(srv);
    srv.sent.length = 0;
    expect(
      await e.handle(
        {
          kind: 'move',
          opId: uuid(0xd1),
          taskId: uuid(1),
          view: V,
          after: uuid(2),
        },
        'A',
      ),
    ).toEqual({ ok: true });
    expect(
      srv.sent.filter((op) => op.kind === 'set' && op.field === 'rank'),
    ).toEqual([]);
  });

  it('a move with `after` in a manual view re-ranks the tie run it lands in', async () => {
    const srv = server(TODO, taskRow(1), taskRow(2), taskRow(3));
    const e = await signedIn(srv);
    await e.handle(
      {
        kind: 'move',
        opId: uuid(0xd2),
        taskId: uuid(1),
        view: 'all',
        after: uuid(2),
      },
      'A',
    );
    expect(
      srv.sent
        .filter((op) => op.kind === 'set' && op.field === 'rank')
        .map((op) => op.id),
    ).toEqual([uuid(1), uuid(3)]);
    expect(viewTasks(store, localDate(NOW), ALL_OPEN).map((t) => t.id)).toEqual(
      [uuid(2), uuid(1), uuid(3)],
    );
  });
});

describe('a drop resent after it applied', () => {
  it('is a no-op even when its anchor has left the list', async () => {
    const srv = server(TODO, taskRow(1), taskRow(2), taskRow(3));
    const e = await signedIn(srv);
    const drop = {
      kind: 'move' as const,
      opId: uuid(0xd4),
      taskId: uuid(1),
      view: 'all',
      after: uuid(2),
    };
    expect(await e.handle(drop, 'A')).toMatchObject({ ok: true });
    await e.handle(
      { kind: 'mark', opId: uuid(0xd5), mark: 'done', taskId: uuid(2) },
      'A',
    );
    srv.sent.length = 0;
    expect(await e.handle(drop, 'A')).toMatchObject({ ok: true });
    expect(srv.sent).toEqual([]);
  });
});

describe('a drop that names a stale anchor', () => {
  it('is invalid, and changes nothing', async () => {
    const srv = server(TODO, taskRow(1), taskRow(2));
    const e = await signedIn(srv);
    srv.sent.length = 0;
    expect(
      await e.handle(
        {
          kind: 'move',
          opId: uuid(0xd3),
          taskId: uuid(1),
          view: 'all',
          after: uuid(0x99),
        },
        'A',
      ),
    ).toMatchObject({ ok: false, failure: { kind: 'invalid' } });
    expect(srv.sent).toEqual([]);
  });
});

describe('a write the server refused', () => {
  it('still merges what its pull brought', async () => {
    const WIN = uuid(0x7a);
    const LOSE = uuid(0x7b);
    const V = uuid(0x71);
    const srv = server(TODO, taskRow(1));
    const e = await signedIn(srv);
    const row = (table: string, id: string, extra: Fields, seq: number) => ({
      table,
      id,
      seq,
      row: { id, deletedAt: null, version: 1, ...extra },
    });
    const sent: Op[] = [];
    send.mockImplementation((request) => {
      sent.push(...request.ops);
      return Promise.resolve(
        json({
          cursor: 200_000,
          results: request.ops.map((op: Op) => ({
            opId: op.opId,
            status: 'rejected',
            reason: 'no',
          })),
          changes: [
            row('tag', WIN, { name: 'Work' }, 200_001),
            row('tag', LOSE, { name: 'work' }, 200_002),
            ...(sent.length > 1
              ? []
              : [
                  row(
                    'view',
                    V,
                    {
                      name: 'v',
                      layout: 'list',
                      sort: 'manual',
                      filter: { tag: LOSE },
                      rank: 'a0',
                    },
                    200_003,
                  ),
                ]),
          ],
        }),
      );
    });
    expect(
      await e.handle(
        {
          kind: 'edit',
          opId: uuid(0xe1),
          taskId: uuid(1),
          changes: { title: 'x' },
        },
        'A',
      ),
    ).toMatchObject({ ok: false });
    await vi.waitFor(() =>
      expect(
        sent.filter((op) => op.kind === 'set' && op.table === 'view'),
      ).toMatchObject([{ id: V, field: 'filter', value: { tag: WIN } }]),
    );
  });
});

describe('resends', () => {
  const add = (): Parameters<Engine['handle']>[0] => ({
    kind: 'add',
    opId: uuid(0xf1),
    id: uuid(0xf2),
    text: 'once',
  });
  const creates = (srv: ReturnType<typeof server>) =>
    sentOps(srv, 'task').filter((op) => op.kind === 'create');

  it('the same tab and request id runs once (the dispatcher)', async () => {
    const srv = server(TODO);
    const e = await signedIn(srv);
    const replies: Result[] = [];
    const dispatch = dispatcher('b1', e, (_t, _i, r) => replies.push(r));
    const request: ToWorker = {
      type: 'request',
      tab: 'A',
      id: 1,
      command: add(),
      build: 'b1',
    };
    dispatch(request);
    dispatch(request);
    await vi.waitFor(() => expect(replies).toHaveLength(2));
    expect(creates(srv)).toHaveLength(1);
    expect(viewTasks(store, localDate(NOW), ALL_OPEN)).toHaveLength(1);
  });

  it('after a worker restart the marker makes the same write a no-op', async () => {
    const srv = server(TODO);
    const first = await signedIn(srv);
    expect(await first.handle(add(), 'A')).toEqual({ ok: true });
    expect(store.pending()).toEqual([]); // applied and settled
    const second = await signedIn(srv); // a new worker over the same store
    expect(await second.handle(add(), 'A')).toEqual({ ok: true });
    expect(viewTasks(store, localDate(NOW), ALL_OPEN).map((t) => t.id)).toEqual(
      [uuid(0xf2)],
    );
    expect(creates(srv)).toHaveLength(1);
  });
});

// ── calendar spans and occurrence moves (W4 Task 4) ─────────────────────

describe('calendar views and occurrence moves', () => {
  const V = uuid(0x71);
  const T = uuid(1);
  const COPY = uuid(0xc0);
  const today = localDate(NOW);
  /** `today` plus `n` days, by UTC arithmetic on the date string. */
  const day = (n: number) =>
    new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
  const WEEK = { from: day(0), to: day(6) };
  const NEXT = { from: day(7), to: day(13) };
  const CALENDAR = viewRow(V, { layout: 'calendar' });
  const DAILY = taskRow(1, { rrule: 'FREQ=DAILY', dtstart: today });
  const spanOf = (span: { from: string; to: string } | null) =>
    views(V).filter((v) => JSON.stringify(v.span) === JSON.stringify(span));
  const placed = (span: { from: string; to: string }) =>
    spanOf(span)
      .at(-1)
      ?.placements.map((p) => `${p.taskId}@${p.date}`);
  const move = (opId = uuid(0xe1)): Parameters<Engine['handle']>[0] => ({
    kind: 'moveOccurrence',
    opId,
    id: COPY,
    taskId: T,
    occurrence: day(0),
    to: day(1),
  });

  it('two tabs on one calendar view with two spans each get theirs, both after a write', async () => {
    const srv = server(TODO, CALENDAR, DAILY);
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null, span: WEEK }, 'A');
    await e.handle({ kind: 'watch', view: V, task: null, span: NEXT }, 'B');
    expect(spanOf(WEEK).at(-1)).toMatchObject({
      key: V,
      layout: 'calendar',
      today,
      problem: null,
    });
    expect(placed(WEEK)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => `${T}@${day(n)}`),
    );
    expect(placed(NEXT)).toEqual(
      [7, 8, 9, 10, 11, 12, 13].map((n) => `${T}@${day(n)}`),
    );
    published = {};
    await e.handle(
      { kind: 'add', opId: uuid(0xa1), id: uuid(0xa2), text: 'x' },
      'A',
    );
    expect(spanOf(WEEK)).not.toEqual([]);
    expect(spanOf(NEXT)).not.toEqual([]);
  });

  it('a calendar view watched without a span publishes no items', async () => {
    const e = await signedIn(server(TODO, CALENDAR, DAILY));
    await e.handle({ kind: 'watch', view: V, task: null }, 'A');
    expect(lastView(V)).toMatchObject({
      today,
      span: null,
      problem: null,
      items: [],
      placements: [],
    });
  });

  it("a 43-day span is problem 'span', with no items", async () => {
    const e = await signedIn(server(TODO, CALENDAR, DAILY));
    const span = { from: day(0), to: day(42) };
    await e.handle({ kind: 'watch', view: V, task: null, span }, 'A');
    expect(lastView(V)).toMatchObject({
      span,
      problem: 'span',
      items: [],
      placements: [],
    });
  });

  it('list and kanban publishes carry no span and no placements', async () => {
    const K = uuid(0x72);
    const e = await signedIn(
      server(TODO, viewRow(K, { layout: 'kanban' }), DAILY),
    );
    await e.handle({ kind: 'watch', view: 'all', task: null }, 'A');
    await e.handle({ kind: 'watch', view: K, task: null }, 'B');
    for (const key of ['all', K]) {
      expect(lastView(key)).toMatchObject({
        today,
        span: null,
        placements: [],
      });
      expect(lastView(key)?.items).not.toEqual([]);
    }
  });

  it('a move shows the copy in the calendar while the transport is still pending', async () => {
    const e = await signedIn(server(TODO, CALENDAR, DAILY));
    await e.handle({ kind: 'watch', view: V, task: null, span: WEEK }, 'A');
    send.mockImplementation(() => new Promise<Response>(() => {}));
    void e.handle(move(), 'A');
    await vi.waitFor(() => expect(placed(WEEK)).toContain(`${COPY}@${day(1)}`));
    expect(placed(WEEK)).not.toContain(`${T}@${day(0)}`);
  });

  it('a move resent after a worker restart creates no second copy', async () => {
    const srv = server(TODO, CALENDAR, DAILY);
    const first = await signedIn(srv);
    expect(await first.handle(move(), 'A')).toEqual({ ok: true });
    expect(store.pending()).toEqual([]); // applied and settled
    const second = await signedIn(srv); // a new worker over the same store
    expect(await second.handle(move(), 'A')).toEqual({ ok: true });
    await second.handle(
      { kind: 'watch', view: V, task: null, span: WEEK },
      'A',
    );
    expect(placed(WEEK)?.filter((p) => p.startsWith(COPY))).toEqual([
      `${COPY}@${day(1)}`,
    ]);
    expect(
      sentOps(srv, 'task').filter(
        (op) => op.kind === 'create' && op.id === COPY,
      ),
    ).toHaveLength(1);
  });

  it('undo of a copy created offline is invalid', async () => {
    const e = await signedIn(server(TODO, CALENDAR, DAILY));
    send.mockImplementation(offline);
    expect(await e.handle(move(), 'A')).toEqual({ ok: true });
    expect(
      await e.handle({ kind: 'undoMove', opId: uuid(0xe2), taskId: COPY }, 'A'),
    ).toMatchObject({ ok: false, failure: { kind: 'invalid' } });
  });

  it('undo of a synced copy deletes it and reopens the occurrence', async () => {
    const srv = server(TODO, CALENDAR, DAILY);
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: V, task: null, span: WEEK }, 'A');
    await e.handle(move(), 'A');
    expect(
      await e.handle({ kind: 'undoMove', opId: uuid(0xe2), taskId: COPY }, 'A'),
    ).toEqual({ ok: true });
    expect(placed(WEEK)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((n) => `${T}@${day(n)}`),
    );
  });

  it('a move while signed out is signed-out', async () => {
    const e = engine();
    await e.start(false);
    expect(await e.handle(move(), 'A')).toMatchObject({
      ok: false,
      failure: { kind: 'signed-out' },
    });
    expect(store.pending()).toEqual([]);
  });
});

// ── delete, rule and subtask writes (W5 Task 4) ─────────────────────────

describe('delete, rule and subtask writes', () => {
  const P = uuid(1);
  const C = uuid(2);
  const today = localDate(NOW);
  const yesterday = '2026-10-01';
  const DAILY = taskRow(1, { rrule: 'FREQ=DAILY', dtstart: '2026-09-01' });
  const SUB = taskRow(2, { parentId: P });
  const hang = () => send.mockImplementation(() => new Promise(() => {}));
  const ruleOf = (rrule: string) => ({ rrule, dtstart: today });

  it('reach their operations with the tab ids', async () => {
    const srv = server(TODO, DAILY, SUB, taskRow(3), taskRow(4));
    const e = await signedIn(srv);
    const first = (opId: string) => srv.sent.find((op) => op.opId === opId);
    const ok = async (command: Parameters<typeof e.handle>[0]) =>
      expect(await e.handle(command, 'A')).toMatchObject({ ok: true });

    await ok({
      kind: 'add',
      opId: uuid(0xa1),
      id: uuid(0xa2),
      text: 'sub',
      parentId: uuid(3),
    });
    expect(first(uuid(0xa1))).toMatchObject({
      kind: 'create',
      table: 'task',
      id: uuid(0xa2),
      fields: { parentId: uuid(3) },
    });
    await ok({
      kind: 'mark',
      opId: uuid(0xa3),
      taskId: C,
      mark: 'done',
      on: yesterday,
    });
    expect(first(uuid(0xa3))).toMatchObject({
      table: 'task_occurrence',
      fields: { occurrence: yesterday },
    });
    await ok({ kind: 'deleteTask', opId: uuid(0xa4), taskId: uuid(4) });
    expect(first(uuid(0xa4))).toMatchObject({
      kind: 'delete',
      table: 'task',
      id: uuid(4),
    });
    await ok({
      kind: 'setRule',
      opId: uuid(0xa5),
      taskId: uuid(3),
      rule: ruleOf('FREQ=DAILY'),
    });
    expect(first(uuid(0xa5))).toMatchObject({ table: 'task', id: uuid(3) });
  });

  it('delete of a synced parent drops both rows and the task topic while pending', async () => {
    const e = await signedIn(server(TODO, taskRow(1), SUB));
    await e.handle({ kind: 'watch', view: 'all', task: P }, 'A');
    expect(titles('all')).toEqual(expect.arrayContaining(['t1', 't2']));
    hang();
    void e.handle({ kind: 'deleteTask', opId: uuid(0xb1), taskId: P }, 'A');
    await vi.waitFor(() => expect(last('task')).toEqual({ id: P, task: null }));
    expect(titles('all')).not.toContain('t1');
    expect(titles('all')).not.toContain('t2');
  });

  it('delete of a task created offline is invalid: not synced yet', async () => {
    const e = await signedIn(server(TODO));
    send.mockImplementation(offline);
    await e.handle(
      { kind: 'add', opId: uuid(0xb2), id: uuid(0xb3), text: 'x' },
      'A',
    );
    expect(
      await e.handle(
        { kind: 'deleteTask', opId: uuid(0xb4), taskId: uuid(0xb3) },
        'A',
      ),
    ).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        detail: expect.stringContaining('not synced yet'),
      },
    });
  });

  it('a subtask shows in the parent task topic while pending', async () => {
    const e = await signedIn(server(TODO, taskRow(1)));
    await e.handle({ kind: 'watch', view: 'all', task: P }, 'A');
    hang();
    void e.handle(
      {
        kind: 'add',
        opId: uuid(0xb5),
        id: uuid(0xb6),
        text: 'sub',
        parentId: P,
      },
      'A',
    );
    await vi.waitFor(() =>
      expect(last('task')?.task?.subtasks).toEqual([
        { id: uuid(0xb6), title: 'sub', closed: false },
      ]),
    );
  });

  it('a mark with `on` reaches the transport with that date', async () => {
    const srv = server(TODO, DAILY, SUB);
    const e = await signedIn(srv);
    await e.handle(
      {
        kind: 'mark',
        opId: uuid(0xb7),
        taskId: C,
        mark: 'done',
        on: yesterday,
      },
      'A',
    );
    expect(sentOps(srv, 'task_occurrence')).toMatchObject([
      { fields: { occurrence: yesterday } },
    ]);
  });

  it('a rule on a synced one-off shows while pending; three sets, versions v, v+1, v+2', async () => {
    const srv = server(TODO, taskRow(1, { scheduledOn: today }));
    const e = await signedIn(srv);
    await e.handle({ kind: 'watch', view: 'all', task: P }, 'A');
    const v = 1; // the mock server's first version of a row
    send.mockClear();
    hang();
    void e.handle(
      {
        kind: 'setRule',
        opId: uuid(0xb8),
        taskId: P,
        rule: ruleOf('FREQ=DAILY'),
      },
      'A',
    );
    await vi.waitFor(() =>
      expect(last('task')?.task).toMatchObject({
        rrule: 'FREQ=DAILY',
        dtstart: today,
        occurrence: today,
      }),
    );
    const ops = store.pending();
    expect(ops.map((op) => op.kind === 'set' && op.field)).toEqual([
      'dtstart',
      'rrule',
      'scheduledOn',
    ]);
    expect(
      ops.map((op) => (op.kind === 'set' ? op.baseVersion : null)),
    ).toEqual([v, v + 1, v + 2]);
  });

  it('a delete resent after a worker restart sends no second batch', async () => {
    const srv = server(TODO, taskRow(1));
    const first = await signedIn(srv);
    const del: Parameters<Engine['handle']>[0] = {
      kind: 'deleteTask',
      opId: uuid(0xb9),
      taskId: P,
    };
    expect(await first.handle(del, 'A')).toEqual({ ok: true });
    const sent = srv.sent.length;
    const second = await signedIn(srv);
    expect(await second.handle(del, 'A')).toEqual({ ok: true });
    expect(srv.sent).toHaveLength(sent);
  });

  it('each new write while signed out is signed-out', async () => {
    const e = engine();
    await e.start(false);
    for (const command of [
      { kind: 'deleteTask', opId: uuid(0xc1), taskId: P },
      { kind: 'setRule', opId: uuid(0xc2), taskId: P, rule: null },
      { kind: 'add', opId: uuid(0xc3), id: uuid(0xc4), text: 'x', parentId: P },
      {
        kind: 'mark',
        opId: uuid(0xc5),
        taskId: P,
        mark: 'done',
        on: yesterday,
      },
    ] as const) {
      expect(await e.handle(command, 'A')).toMatchObject({
        ok: false,
        failure: { kind: 'signed-out' },
      });
    }
    expect(store.pending()).toEqual([]);
  });
});
