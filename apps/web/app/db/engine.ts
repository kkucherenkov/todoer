import {
  adoptAccount,
  flush,
  liveTasks,
  overlay,
  RefusalError,
  type CookieAuthApi,
  type CookieTokenSource,
  type Store,
  type Transport,
} from '@todoer/client-core';
import type {
  Command,
  Failure,
  Result,
  SyncReason,
  ToWorker,
  Topic,
  Topics,
} from './protocol';

export type EngineDeps = {
  store: Store;
  auth: CookieAuthApi;
  tokens: CookieTokenSource;
  send: Transport;
  now: () => Date;
  publish: <T extends Topic>(topic: T, value: Topics[T]) => void;
};

const OK: Result = { ok: true };
const fail = (kind: Failure['kind'], detail: string): Result => ({
  ok: false,
  failure: { kind, detail },
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What became of a command that threw: never a rejection (protocol). */
function failure(error: unknown): Result {
  if (error instanceof RefusalError) return fail('refused', error.message);
  // fetch rejects with a TypeError offline, a DOMException on timeout.
  if (error instanceof TypeError || error instanceof DOMException) {
    return fail('unreachable', message(error));
  }
  return fail('unexpected', message(error));
}

/**
 * The client core behind the worker's protocol: one session, one replica,
 * one sync at a time. Every tab's command lands here; every state change
 * goes out as a topic.
 */
export function createEngine({
  store,
  auth,
  tokens,
  send,
  now,
  publish,
}: EngineDeps) {
  let session: Topics['session'] = { state: 'restoring', reason: null };
  let sync: Omit<Topics['sync'], 'pending' | 'failed'> = {
    running: false,
    reached: null,
    lastSyncedAt: null,
    problem: null,
  };

  const setSession = (
    state: Topics['session']['state'],
    reason: Failure['kind'] | null = null,
  ) => publish('session', (session = { state, reason }));
  const publishSync = (changes: Partial<typeof sync> = {}) => {
    sync = { ...sync, ...changes };
    publish('sync', { ...sync, ...store.counts() });
    publish('summary', {
      tasks: liveTasks(overlay('task', store.rows('task'), store.pending()))
        .length,
    });
  };

  /**
   * The account check before a token is taken: a foreign outbox refuses,
   * and the new session is logged out so its cookie does not outlive the
   * refusal. Before `tokens.adopt`, so a refused grant is never held.
   */
  const adopt = async (accessToken: string) => {
    try {
      adoptAccount(store, accessToken);
    } catch (error) {
      await auth.logout(accessToken).catch(() => undefined);
      throw error;
    }
  };

  // ── sync: single-flight; a trigger during a run repeats it once ───────
  let running: Promise<void> | undefined;
  let again = false;

  const once = async () => {
    if (session.state !== 'signed-in') return;
    publishSync({ running: true });
    const done: Partial<typeof sync> = { running: false };
    try {
      const { synced } = await flush(store, send);
      Object.assign(done, {
        reached: synced,
        problem: null,
        ...(synced ? { lastSyncedAt: now().toISOString() } : {}),
      });
    } catch (error) {
      if (error instanceof RefusalError && !tokens.signedIn()) {
        setSession('signed-out', 'signed-out');
      } else {
        done.problem = message(error);
      }
    }
    publishSync(done);
  };

  const runSync = (reason: SyncReason): Promise<void> => {
    if (running !== undefined) {
      // ponytail: a tick is the cadence's own; one already running covers it.
      if (reason !== 'tick') again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await once();
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };

  // ── session: start, signIn and signOut never overlap ───────────────────
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(step: () => Promise<T>): Promise<T> => {
    const next = chain.then(step, step);
    chain = next.catch(() => undefined);
    return next;
  };

  const start = async (hint: boolean) => {
    // Departure 4: no hint, no refresh (each 401 counts against the IP).
    if (!hint) return void setSession('signed-out');
    let accessToken: string;
    try {
      accessToken = await tokens.current();
    } catch (error) {
      // Refused (the cookie is gone or rejected): signed out. Otherwise the
      // server was not reached or refused for now (429): offline, if this
      // replica has an owner to be offline as.
      if (!tokens.signedIn() || store.owner() === undefined) {
        return void setSession('signed-out');
      }
      setSession('signed-in');
      return publishSync({
        reached: false,
        problem: error instanceof RefusalError ? error.message : null,
      });
    }
    try {
      await adopt(accessToken);
    } catch {
      tokens.adopt(undefined);
      return void setSession('signed-out', 'refused');
    }
    setSession('signed-in');
    await runSync('start');
  };

  const signIn = async (email: string, password: string): Promise<Result> => {
    const grant = await auth.login(email, password);
    if (grant === 'invalid') {
      return fail('invalid-credentials', 'wrong email or password');
    }
    await adopt(grant.accessToken);
    tokens.adopt(grant);
    setSession('signed-in');
    await runSync('start');
    return OK;
  };

  const signOut = async (): Promise<Result> => {
    try {
      // current() renews an expired token first: logout needs a live bearer.
      const bearer = await tokens.current();
      if (bearer !== '' && (await auth.logout(bearer)) === 'unauthorized') {
        const renewed = await tokens.renew(bearer);
        if (renewed !== null) await auth.logout(renewed);
      }
    } catch {
      // Offline or already ended: the server session idles out on its own.
    }
    tokens.adopt(undefined);
    setSession('signed-out');
    return OK;
  };

  return {
    /** Restore the session from the cookie when the hint says one may exist. */
    start: (hint: boolean): Promise<void> => serial(() => start(hint)),
    async handle(command: Command): Promise<Result> {
      try {
        switch (command.kind) {
          case 'signIn':
            return await serial(() => signIn(command.email, command.password));
          case 'signOut':
            return await serial(signOut);
          case 'sync':
            // Until start settles the session is unknown, not signed out.
            if (session.state === 'restoring') await chain;
            if (session.state === 'restoring') {
              return fail('unavailable', 'the session is still restoring');
            }
            await runSync(command.reason);
            return session.state === 'signed-in'
              ? OK
              : fail('signed-out', 'not signed in');
        }
      } catch (error) {
        return failure(error);
      }
    },
    /** Publish every topic (a tab said hello). */
    snapshot(): void {
      publish('engine', { state: 'ready', reason: null });
      publish('session', session);
      publishSync();
    },
  };
}

export type Engine = ReturnType<typeof createEngine>;

/**
 * The worker's side of the channel. A request runs once per `tab:id`: a tab
 * resends what is pending on every `ready`, so a resend attaches to the run
 * in flight, and one arriving within `keepMs` of its end gets the same
 * result. A message from another build is answered with the snapshot: the
 * stale tab learns from the stamp, and same-build tabs take the topics as a
 * no-op, where `ready` would make each of them resend.
 */
export function dispatcher(
  build: string,
  engine: Engine,
  reply: (tab: string, id: number, result: Result) => void,
  keepMs = 30_000,
): (m: ToWorker) => void {
  const runs = new Map<string, Promise<Result>>();
  return (m) => {
    // A foreign-build publish or reply reaching this channel lands here too
    // and triggers a snapshot as well; harmless, topics are idempotent.
    if (m.build !== build || m.type === 'hello') return engine.snapshot();
    // The leader's own topic posts reach this channel too.
    if (m.type !== 'request') return;
    const key = `${m.tab}:${m.id}`;
    let run = runs.get(key);
    if (run === undefined) {
      run = engine.handle(m.command);
      runs.set(key, run);
      void run.then(() => setTimeout(() => runs.delete(key), keepMs));
    }
    void run.then((result) => reply(m.tab, m.id, result));
  };
}
