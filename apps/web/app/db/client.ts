// Imported, not auto-imported: the spec runs in plain Node.
import { shallowRef, type ShallowRef } from 'vue';
import type {
  Command,
  FromWorker,
  Result,
  Span,
  ToWorker,
  Topic,
  Topics,
  Write,
} from '@todoer/client-core';
import { id as mintId, opId as mintOpId } from './mint';
import { CHANNEL } from './protocol';

/** A write as a screen asks for it: the ids are minted here, once. A create
 *  may name its own `id` (to open it right away). */
export type Draft<W = Write> = W extends {
  kind: 'add' | 'saveView' | 'saveStatus' | 'moveOccurrence';
}
  ? Omit<W, 'opId' | 'id'> & { id?: string }
  : W extends Write
    ? Omit<W, 'opId'>
    : never;

export type Db = {
  request(command: Command): Promise<Result>;
  /** Mints a draft's ids. Keep the result to retry: a new mint is a new
   *  operation, and a slow first attempt may already have applied. */
  mint(draft: Draft): Write;
  /** Requests a write; a draft is minted first. A resend reuses the ids. */
  write(write: Draft | Write): Promise<Result>;
  /** What this tab shows; publishes for other keys, or for another span,
   *  are dropped. */
  watch(view: string | null, task: string | null, span?: Span | null): void;
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
    catalog: shallowRef<Topics['catalog']>(),
    view: shallowRef<Topics['view']>(),
    task: shallowRef<Topics['task']>(),
  };
  const stale = shallowRef(false);
  const pending = new Map<number, Pending>();
  let lastId = 0;
  let watching: Command & { kind: 'watch'; span: Span | null } = {
    kind: 'watch',
    view: null,
    task: null,
    span: null,
  };
  const sameSpan = (a: Span | null, b: Span | null) =>
    a === b || (a?.from === b?.from && a?.to === b?.to);
  // Fire and forget: the next `ready` resends it, so nothing waits on it.
  const postWatch = (command: Command & { kind: 'watch' }) =>
    post({ type: 'request', tab, id: ++lastId, command });

  channel.onmessage = ({ data: m }: MessageEvent<FromWorker>) => {
    if (m.build !== build) return void (stale.value = true);
    switch (m.type) {
      case 'ready':
        // A worker (re)started: whatever it never saw goes again, what
        // this tab shows first.
        post({ type: 'hello', tab });
        if (watching.view !== null || watching.task !== null) {
          postWatch(watching);
        }
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
        // Defence in depth: the worker publishes nothing of the replica to a
        // session that is not signed in, and this tab drops what it holds.
        if (m.topic === 'session' && m.value.state !== 'signed-in') {
          topics.view.value = topics.task.value = undefined;
        }
        // Keyed topics: another tab's keys reach this channel too.
        if (
          m.topic === 'view' &&
          (m.value.key !== watching.view ||
            !sameSpan(m.value.span, watching.span))
        ) {
          return;
        }
        if (m.topic === 'task' && m.value.id !== watching.task) return;
        return void ((topics[m.topic] as ShallowRef<unknown>).value = m.value);
      case 'violation':
        // Task 7's fixture fails the run on this line.
        return console.error('[csp]', m.directive, m.blocked);
    }
  };
  post({ type: 'hello', tab });

  // A hidden page shows nothing; one restored from the back-forward cache
  // shows what it did. Absent in Node (the specs).
  const hide = () =>
    postWatch({ kind: 'watch', view: null, task: null, span: null });
  const show = (e: PageTransitionEvent) => e.persisted && postWatch(watching);
  globalThis.addEventListener?.('pagehide', hide);
  globalThis.addEventListener?.('pageshow', show);

  function request(command: Command): Promise<Result> {
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
  }

  const mint = (draft: Draft): Write =>
    draft.kind === 'add' ||
    draft.kind === 'saveView' ||
    draft.kind === 'saveStatus' ||
    draft.kind === 'moveOccurrence'
      ? { id: mintId(), ...draft, opId: mintOpId() }
      : { ...draft, opId: mintOpId() };

  return {
    request,
    mint,
    write: (w) => request('opId' in w ? w : mint(w)),
    watch(view, task, span = null) {
      if (view !== watching.view || !sameSpan(span, watching.span)) {
        topics.view.value = undefined;
      }
      if (task !== watching.task) topics.task.value = undefined;
      watching = { kind: 'watch', view, task, span };
      postWatch(watching);
    },
    topics,
    stale,
    close() {
      for (const { timer, resolve } of pending.values()) {
        clearTimeout(timer);
        resolve(unavailable('the connection to the database worker closed'));
      }
      pending.clear();
      globalThis.removeEventListener?.('pagehide', hide);
      globalThis.removeEventListener?.('pageshow', show);
      channel.close();
    },
  };
}
