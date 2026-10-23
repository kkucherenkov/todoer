import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, FromWorker, Span } from '@todoer/client-core';
import { connect, type Db } from './client';

const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const grant = (accessToken: string) => ({
  accessToken,
  accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
type Unstamped<T> = T extends unknown ? Omit<T, 'build'> : never;

/** The backend as the page sees it: auth routes, `/engine`, and event
 *  streams the test writes into and ends. */
function server() {
  const calls: { url: string; init: RequestInit }[] = [];
  const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  const state = {
    /** What /auth/refresh answers. */
    refresh: (): Response => json(grant('t1')),
    /** What /engine answers. */
    engine: (_command: Command): Response => json({ ok: true }),
    /** Stream opens to refuse (network error) before one succeeds. */
    failStreams: 0,
  };
  const fetch = vi.fn((input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/api/v1/engine/events')) {
      if (state.failStreams > 0) {
        state.failStreams--;
        return Promise.reject(new TypeError('fetch failed'));
      }
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => void streams.push(controller),
      });
      init.signal?.addEventListener('abort', () => {
        try {
          streams.at(-1)?.error(init.signal?.reason);
        } catch {
          // already closed
        }
      });
      return Promise.resolve(new Response(body));
    }
    if (url === '/api/v1/auth/refresh') {
      return Promise.resolve().then(state.refresh);
    }
    if (url === '/api/v1/auth/login') return Promise.resolve(json(grant('t1')));
    if (url === '/api/v1/auth/logout') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url === '/api/v1/engine') {
      const { command } = JSON.parse(init.body as string) as {
        command: Command;
      };
      return Promise.resolve(state.engine(command));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  const encoder = new TextEncoder();
  return {
    state,
    calls,
    fetch,
    streams,
    push(event: Unstamped<FromWorker>) {
      const data = JSON.stringify({ ...event, build: 'server' });
      streams.at(-1)!.enqueue(encoder.encode(`data: ${data}\n\n`));
    },
    end: () => streams.at(-1)!.close(),
    engineCalls: () =>
      calls
        .filter((c) => c.url === '/api/v1/engine')
        .map((c) => ({
          auth: new Headers(c.init.headers).get('authorization'),
          ...(JSON.parse(c.init.body as string) as {
            tab: string;
            id: number;
            command: Command;
          }),
        })),
    streamCalls: () => calls.filter((c) => c.url.includes('/engine/events')),
  };
}

const ready = {
  type: 'publish',
  topic: 'summary',
  value: { tasks: 0 },
} as const;

let db: Db | undefined;
let s: ReturnType<typeof server>;

beforeEach(() => {
  s = server();
  vi.stubGlobal('fetch', s.fetch);
});
afterEach(() => {
  db?.close();
  db = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Signed in from the cookie, the first stream open and its snapshot in. */
async function signedIn() {
  db = connect(true);
  await vi.waitFor(() => expect(s.streams).toHaveLength(1));
  s.push(ready);
  await vi.waitFor(() => expect(db!.connected.value).toBe(true));
  return db;
}

const settledConnected = () =>
  vi.waitFor(() => expect(db!.connected.value).toBe(true));

describe('the session', () => {
  it('signIn is answered by the page', async () => {
    db = connect(false);
    expect(db.topics.session.value?.state).toBe('signed-out');
    const result = await db.request({
      kind: 'signIn',
      email: 'a@b.c',
      password: 'secret',
    });
    expect(result).toEqual({ ok: true });
    expect(s.calls[0]?.url).toBe('/api/v1/auth/login');
    expect(s.engineCalls()).toEqual([]);
    expect(db.topics.session.value?.state).toBe('signed-in');
    // The stream opens with the new token.
    await vi.waitFor(() => expect(s.streamCalls()).toHaveLength(1));
    expect(
      new Headers(s.streamCalls()[0]!.init.headers).get('authorization'),
    ).toBe('Bearer t1');
  });

  it('without the hint, signs out without asking the server', async () => {
    db = connect(false);
    await pause();
    expect(db.topics.session.value).toEqual({
      state: 'signed-out',
      reason: null,
    });
    // The gate draws the sign-in form only once the engine is ready.
    expect(db.topics.engine.value?.state).toBe('ready');
    expect(s.calls).toEqual([]);
  });

  it('with the hint, restores from the cookie', async () => {
    db = connect(true);
    expect(db.topics.session.value?.state).toBe('restoring');
    expect(db.topics.engine.value?.state).toBe('starting');
    await vi.waitFor(() =>
      expect(db!.topics.session.value?.state).toBe('signed-in'),
    );
    expect(s.calls[0]?.url).toBe('/api/v1/auth/refresh');
  });

  it('says the server cannot be reached while it restores, and recovers', async () => {
    s.state.refresh = () => {
      throw new TypeError('fetch failed');
    };
    db = connect(true);
    await vi.waitFor(() =>
      expect(db!.topics.engine.value).toEqual({
        state: 'starting',
        reason: 'unreachable',
      }),
    );
    // Signed in still: the cookie was never refused, the loop keeps trying.
    expect(db.topics.session.value?.state).toBe('signed-in');
    s.state.refresh = () => json(grant('t1'));
    await vi.waitFor(() => expect(s.streams).toHaveLength(1), {
      timeout: 3000,
    });
    s.push(ready);
    await settledConnected();
    expect(db.topics.engine.value).toEqual({ state: 'ready', reason: null });
  });

  it('a refused cookie signs out', async () => {
    s.state.refresh = () => new Response(null, { status: 401 });
    db = connect(true);
    await vi.waitFor(() =>
      expect(db!.topics.session.value?.state).toBe('signed-out'),
    );
    expect(s.streamCalls()).toEqual([]);
  });

  it('sign-out closes the stream and clears view and task', async () => {
    await signedIn();
    db!.watch('all', 't1');
    s.push({
      type: 'publish',
      topic: 'task',
      value: { id: 't1', task: null },
    });
    await vi.waitFor(() => expect(db!.topics.task.value?.id).toBe('t1'));
    expect(await db!.request({ kind: 'signOut' })).toEqual({ ok: true });
    expect(s.calls.some((c) => c.url === '/api/v1/auth/logout')).toBe(true);
    expect(db!.topics.session.value?.state).toBe('signed-out');
    expect(db!.topics.task.value).toBeUndefined();
    expect(db!.connected.value).toBe(false);
    await pause(30);
    expect(s.streamCalls()).toHaveLength(1);
  });
});

describe('commands', () => {
  it('a command goes to /engine with the bearer', async () => {
    await signedIn();
    expect(await db!.request({ kind: 'sync', reason: 'manual' })).toEqual({
      ok: true,
    });
    const [call] = s.engineCalls();
    expect(call).toMatchObject({
      auth: 'Bearer t1',
      id: expect.any(Number) as number,
      tab: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      command: { kind: 'sync', reason: 'manual' },
    });
  });

  it('a 401 renews once and resends', async () => {
    await signedIn();
    let first = true;
    s.state.refresh = () => json(grant('t2'));
    s.state.engine = () => {
      if (!first) return json({ ok: true });
      first = false;
      return new Response(null, { status: 401 });
    };
    expect(await db!.request({ kind: 'sync', reason: 'manual' })).toEqual({
      ok: true,
    });
    const calls = s.engineCalls();
    expect(calls.map((c) => c.auth)).toEqual(['Bearer t1', 'Bearer t2']);
    // The same request: the server never saw the first.
    expect(calls[1]!.id).toBe(calls[0]!.id);
  });

  it('a 401 that cannot be renewed signs out', async () => {
    await signedIn();
    s.state.refresh = () => new Response(null, { status: 401 });
    s.state.engine = () => new Response(null, { status: 401 });
    expect(await db!.request({ kind: 'sync', reason: 'manual' })).toMatchObject(
      { ok: false, failure: { kind: 'signed-out' } },
    );
    expect(db!.topics.session.value?.state).toBe('signed-out');
  });

  it('a write while disconnected fails as unreachable', async () => {
    db = connect(true);
    await vi.waitFor(() => expect(s.streams).toHaveLength(1));
    const before = s.calls.length;
    expect(await db.write({ kind: 'add', text: 'milk' })).toMatchObject({
      ok: false,
      failure: { kind: 'unreachable' },
    });
    expect(s.calls).toHaveLength(before);
  });

  it('mints a draft once, and a resend reuses its ids', async () => {
    await signedIn();
    const w = db!.mint({ kind: 'add', text: 'milk' });
    await db!.write(w);
    await db!.write(w);
    const [one, two] = s.engineCalls().map((c) => c.command);
    expect(two).toEqual(one);
    expect(one).toMatchObject({ opId: w.opId, id: (w as { id: string }).id });
  });
});

describe('the stream', () => {
  const view = (
    key: string,
    title: string,
    span: Span | null = null,
    layout = span === null ? 'list' : 'calendar',
  ): Unstamped<FromWorker> => ({
    type: 'publish',
    topic: 'view',
    value: {
      key,
      layout,
      sort: 'manual',
      problem: null,
      today: '2026-10-02',
      span,
      items: [{ title } as never],
      placements: [],
    },
  });
  /** A summary after the others: once it lands, they have too. */
  const settled = async (tasks = 9) => {
    s.push({ type: 'publish', topic: 'summary', value: { tasks } });
    await vi.waitFor(() => expect(db!.topics.summary.value).toEqual({ tasks }));
  };

  it('publishes from the stream land in topics', async () => {
    await signedIn();
    db!.watch('v1', null);
    s.push(view('v1', 'mine'));
    s.push(view('v2', 'theirs'));
    s.push({ type: 'publish', topic: 'task', value: { id: 't2', task: null } });
    await settled();
    expect(db!.topics.view.value?.items).toEqual([{ title: 'mine' }]);
    expect(db!.topics.task.value).toBeUndefined();
  });

  it("keeps the page's own session and engine topics", async () => {
    await signedIn();
    s.push({
      type: 'publish',
      topic: 'session',
      value: { state: 'signed-out', reason: null },
    });
    s.push({
      type: 'publish',
      topic: 'engine',
      value: { state: 'failed', reason: 'x' },
    });
    await settled();
    expect(db!.topics.session.value?.state).toBe('signed-in');
    expect(db!.topics.engine.value?.state).toBe('ready');
  });

  it('keeps a publish for its own span and layout only', async () => {
    const WEEK = { from: '2026-10-05', to: '2026-10-11' };
    await signedIn();
    db!.watch('v1', null, WEEK, 'calendar');
    s.push(view('v1', 'mine', WEEK));
    s.push(view('v1', 'other span', { from: '2026-10-12', to: '2026-10-18' }));
    s.push(view('v1', 'list', null));
    await settled();
    expect(db!.topics.view.value?.items).toEqual([{ title: 'mine' }]);
  });

  it('sends the watch once the stream is open', async () => {
    db = connect(true);
    db.watch('v1', 't1');
    await vi.waitFor(() => expect(s.streams).toHaveLength(1));
    expect(s.engineCalls()).toEqual([]);
    s.push(ready);
    await vi.waitFor(() => expect(s.engineCalls()).toHaveLength(1));
    expect(s.engineCalls()[0]!.command).toEqual({
      kind: 'watch',
      view: 'v1',
      task: 't1',
      span: null,
      layout: null,
    });
  });

  it('reconnects and asks for a snapshot', async () => {
    await signedIn();
    db!.watch('v1', null);
    await vi.waitFor(() => expect(s.engineCalls()).toHaveLength(1));
    // The backend went away: the stream ends soon after it opened, and the
    // next open fails.
    s.state.failStreams = 1;
    const endedAt = Date.now();
    s.end();
    await vi.waitFor(() => expect(db!.connected.value).toBe(false));
    expect(db!.topics.engine.value?.state).toBe('ready');
    await pause(500);
    expect(s.streamCalls()).toHaveLength(1); // a short-lived stream waits 1 s
    await vi.waitFor(() => expect(s.streamCalls()).toHaveLength(2), {
      timeout: 2000,
    });
    const failedAt = Date.now();
    expect(failedAt - endedAt).toBeGreaterThanOrEqual(950);
    await vi.waitFor(() => expect(s.streams).toHaveLength(2), {
      timeout: 2000,
    });
    expect(Date.now() - failedAt).toBeGreaterThanOrEqual(950);
    // Lost after it was ready: the gate keeps the app, the footer says it.
    expect(db!.topics.engine.value).toEqual({ state: 'ready', reason: null });
    s.push(ready);
    await vi.waitFor(() => expect(db!.connected.value).toBe(true));
    // The closed stream withdrew the watch: it goes again.
    await vi.waitFor(() => expect(s.engineCalls()).toHaveLength(2));
    expect(s.engineCalls()[1]!.command).toMatchObject({ view: 'v1' });
  });

  it('a stream refused for good signs out', async () => {
    await signedIn();
    s.state.refresh = () => new Response(null, { status: 401 });
    const fetch = s.fetch.getMockImplementation()!;
    s.fetch.mockImplementation((input, init) =>
      String(input).includes('/engine/events')
        ? Promise.resolve(new Response(null, { status: 401 }))
        : fetch(input, init),
    );
    s.end();
    await vi.waitFor(
      () => expect(db!.topics.session.value?.state).toBe('signed-out'),
      { timeout: 3000 },
    );
  });

  it('reopens a stream that ended at its expiry at once, still connected', async () => {
    await signedIn();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 15 * 60_000);
    s.end();
    await vi.waitFor(() => expect(s.streams).toHaveLength(2));
    expect(db!.connected.value).toBe(true);
    s.push(ready);
    await settledConnected();
  });

  it('keeps the token out of the stream URL', async () => {
    await signedIn();
    const [call] = s.streamCalls();
    expect(call!.url).toMatch(/^\/api\/v1\/engine\/events\?tab=[0-9a-f-]{36}$/);
    expect(call!.url).not.toContain('t1');
    expect(new Headers(call!.init.headers).get('authorization')).toBe(
      'Bearer t1',
    );
  });
});
