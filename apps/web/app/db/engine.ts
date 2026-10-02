import {
  add,
  adoptAccount,
  ALL_OPEN,
  boardTasks,
  catalog,
  ConflictError,
  deleteStatus,
  deleteView,
  editTask,
  flush,
  liveTasks,
  localDate,
  mark,
  moveTask,
  overlay,
  rankWrites,
  reconcile,
  RefusalError,
  saveStatus,
  saveView,
  seedStatuses,
  setCompleting,
  taskDetails,
  UsageError,
  viewTasks,
  type Catalog,
  type Core,
  type CookieAuthApi,
  type CookieTokenSource,
  type Ranked,
  type Store,
  type Transport,
  type ViewSpec,
} from '@todoer/client-core';
import {
  ALL,
  type Command,
  type Failure,
  type Note,
  type Result,
  type SyncReason,
  type ToWorker,
  type Topic,
  type Topics,
  type Write,
} from './protocol';

export type EngineDeps = {
  store: Store;
  auth: CookieAuthApi;
  tokens: CookieTokenSource;
  send: Transport;
  now: () => Date;
  newId: () => string;
  publish: <T extends Topic>(topic: T, value: Topics[T]) => void;
};

type Watch = { view: string | null; task: string | null };

/** A tick this soon after a sync is dropped (the cadence is 30 s). */
const TICK_GAP_MS = 25_000;

const OK: Result = { ok: true };
const fail = (
  kind: Failure['kind'],
  detail: string,
): Result & { ok: false } => ({
  ok: false,
  failure: { kind, detail },
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** What became of a command that threw: never a rejection (protocol). */
function failure(error: unknown): Result {
  if (error instanceof UsageError) return fail('invalid', error.message);
  if (error instanceof RefusalError || error instanceof ConflictError) {
    return fail('refused', error.message);
  }
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
  newId,
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

  // ── views: what each tab shows, recomputed after every change ─────────
  // ponytail: a tab that died without its pagehide keeps its entry until the
  // worker restarts; one entry per tab ever opened.
  const watches = new Map<string, Watch>();

  const viewSpec = (key: string, cat: Catalog) =>
    key === ALL
      ? { ...ALL_OPEN, problem: null }
      : cat.views.find((v) => v.id === key);
  const items = (spec: ViewSpec, today: string) =>
    (spec.layout === 'kanban' ? boardTasks : viewTasks)(store, today, spec);

  const publishView = (key: string, cat: Catalog, today: string) => {
    const spec = viewSpec(key, cat);
    if (spec === undefined) {
      const deleted = { layout: 'list', sort: 'manual', problem: 'deleted' };
      return publish('view', { key, ...deleted, items: [] });
    }
    const { layout, sort, problem } = spec;
    publish('view', {
      key,
      layout,
      sort,
      problem,
      items: problem === null ? items(spec, today) : [],
    });
  };
  const publishTask = (id: string, today: string) =>
    publish('task', { id, task: taskDetails(store, today, id) });

  /** Every topic, recomputed: no caching (Review Focus 2). */
  const publishAll = () => {
    publishSync();
    const cat = catalog(store);
    publish('catalog', cat);
    const today = localDate(now());
    const all = [...watches.values()];
    for (const key of new Set(all.map((w) => w.view))) {
      if (key !== null) publishView(key, cat, today);
    }
    for (const id of new Set(all.map((w) => w.task))) {
      if (id !== null) publishTask(id, today);
    }
  };

  const watch = (tab: string, next: Watch) => {
    if (next.view === null && next.task === null) watches.delete(tab);
    else watches.set(tab, next);
    const today = localDate(now());
    if (next.view !== null) publishView(next.view, catalog(store), today);
    if (next.task !== null) publishTask(next.task, today);
  };

  /** The core's ops publish after their enqueue commits and before the
   *  network answers: a write shows at once, offline included. */
  const core: Core = {
    store,
    send: (body) => {
      publishAll();
      return send(body);
    },
    now,
    newId,
  };

  /**
   * After a flush that reached the server: fold duplicate names (V1
   * departure 6) and seed statuses on a replica that has none
   * (departure 5), then send what that queued.
   */
  const afterReached = () => {
    const merged = reconcile(core).length > 0;
    const seeded = seedStatuses(core);
    if (merged || seeded) void runSync('write');
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
  let finishedAt = -Infinity;

  const once = async () => {
    if (session.state !== 'signed-in') return;
    publishSync({ running: true });
    const done: Partial<typeof sync> = { running: false };
    try {
      const { synced } = await flush(store, core.send);
      if (synced) afterReached();
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
    sync = { ...sync, ...done };
    publishAll();
  };

  const runSync = (reason: SyncReason): Promise<void> => {
    if (running !== undefined) {
      // ponytail: a tick is the cadence's own; one already running covers it.
      if (reason !== 'tick') again = true;
      return running;
    }
    // Every visible window ticks; one sync per period is enough.
    if (reason === 'tick' && now().getTime() - finishedAt < TICK_GAP_MS) {
      return Promise.resolve();
    }
    running = (async () => {
      try {
        do {
          again = false;
          await once();
        } while (again);
      } finally {
        finishedAt = now().getTime();
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
    // The previous account's sync must not end in this account's replica.
    await running;
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
    // A 401 for a sync started before this is not a session that ended.
    await running;
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

  /** The rank writes for a drop after `after` (null: first) in `view`;
   *  none unless the view sorts manual (departure 7). */
  const dropRanks = (
    w: Extract<Write, { kind: 'move' }>,
  ): Ranked[] | undefined => {
    if (w.after === undefined) return undefined;
    const spec = viewSpec(w.view, catalog(store));
    if (spec === undefined || spec.sort !== 'manual' || spec.problem !== null) {
      return undefined;
    }
    const listed = items(spec, localDate(now()));
    const column =
      w.statusId !== undefined
        ? w.statusId
        : listed.find((i) => i.id === w.taskId)?.column;
    const container = listed.filter(
      (i) =>
        i.id !== w.taskId && (spec.layout !== 'kanban' || i.column === column),
    );
    return rankWrites(
      container.map((i) => ({ id: String(i.id), rank: String(i.rank) })),
      w.taskId,
      w.after,
    );
  };

  /** What a mark or a drop did, for the toast; `next` is the recurring
   *  task's occurrence that is current now. */
  const noteFor = (
    marked: 'done' | 'undo',
    occurrence: string | null,
    taskId: string,
  ): Note => ({
    marked,
    occurrence,
    next:
      occurrence === null
        ? null
        : (taskDetails(store, localDate(now()), taskId)?.occurrence ?? null),
  });

  /** Each write is its core operation, with the tab's ids (departure 2). */
  const apply = async (w: Write): Promise<{ synced: boolean; note?: Note }> => {
    const { opId } = w;
    switch (w.kind) {
      case 'add':
        return add(core, w.text, {}, { opId, id: w.id });
      case 'mark': {
        const r = await mark(core, w.mark, w.taskId, undefined, { opId });
        return w.mark === 'skip' || r.closed !== undefined || r.marked === null
          ? r
          : { ...r, note: noteFor(w.mark, r.occurrence, w.taskId) };
      }
      case 'edit':
        return editTask(core, { opId }, w.taskId, w.changes);
      case 'move': {
        const r = await moveTask(core, { opId }, w.taskId, {
          ...(w.statusId === undefined ? {} : { statusId: w.statusId }),
          ...(w.after === undefined ? {} : { ranks: dropRanks(w) }),
        });
        return r.marked === null
          ? r
          : { ...r, note: noteFor(r.marked, r.occurrence, w.taskId) };
      }
      case 'saveView':
        return saveView(core, { opId, id: w.id }, w.fields);
      case 'deleteView':
        return deleteView(core, { opId }, w.id);
      case 'saveStatus':
        return saveStatus(
          core,
          { opId, id: w.id },
          {
            ...(w.name === undefined ? {} : { name: w.name }),
            ...(w.after === undefined ? {} : { after: w.after }),
          },
        );
      case 'setCompleting':
        return setCompleting(core, { opId }, w.id);
      case 'deleteStatus':
        return deleteStatus(core, { opId }, w.id);
    }
  };

  const write = async (w: Write): Promise<Result> => {
    const { synced, note } = await apply(w);
    if (synced) afterReached();
    return note === undefined ? OK : { ok: true, note };
  };

  /** Until start settles the session is unknown, not signed out. */
  const signedIn = async (): Promise<ReturnType<typeof fail> | undefined> => {
    if (session.state === 'restoring') await chain;
    if (session.state === 'restoring') {
      return fail('unavailable', 'the session is still restoring');
    }
    return session.state === 'signed-in'
      ? undefined
      : fail('signed-out', 'not signed in');
  };

  return {
    /** Restore the session from the cookie when the hint says one may exist. */
    start: (hint: boolean): Promise<void> => serial(() => start(hint)),
    /** `tab` names the sender; only `watch` reads it. */
    async handle(command: Command, tab = ''): Promise<Result> {
      try {
        switch (command.kind) {
          case 'watch':
            watch(tab, { view: command.view, task: command.task });
            return OK;
          case 'signIn':
            return await serial(() => signIn(command.email, command.password));
          case 'signOut':
            return await serial(signOut);
          case 'sync': {
            const refused = await signedIn();
            if (refused?.failure.kind === 'unavailable') return refused;
            await runSync(command.reason);
            return session.state === 'signed-in'
              ? OK
              : fail('signed-out', 'not signed in');
          }
          default: {
            const refused = await signedIn();
            if (refused !== undefined) return refused;
            try {
              return await write(command);
            } finally {
              // Settled, refused or failed: the screens show what is true now.
              publishAll();
            }
          }
        }
      } catch (error) {
        return failure(error);
      }
    },
    /** Publish every topic (a tab said hello). */
    snapshot(): void {
      publish('engine', { state: 'ready', reason: null });
      publish('session', session);
      publishAll();
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
      run = engine.handle(m.command, m.tab);
      runs.set(key, run);
      void run.then(() => setTimeout(() => runs.delete(key), keepMs));
    }
    void run.then((result) => reply(m.tab, m.id, result));
  };
}
