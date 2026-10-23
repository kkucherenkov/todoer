// Imported, not auto-imported: the spec runs in plain Node.
import { shallowRef, type ShallowRef } from 'vue';
import {
  cookieTokenSource,
  httpCookieAuthApi,
  mint as coreMint,
  RefusalError,
  type AccessGrant,
  type Command,
  type Draft,
  type Failure,
  type FromWorker,
  type Result,
  type Span,
  type Topic,
  type Topics,
  type Write,
} from '@todoer/client-core';
import { savedLayoutOf, type Layout } from '../utils/layout';
import { id as mintId } from './mint';
import { readEvents } from './stream';

export type { Draft };

export type Db = {
  request(command: Command): Promise<Result>;
  /** Mints a draft's ids. Keep the result to retry: a new mint is a new
   *  operation, and a slow first attempt may already have applied. */
  mint(draft: Draft): Write;
  /** Requests a write; a draft is minted first. A resend reuses the ids. */
  write(write: Draft | Write): Promise<Result>;
  /** What this tab shows; `layout` overrides the saved one, null keeps it.
   *  Publishes for another key, span or layout are dropped. */
  watch(
    view: string | null,
    task: string | null,
    span?: Span | null,
    layout?: Layout | null,
  ): void;
  topics: { [T in Topic]: Readonly<ShallowRef<Topics[T] | undefined>> };
  /** The event stream is open: what the topics show is the server's, and a
   *  write can reach it. False disables every write control. */
  connected: Readonly<ShallowRef<boolean>>;
  close(): void;
};

const OK: Result = { ok: true };
const fail = (kind: Failure['kind'], detail: string): Result => ({
  ok: false,
  failure: { kind, detail },
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** A call that threw. fetch rejects with a TypeError offline and a
 *  DOMException on timeout; the auth calls throw a RefusalError. */
const thrown = (error: unknown): Result =>
  fail(
    error instanceof RefusalError
      ? 'refused'
      : error instanceof TypeError || error instanceof DOMException
        ? 'unreachable'
        : 'unexpected',
    message(error),
  );

const FIRST_RETRY_MS = 1000;
const LAST_RETRY_MS = 30_000;
/** A stream that lived this long ended normally (its token expired) and is
 *  reopened at once; a shorter one waits FIRST_RETRY_MS first. */
const LIVED_MS = 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
      once: true,
    });
  });

/**
 * The tab's side of the server's engine (design, "Decision"): commands go to
 * `POST /engine`, topics come over this tab's event stream. Sign-in,
 * registration and sign-out never reach the engine: the page calls `/auth`
 * itself and builds the `session` and `engine` topics from its own state.
 * `hint`: a cookie session may exist; without it no refresh is tried, since
 * each refused one counts against the IP's rate limit.
 */
export function connect(
  hint: boolean,
  { base = '/api/v1', timeoutMs = 20_000 } = {},
): Db {
  const tab = crypto.randomUUID();
  const auth = httpCookieAuthApi({ base, timeoutMs });
  const tokens = cookieTokenSource(auth, () => new Date());
  const topics = {
    engine: shallowRef<Topics['engine']>({ state: 'starting', reason: null }),
    session: shallowRef<Topics['session']>({
      state: 'restoring',
      reason: null,
    }),
    sync: shallowRef<Topics['sync']>(),
    summary: shallowRef<Topics['summary']>(),
    catalog: shallowRef<Topics['catalog']>(),
    view: shallowRef<Topics['view']>(),
    task: shallowRef<Topics['task']>(),
  };
  const connected = shallowRef(false);
  let lastId = 0;
  let watching: Command & {
    kind: 'watch';
    span: Span | null;
    layout: Layout | null;
  } = { kind: 'watch', view: null, task: null, span: null, layout: null };
  const sameSpan = (a: Span | null, b: Span | null) =>
    a === b || (a?.from === b?.from && a?.to === b?.to);
  let stream: AbortController | undefined;

  const engine = (
    state: Topics['engine']['state'],
    reason: string | null = null,
  ) => (topics.engine.value = { state, reason });
  const session = (
    state: Topics['session']['state'],
    reason: Failure['kind'] | null = null,
  ) => (topics.session.value = { state, reason });

  /** Calls with the current token; a 401 renews it once and calls again. */
  const authed = async (
    call: (headers: Record<string, string>) => Promise<Response>,
  ) => {
    const token = await tokens.current();
    const response = await call({ authorization: `Bearer ${token}` });
    if (response.status !== 401) return response;
    // The cookie source never answers null: a refusal throws.
    const renewed = (await tokens.renew(token)) ?? '';
    return call({ authorization: `Bearer ${renewed}` });
  };

  /** Signed out: the stream closes and nothing of the account stays. The
   *  engine topic is ready, since there is nothing to start: the gate draws
   *  the sign-in form. */
  const end = (reason: Failure['kind'] | null = null) => {
    tokens.adopt(undefined);
    stream?.abort();
    stream = undefined;
    connected.value = false;
    for (const t of ['sync', 'summary', 'catalog', 'view', 'task'] as const) {
      topics[t].value = undefined;
    }
    engine('ready');
    session('signed-out', reason);
  };

  /** A token the server will not renew ends the session; any other failure
   *  leaves it as it is. */
  const failed = (error: unknown): Result => {
    if (error instanceof RefusalError && !tokens.signedIn()) {
      end('signed-out');
      return fail('signed-out', error.message);
    }
    return thrown(error);
  };

  const send = async (command: Command): Promise<Result> => {
    // One id for the resend after a 401: the server never saw the first.
    const body = JSON.stringify({ tab, id: ++lastId, command });
    try {
      const response = await authed((headers) =>
        fetch(`${base}/engine`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      if (response.status === 401) {
        end('signed-out');
        return fail('signed-out', 'the server refused the session');
      }
      if (!response.ok) {
        return fail(
          response.status >= 500 ? 'unexpected' : 'refused',
          `the server answered ${response.status}`,
        );
      }
      return (await response.json()) as Result;
    } catch (error) {
      return failed(error);
    }
  };

  const receive = (m: FromWorker) => {
    // The page owns these two (design, "Sign-in and the session").
    if (m.type !== 'publish' || m.topic === 'session' || m.topic === 'engine')
      return;
    // Keyed topics: every tab of the user hears every publish, and two tabs
    // on one view may watch two layouts. Without an override the catalog
    // names the saved one; the snapshot publishes it first.
    if (
      m.topic === 'view' &&
      (m.value.key !== watching.view ||
        !sameSpan(m.value.span, watching.span) ||
        m.value.layout !==
          (watching.layout ??
            savedLayoutOf(watching.view, topics.catalog.value?.views)))
    ) {
      return;
    }
    if (m.topic === 'task' && m.value.id !== watching.task) return;
    (topics[m.topic] as ShallowRef<unknown>).value = m.value;
  };

  /**
   * Keeps this tab's stream open while signed in. Opening one makes the
   * server publish a snapshot; closing it withdraws the tab's watch, so the
   * watch goes again on every open. A stream that lived a while and ended
   * is reopened at once and stays `connected` meanwhile: the server ends it
   * when its token expires, every 15 minutes, and the write controls must
   * not flicker. One that ended sooner waits 1 s, so a server that closes
   * every stream right away is not hammered. A failed open is retried after
   * 1 s, doubling to 30 s; before the first stream it tells the gate the
   * server cannot be reached (engine `starting`, reason `unreachable`).
   */
  // ponytail: no idle watchdog; a half-open connection reads as connected
  // until the browser errors it. Abort after ~2 missed pings if that shows up.
  const listen = () => {
    stream?.abort();
    const abort = (stream = new AbortController());
    void (async () => {
      let failures = 0;
      while (!abort.signal.aborted) {
        let openedAt: number | undefined;
        try {
          const response = await authed((headers) =>
            fetch(`${base}/engine/events?tab=${tab}`, {
              headers,
              signal: abort.signal,
            }),
          );
          if (response.status === 401) return end('signed-out');
          if (response.ok) {
            await readEvents(response, (event) => {
              if (openedAt === undefined) {
                openedAt = Date.now();
                failures = 0;
                connected.value = true;
                engine('ready');
                if (watching.view !== null || watching.task !== null) {
                  void send(watching);
                }
              }
              receive(event);
            });
          }
        } catch (error) {
          if (abort.signal.aborted) return;
          if (error instanceof RefusalError && !tokens.signedIn()) {
            return end('signed-out');
          }
        }
        if (abort.signal.aborted) return;
        if (openedAt !== undefined && Date.now() - openedAt >= LIVED_MS) {
          continue;
        }
        connected.value = false;
        if (openedAt === undefined && topics.engine.value?.state !== 'ready') {
          engine('starting', 'unreachable');
        }
        const wait =
          openedAt !== undefined
            ? FIRST_RETRY_MS
            : Math.min(FIRST_RETRY_MS * 2 ** failures++, LAST_RETRY_MS);
        await sleep(wait, abort.signal);
      }
    })();
  };

  const begin = () => {
    engine('starting');
    session('signed-in');
    listen();
  };

  /** A sign-in or a registration: only how the grant is asked for differs. */
  const signIn = async (
    ask: () => Promise<AccessGrant | 'invalid'>,
  ): Promise<Result> => {
    let grant: AccessGrant | 'invalid';
    try {
      grant = await ask();
    } catch (error) {
      return thrown(error);
    }
    if (grant === 'invalid') {
      return fail('invalid-credentials', 'wrong email or password');
    }
    tokens.adopt(grant);
    begin();
    return OK;
  };

  const signOut = async (): Promise<Result> => {
    try {
      // current() renews an expired token first: logout needs a live bearer.
      const bearer = await tokens.current();
      if ((await auth.logout(bearer)) === 'unauthorized') {
        const renewed = await tokens.renew(bearer);
        if (renewed !== null) await auth.logout(renewed);
      }
    } catch {
      // Offline or already ended: the server session idles out on its own.
    }
    end();
    return OK;
  };

  if (!hint) end();
  else {
    void tokens.current().then(begin, () =>
      // Refused: signed out. Not reached, or refused for now (429): signed
      // in, and the stream keeps trying.
      tokens.signedIn() ? begin() : end(),
    );
  }

  function request(command: Command): Promise<Result> {
    switch (command.kind) {
      case 'signIn':
        return signIn(() => auth.login(command.email, command.password));
      case 'register':
        return signIn(() => auth.register(command.email, command.password));
      case 'signOut':
        return signOut();
    }
    if (topics.session.value?.state !== 'signed-in') {
      return Promise.resolve(fail('signed-out', 'not signed in'));
    }
    // Online only (design, "Losing the connection"): nothing is queued here.
    if (!connected.value) {
      return Promise.resolve(
        fail('unreachable', 'the server cannot be reached'),
      );
    }
    return send(command);
  }

  const mint = (draft: Draft): Write => coreMint(draft, mintId);

  return {
    request,
    mint,
    write: (w) => request('opId' in w ? w : mint(w)),
    watch(view, task, span = null, layout = null) {
      // A new span keeps the topic: the calendar shows its skeleton until
      // the span it asked for arrives, and stays mounted, so the toolbar
      // button that moved it keeps the focus.
      if (view !== watching.view || layout !== watching.layout) {
        topics.view.value = undefined;
      }
      if (task !== watching.task) topics.task.value = undefined;
      watching = { kind: 'watch', view, task, span, layout };
      // Fire and forget: the next open sends it again.
      if (connected.value) void send(watching);
    },
    topics,
    connected,
    close() {
      stream?.abort();
      stream = undefined;
    },
  };
}
