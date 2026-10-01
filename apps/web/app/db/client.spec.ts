import { afterEach, describe, expect, it, vi } from 'vitest';
import { connect, type Db } from './client';
import { CHANNEL, type FromWorker, type ToWorker } from './protocol';

const BUILD = 'b1';
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

let db: Db | undefined;
let worker: BroadcastChannel | undefined;

afterEach(() => {
  db?.close();
  worker?.close();
  db = worker = undefined;
  vi.restoreAllMocks();
});

/** A worker stand-in: a second channel object, answering what it is told. */
function fakeWorker(answer?: (m: ToWorker) => FromWorker | undefined) {
  const seen: ToWorker[] = [];
  worker = new BroadcastChannel(CHANNEL);
  worker.onmessage = ({ data }: MessageEvent<ToWorker>) => {
    seen.push(data);
    const reply = answer?.(data);
    if (reply !== undefined) worker!.postMessage(reply);
  };
  const post = (m: FromWorker) => worker!.postMessage(m);
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
