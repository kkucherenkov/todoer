// Imported, not auto-imported: the spec runs in plain Node.
import { shallowRef, type ShallowRef } from 'vue';
import {
  CHANNEL,
  type Command,
  type FromWorker,
  type Result,
  type ToWorker,
  type Topic,
  type Topics,
} from './protocol';

export type Db = {
  request(command: Command): Promise<Result>;
  topics: { [T in Topic]: Readonly<ShallowRef<Topics[T] | undefined>> };
  /** A message from another build arrived: this tab or the leader is stale. */
  stale: Readonly<ShallowRef<boolean>>;
  close(): void;
};

type Pending = {
  command: Command;
  resolve: (result: Result) => void;
  timer: ReturnType<typeof setTimeout>;
};

const unavailable = (detail: string): Result => ({
  ok: false,
  failure: { kind: 'unavailable', detail },
});

type Unstamped<T> = T extends unknown ? Omit<T, 'build'> : never;

/** This tab's side of the protocol, leader or follower alike. */
export function connect(
  build: string,
  { timeoutMs = 20_000 }: { timeoutMs?: number } = {},
): Db {
  const tab = crypto.randomUUID();
  // Its own object, never the leader's: a channel does not hear itself.
  const channel = new BroadcastChannel(CHANNEL);
  const post = (m: Unstamped<ToWorker>) => channel.postMessage({ ...m, build });
  const topics = {
    engine: shallowRef<Topics['engine']>(),
    session: shallowRef<Topics['session']>(),
    sync: shallowRef<Topics['sync']>(),
    summary: shallowRef<Topics['summary']>(),
  };
  const stale = shallowRef(false);
  const pending = new Map<number, Pending>();
  let lastId = 0;

  channel.onmessage = ({ data: m }: MessageEvent<FromWorker>) => {
    if (m.build !== build) return void (stale.value = true);
    switch (m.type) {
      case 'ready':
        // A worker (re)started: whatever it never saw goes again.
        post({ type: 'hello', tab });
        for (const [id, { command }] of pending) {
          post({ type: 'request', tab, id, command });
        }
        return;
      case 'reply': {
        const waiting = m.tab === tab ? pending.get(m.id) : undefined;
        if (waiting === undefined) return;
        clearTimeout(waiting.timer);
        pending.delete(m.id);
        return waiting.resolve(m.result);
      }
      case 'publish':
        return void ((topics[m.topic] as ShallowRef<unknown>).value = m.value);
      case 'violation':
        // Task 7's fixture fails the run on this line.
        return console.error('[csp]', m.directive, m.blocked);
    }
  };
  post({ type: 'hello', tab });

  return {
    request(command) {
      return new Promise((resolve) => {
        const id = ++lastId;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(
            unavailable(`no database worker answered within ${timeoutMs} ms`),
          );
        }, timeoutMs);
        pending.set(id, { command, resolve, timer });
        post({ type: 'request', tab, id, command });
      });
    },
    topics,
    stale,
    close() {
      for (const { timer, resolve } of pending.values()) {
        clearTimeout(timer);
        resolve(unavailable('the connection to the database worker closed'));
      }
      pending.clear();
      channel.close();
    },
  };
}
