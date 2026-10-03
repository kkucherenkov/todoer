import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lead } from './leader';
import type { Topics } from '@todoer/client-core';
import { LEADER_LOCK, leaderLock } from './protocol';

class FakeWorker {
  static all: FakeWorker[] = [];
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null =
    null;
  onmessageerror: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.all.push(this);
  }
  postMessage(m: unknown) {
    this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  fatal(reason: string) {
    this.onmessage?.({ data: { type: 'fatal', reason } });
  }
}

/** Every message any channel object posted, in order. */
let broadcast: {
  topic?: string;
  value?: unknown;
  build?: string;
  leader?: string;
}[];
class FakeChannel {
  constructor(readonly name: string) {}
  postMessage(m: (typeof broadcast)[number]) {
    broadcast.push(m);
  }
  close() {}
}

/** The window's listeners: a test fires `pagehide` through them. */
let listeners: Map<string, (e: { persisted: boolean }) => void>;
let grant: () => void;
let lockName: string | undefined;
/** The leader's own lock: nobody else asks for its name, so it is granted
 *  at once. */
let ownLock: string | undefined;
let ownReleased = false;
let held: Promise<unknown> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.all = [];
  broadcast = [];
  lockName = ownLock = held = undefined;
  ownReleased = false;
  listeners = new Map();
  vi.stubGlobal(
    'addEventListener',
    (type: string, listener: (e: { persisted: boolean }) => void) =>
      listeners.set(type, listener),
  );
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  vi.stubGlobal('navigator', {
    locks: {
      // Queues like the real one: the callback runs once the lock is granted.
      request(name: string, callback: () => Promise<unknown>) {
        if (name !== LEADER_LOCK) {
          ownLock = name;
          return callback().then(() => (ownReleased = true));
        }
        lockName = name;
        return new Promise((resolve) => {
          grant = () => {
            held = callback();
            resolve(held);
          };
        });
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const engine = () =>
  broadcast
    .filter((m) => m.topic === 'engine')
    .map((m) => m.value as Topics['engine']);

describe('lead', () => {
  it('waits for the lock, then spawns one module worker and sends Init', () => {
    let hint = true;
    lead('b1', () => hint);
    expect(lockName).toBe(LEADER_LOCK);
    expect(FakeWorker.all).toHaveLength(0);

    hint = false;
    grant();
    expect(FakeWorker.all).toHaveLength(1);
    const [worker] = FakeWorker.all;
    expect(worker!.url.pathname).toMatch(/\/worker\.ts$/);
    expect(worker!.options).toEqual({ type: 'module', name: 'todoer-db' });
    expect(worker!.posted).toEqual([
      { type: 'init', build: 'b1', leader: expect.any(String), hint: false },
    ]);
    expect(engine()).toEqual([{ state: 'starting', reason: null }]);
    expect(broadcast.every((m) => m.build === 'b1')).toBe(true);
  });

  // A worker outlives its page for a moment: a tab tells it from the next
  // leader's by this lock, which the page released (client.ts).
  it('holds a lock named after its id, and stamps the id on all it posts', () => {
    lead('b1', () => true);
    expect(ownLock).toBeUndefined();
    grant();
    const { leader } = FakeWorker.all[0]!.posted[0] as { leader: string };
    expect(ownLock).toBe(leaderLock(leader));
    FakeWorker.all[0]!.fatal('no OPFS');
    vi.advanceTimersByTime(500);
    // The respawned worker is the same leader's.
    expect(FakeWorker.all[1]!.posted[0]).toMatchObject({ leader });
    expect(broadcast.length).toBeGreaterThan(1);
    expect(broadcast.every((m) => m.leader === leader)).toBe(true);
  });

  it('never settles the lock callback while the tab lives', async () => {
    lead('b1', () => false);
    grant();
    let settled = false;
    void held!.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
  });

  it('respawns after 500 ms × failures, and reports failed on the third within a minute', () => {
    lead('b1', () => true);
    grant();
    FakeWorker.all[0]!.fatal('no OPFS');
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    vi.advanceTimersByTime(499);
    expect(FakeWorker.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWorker.all).toHaveLength(2);

    FakeWorker.all[1]!.onerror?.({ message: 'crashed', preventDefault() {} });
    vi.advanceTimersByTime(999);
    expect(FakeWorker.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWorker.all).toHaveLength(3);

    FakeWorker.all[2]!.onmessageerror?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWorker.all).toHaveLength(3);
    expect(FakeWorker.all[2]!.terminated).toBe(true);
    expect(engine().at(-1)).toMatchObject({ state: 'failed' });
    expect(engine().at(-1)!.reason).toBeTruthy();
  });

  it('reports the last reason, and counts one dead worker once', () => {
    lead('b1', () => true);
    grant();
    const w = () => FakeWorker.all.at(-1)!;
    w().onerror?.({ message: 'first', preventDefault() {} });
    w().fatal('first again'); // the same worker: not a second failure
    vi.advanceTimersByTime(500);
    expect(FakeWorker.all).toHaveLength(2);
    w().fatal('second');
    expect(engine().at(-1)?.state).toBe('starting'); // two failures, not three
    vi.advanceTimersByTime(1000);
    w().fatal('third');
    expect(engine().at(-1)).toEqual({ state: 'failed', reason: 'third' });
  });

  it('forgets failures older than a minute', () => {
    lead('b1', () => true);
    grant();
    const w = () => FakeWorker.all.at(-1)!;
    w().fatal('one');
    vi.advanceTimersByTime(500);
    w().fatal('two');
    vi.advanceTimersByTime(61_000);
    w().fatal('three');
    vi.advanceTimersByTime(1000); // two inside the minute: 500 ms × 2
    expect(FakeWorker.all).toHaveLength(4);
    expect(engine().at(-1)).toEqual({ state: 'starting', reason: null });
  });

  // A reload's old worker outlived its document and answered the new tab's
  // hello: the new tab showed the shell before its own worker signed in.
  it('terminates the worker and lets go of its own lock when the page is discarded', async () => {
    lead('b1', () => true);
    grant();
    listeners.get('pagehide')?.({ persisted: false });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    await vi.waitFor(() => expect(ownReleased).toBe(true));
  });

  it('keeps the worker and its own lock of a page entering the back-forward cache', async () => {
    lead('b1', () => true);
    grant();
    listeners.get('pagehide')?.({ persisted: true });
    expect(FakeWorker.all[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(ownReleased).toBe(false);
  });

  it('counts a Worker constructor that throws as a failure, not a dead lock', () => {
    let tries = 0;
    vi.stubGlobal('Worker', function () {
      tries++;
      throw new Error('SecurityError: worker blocked');
    });
    lead('b1', () => true);
    grant();
    vi.advanceTimersByTime(500 + 1000);
    expect(tries).toBe(3);
    expect(engine().at(-1)).toEqual({
      state: 'failed',
      reason: 'Error: SecurityError: worker blocked',
    });
  });
});
