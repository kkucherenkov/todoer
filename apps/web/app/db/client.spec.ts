import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { connect, type Db } from './client';
import type { FromWorker, Span, ToWorker } from '@todoer/client-core';
import { CHANNEL, leaderLock } from './protocol';

const BUILD = 'b1';
/** A leader whose lock is held for the whole file, as a live page holds it. */
const LIVE = 'live-leader';
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Db | undefined;
let worker: BroadcastChannel | undefined;
let release: () => void;

beforeAll(async () => {
  await new Promise<void>((granted) => {
    void navigator.locks.request(
      leaderLock(LIVE),
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          granted();
        }),
    );
  });
});
afterAll(() => release());

afterEach(() => {
  db?.close();
  worker?.close();
  db = worker = undefined;
  vi.restoreAllMocks();
});

/** A worker stand-in: a second channel object, answering what it is told,
 *  every message stamped with its leader's id. */
function fakeWorker(
  answer?: (m: ToWorker) => FromWorker | undefined,
  leader = LIVE,
) {
  const seen: ToWorker[] = [];
  worker = new BroadcastChannel(CHANNEL);
  worker.onmessage = ({ data }: MessageEvent<ToWorker>) => {
    seen.push(data);
    const reply = answer?.(data);
    if (reply !== undefined) post(reply);
  };
  const post = (m: FromWorker) => worker!.postMessage({ ...m, leader });
  return { seen, post };
}

const ok = (m: ToWorker): FromWorker | undefined =>
  m.type === 'request'
    ? {
        type: 'reply',
        tab: m.tab,
        id: m.id,
        result: { ok: true },
        build: BUILD,
      }
    : undefined;

describe('connect', () => {
  it('answers a request posted before any worker exists, once one is ready', async () => {
    db = connect(BUILD);
    const answer = db.request({ kind: 'sync', reason: 'manual' });
    await pause();
    const { seen, post } = fakeWorker(ok);
    await pause();
    expect(seen).toEqual([]); // the first post went to nobody
    post({ type: 'ready', build: BUILD });
    expect(await answer).toEqual({ ok: true });
    // A restarted worker has no subscribers: the tab says hello again.
    expect(seen.map((m) => m.type)).toEqual(['hello', 'request']);
  });

  it('resends what is pending on ready only, never on a publish', async () => {
    const { seen, post } = fakeWorker();
    db = connect(BUILD);
    void db.request({ kind: 'signIn', email: 'a@b.c', password: 'x' });
    await vi.waitFor(() =>
      expect(seen.map((m) => m.type)).toEqual(['hello', 'request']),
    );
    // What the worker answers a stale tab's hello with: the snapshot.
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 1 },
      build: BUILD,
    });
    await vi.waitFor(() =>
      expect(db!.topics.summary.value).toEqual({ tasks: 1 }),
    );
    await pause();
    expect(seen.map((m) => m.type)).toEqual(['hello', 'request']);
  });

  it("ignores a reply for another tab's id", async () => {
    db = connect(BUILD);
    fakeWorker((m) =>
      m.type === 'request'
        ? {
            type: 'reply',
            tab: 'another-tab',
            id: m.id,
            result: {
              ok: false,
              failure: { kind: 'refused', detail: 'not yours' },
            },
            build: BUILD,
          }
        : undefined,
    );
    await pause();
    const answer = db.request({ kind: 'signOut' });
    let settled = false;
    void answer.then(() => (settled = true));
    await pause(30);
    expect(settled).toBe(false);
  });

  it("times a request out as 'unavailable'", async () => {
    db = connect(BUILD, { timeoutMs: 50 });
    const answer = await db.request({ kind: 'sync', reason: 'manual' });
    expect(answer).toMatchObject({
      ok: false,
      failure: { kind: 'unavailable' },
    });
  });

  it("resolves what is pending as 'unavailable' on close", async () => {
    db = connect(BUILD);
    const answer = db.request({ kind: 'signOut' });
    db.close();
    expect(await answer).toMatchObject({
      ok: false,
      failure: { kind: 'unavailable' },
    });
  });

  it('sends hello, and publish messages update the topics', async () => {
    const { seen, post } = fakeWorker();
    db = connect(BUILD);
    await vi.waitFor(() => expect(seen.map((m) => m.type)).toContain('hello'));
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 4 },
      build: BUILD,
    });
    await vi.waitFor(() =>
      expect(db!.topics.summary.value).toEqual({ tasks: 4 }),
    );
    expect(db.stale.value).toBe(false);
  });

  it('a message from another build sets stale and changes nothing else', async () => {
    const { post } = fakeWorker();
    db = connect(BUILD);
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 4 },
      build: 'b2',
    });
    await vi.waitFor(() => expect(db!.stale.value).toBe(true));
    expect(db.topics.summary.value).toBeUndefined();
  });

  it('logs a violation from inside the worker with console.error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { post } = fakeWorker();
    db = connect(BUILD);
    post({
      type: 'violation',
      directive: 'connect-src',
      blocked: 'https://example.com',
      build: BUILD,
    });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[csp]',
        'connect-src',
        'https://example.com',
      ),
    );
  });
});

describe('the leader a tab listens to', () => {
  const signedIn = {
    type: 'publish',
    topic: 'session',
    value: { state: 'signed-in', reason: null },
    build: BUILD,
  } as const;

  it("ignores a worker whose page is gone: its leader's lock is not held", async () => {
    // A reload: the old page's worker answers the new page's hello.
    const { post } = fakeWorker(
      (m) => (m.type === 'hello' ? signedIn : undefined),
      'gone-leader',
    );
    db = connect(BUILD);
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 3 },
      build: BUILD,
    });
    await pause(50);
    expect(db.topics.session.value).toBeUndefined();
    expect(db.topics.summary.value).toBeUndefined();
  });

  it('switches to a leader whose lock is held, and stays off the gone one', async () => {
    db = connect(BUILD);
    const gone = fakeWorker(undefined, 'gone-leader');
    gone.post(signedIn);
    const live = fakeWorker((m) =>
      m.type === 'hello'
        ? { ...signedIn, value: { state: 'restoring', reason: null } }
        : undefined,
    );
    live.post({ type: 'ready', build: BUILD });
    await vi.waitFor(() =>
      expect(db!.topics.session.value).toEqual({
        state: 'restoring',
        reason: null,
      }),
    );
    gone.post(signedIn);
    await pause(50);
    expect(db.topics.session.value?.state).toBe('restoring');
  });

  it('keeps the order of what arrives while it checks a new leader', async () => {
    const { post } = fakeWorker();
    db = connect(BUILD);
    for (const tasks of [1, 2, 3]) {
      post({
        type: 'publish',
        topic: 'summary',
        value: { tasks },
        build: BUILD,
      });
    }
    await pause(50);
    expect(db.topics.summary.value).toEqual({ tasks: 3 });
  });
});

describe('watches and writes', () => {
  const view = (
    key: string,
    title: string,
    span: Span | null = null,
  ): FromWorker => ({
    type: 'publish',
    topic: 'view',
    value: {
      key,
      layout: span === null ? 'list' : 'calendar',
      sort: 'manual',
      problem: null,
      today: '2026-10-02',
      span,
      items: [{ title } as never],
      placements: [],
    },
    build: BUILD,
  });
  const WEEK = { from: '2026-10-05', to: '2026-10-11' };
  const NEXT = { from: '2026-10-12', to: '2026-10-18' };
  const requests = (seen: ToWorker[]) =>
    seen.flatMap((m) => (m.type === 'request' ? [m.command] : []));

  it('keeps a publish for its own span only', async () => {
    const { post } = fakeWorker();
    db = connect(BUILD);
    db.watch('v1', null, WEEK);
    post(view('v1', 'mine', WEEK));
    await vi.waitFor(() => expect(db!.topics.view.value?.span).toEqual(WEEK));
    post(view('v1', 'other span', NEXT));
    post(view('v1', 'no span'));
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 9 },
      build: BUILD,
    });
    await vi.waitFor(() =>
      expect(db!.topics.summary.value).toEqual({ tasks: 9 }),
    );
    expect(db.topics.view.value?.items).toEqual([{ title: 'mine' }]);
    // Another span: the grid never draws the old one's data.
    db.watch('v1', null, NEXT);
    expect(db.topics.view.value).toBeUndefined();
  });

  it('on ready: the last watch is resent with its span', async () => {
    const { seen, post } = fakeWorker();
    db = connect(BUILD);
    db.watch('v1', null, WEEK);
    await vi.waitFor(() => expect(requests(seen)).toHaveLength(1));
    seen.length = 0;
    post({ type: 'ready', build: BUILD });
    await vi.waitFor(() => expect(requests(seen)).toHaveLength(1));
    expect(requests(seen)).toEqual([
      { kind: 'watch', view: 'v1', task: null, span: WEEK },
    ]);
  });

  it('mints the copy id of a move once, and a resend reuses it', async () => {
    const { seen } = fakeWorker();
    db = connect(BUILD, { timeoutMs: 30 });
    const w = db.mint({
      kind: 'moveOccurrence',
      taskId: 't1',
      occurrence: '2026-10-05',
      to: '2026-10-06',
    });
    expect(w).toMatchObject({
      id: expect.any(String),
      opId: expect.any(String),
    });
    await db.write(w);
    void db.write(w);
    const moves = () =>
      requests(seen).filter((c) => c.kind === 'moveOccurrence');
    await vi.waitFor(() => expect(moves()).toHaveLength(2));
    expect(moves()[1]).toEqual(moves()[0]);
    expect(moves()[0]).toMatchObject({ id: (w as { id: string }).id });
  });

  it("keeps its own view key and drops another tab's", async () => {
    const { seen, post } = fakeWorker();
    db = connect(BUILD);
    db.watch('v1', null);
    await vi.waitFor(() =>
      expect(
        seen.some((m) => m.type === 'request' && m.command.kind === 'watch'),
      ).toBe(true),
    );
    post(view('v1', 'mine'));
    await vi.waitFor(() => expect(db!.topics.view.value?.key).toBe('v1'));
    post(view('v2', 'theirs'));
    post({
      type: 'publish',
      topic: 'summary',
      value: { tasks: 9 },
      build: BUILD,
    });
    await vi.waitFor(() =>
      expect(db!.topics.summary.value).toEqual({ tasks: 9 }),
    );
    expect(db.topics.view.value?.items).toEqual([{ title: 'mine' }]);
  });

  it('on ready: the last watch first, then the pending write with the same ids', async () => {
    const { seen, post } = fakeWorker();
    db = connect(BUILD);
    db.watch('v1', 't1');
    void db.write({ kind: 'add', text: 'milk' });
    const requests = () =>
      seen.flatMap((m) => (m.type === 'request' ? [m.command] : []));
    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    const [, sent] = requests();
    expect(sent).toMatchObject({
      kind: 'add',
      opId: expect.any(String),
      id: expect.any(String),
    });
    seen.length = 0;
    post({ type: 'ready', build: BUILD });
    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    expect(requests()).toEqual([
      { kind: 'watch', view: 'v1', task: 't1', span: null },
      sent,
    ]);
  });

  it('a retry of a minted write reuses its ids', async () => {
    const { seen } = fakeWorker();
    db = connect(BUILD, { timeoutMs: 30 });
    const w = db.mint({ kind: 'add', text: 'milk' });
    expect(await db.write(w)).toMatchObject({
      failure: { kind: 'unavailable' },
    });
    void db.write(w);
    const adds = () =>
      seen.flatMap((m) =>
        m.type === 'request' && m.command.kind === 'add' ? [m.command] : [],
      );
    await vi.waitFor(() => expect(adds()).toHaveLength(2));
    expect(adds()[1]).toEqual(adds()[0]);
    expect(adds()[0]).toMatchObject({
      opId: w.opId,
      id: (w as { id: string }).id,
    });
  });

  it('a session that is not signed in clears the keyed topics', async () => {
    const { post } = fakeWorker();
    db = connect(BUILD);
    db.watch('v1', null);
    post(view('v1', 'mine'));
    await vi.waitFor(() => expect(db!.topics.view.value?.key).toBe('v1'));
    post({
      type: 'publish',
      topic: 'session',
      value: { state: 'signed-out', reason: null },
      build: BUILD,
    });
    await vi.waitFor(() => expect(db!.topics.view.value).toBeUndefined());
  });
});
