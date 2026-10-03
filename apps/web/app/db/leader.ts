import type { Topics } from '@todoer/client-core';
import {
  CHANNEL,
  LEADER_LOCK,
  leaderLock,
  type Fatal,
  type Init,
} from './protocol';

const WINDOW_MS = 60_000;
const MAX_FAILURES = 3;
const BACKOFF_MS = 500;

/** Wins the lock or queues for it; the winner owns the worker until the tab
 *  goes away. The election lock's promise never settles on purpose: settling
 *  it would hand leadership over while this worker still holds the database. */
export function lead(build: string, hint: () => boolean): void {
  void navigator.locks.request(
    LEADER_LOCK,
    () =>
      new Promise<never>(() => {
        // Its own lock: the tabs hear this leader only while it is held
        // (client.ts), and a discarded page lets go of it at once.
        const leader = crypto.randomUUID();
        void navigator.locks.request(
          leaderLock(leader),
          () =>
            new Promise<void>((release) => {
              serve(build, leader, hint, release);
            }),
        );
      }),
  );
}

function serve(
  build: string,
  leader: string,
  hint: () => boolean,
  release: () => void,
): void {
  // Its own object: the tab's client must hear what this one posts.
  const channel = new BroadcastChannel(CHANNEL);
  const engine = (value: Topics['engine']) =>
    channel.postMessage({
      type: 'publish',
      topic: 'engine',
      value,
      build,
      leader,
    });
  let failures: number[] = [];
  let worker: Worker | undefined;
  // A discarded document's worker lives on for a moment and would answer
  // the next document's hello with a signed-in snapshot before that
  // document's own worker restored the session. Terminating only asks it to
  // stop; letting go of the leader's lock is what makes the tabs ignore it.
  // A page entering the back-forward cache keeps both and comes back.
  addEventListener('pagehide', (e: PageTransitionEvent) => {
    if (e.persisted) return;
    worker?.terminate();
    release();
  });

  const spawn = () => {
    engine({ state: 'starting', reason: null });
    worker = undefined;
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
      worker.postMessage({
        type: 'init',
        build,
        leader,
        hint: hint(),
      } satisfies Init);
    } catch (error) {
      // A throwing constructor (CSP, a blocked script) must not leave the
      // lock held by a leader with no worker and no word to the tabs.
      fail(String(error));
    }
  };

  spawn();
}
