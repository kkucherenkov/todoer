import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import {
  cookieTokenSource,
  httpTransport,
  RefusalError,
  type AccessGrant,
  type CookieAuthApi,
  type CookieTokenSource,
  type Store,
  type Transport,
} from '@todoer/client-core';
import { openWasmStore } from '@todoer/client-core/sqlite-wasm';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createEngine, dispatcher } from './engine';
import type { Result, ToWorker, Topic, Topics } from './protocol';

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
/** The canned answer: two live tasks and one deleted. */
const CANNED = {
  cursor: 3,
  results: [],
  changes: [
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
  store.close();
  vi.unstubAllGlobals();
});

let clock = NOW;
const engine = (transport: Transport = send) =>
  createEngine({
    store,
    auth,
    tokens,
    send: transport,
    now: () => clock,
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
      json({ cursor: id ? 3 : 0, results: [], changes: id ? [task(id)] : [] });
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
