import type { Topics } from '@todoer/client-core';
import { CHANNEL, LEADER_LOCK, type Fatal, type Init } from './protocol';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 3;
const BACKOFF_MS = 500;

/** Wins the lock or queues for it; the winner owns the worker until the tab
 *  goes away. The callback's promise never settles on purpose: settling it
 *  would hand leadership over while this worker still holds the database. */
export function lead(build: string, hint: () => boolean): void {
  void navigator.locks.request(
    LEADER_LOCK,
    () =>
      new Promise<never>(() => {
        serve(build, hint);
      }),
  );
}

function serve(build: string, hint: () => boolean): void {
  // Its own object: the tab's client must hear what this one posts.
  const channel = new BroadcastChannel(CHANNEL);
  const engine = (value: Topics['engine']) =>
    channel.postMessage({ type: 'publish', topic: 'engine', value, build });
  let failures: number[] = [];

  const spawn = () => {
    engine({ state: 'starting', reason: null });
    let worker: Worker | undefined;
    let dead = false;
    const fail = (reason: string) => {
      if (dead) return; // error and fatal from one worker are one failure
      dead = true;
      worker?.terminate();
      const now = Date.now();
      failures = [...failures.filter((t) => now - t < WINDOW_MS), now];
      if (failures.length >= MAX_FAILURES) {
        return engine({ state: 'failed', reason });
      }
      setTimeout(spawn, BACKOFF_MS * failures.length);
    };
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
        name: 'todoer-db',
      });
      worker.onerror = (event) => {
        event.preventDefault();
        fail(event.message || 'the database worker crashed');
      };
      worker.onmessageerror = () =>
        fail('the database worker sent an unreadable message');
      worker.onmessage = ({ data }: MessageEvent<Fatal>) => {
        if (data.type === 'fatal') fail(data.reason);
      };
      worker.postMessage({ type: 'init', build, hint: hint() } satisfies Init);
    } catch (error) {
      // A throwing constructor (CSP, a blocked script) must not leave the
      // lock held by a leader with no worker and no word to the tabs.
      fail(String(error));
    }
  };

  spawn();
}
