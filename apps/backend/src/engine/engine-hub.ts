import {
  Injectable,
  type OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createEngine,
  dispatcher,
  type Command,
  type Engine,
  type EngineAuth,
  type EngineTokens,
  type FromWorker,
  type Result,
  type ToWorker,
} from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import { uuidv7 } from 'uuidv7';
import { AuthService, TOKEN_TTL_MS } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangeFeed } from '../sync/change-feed.js';
import { SyncService } from '../sync/sync.service.js';
import { inProcessTransport } from './in-process-transport.js';

/** An engine with no open stream unloads this long after the last closed. */
export const UNLOAD_MS = 5 * 60_000;
/** The `FromWorker` stamp; the web does not compare it. */
const BUILD = 'server';

type Send = (event: FromWorker) => void;
type Loaded = {
  engine: Engine;
  dispatch: (m: ToWorker) => void;
  waiters: Map<string, ((result: Result) => void)[]>;
  streams: Map<string, { send: Send; end: () => void }>;
  unload?: NodeJS.Timeout;
  stop: () => void;
};

// Reached only by signIn, register and signOut, which /engine never accepts.
const nothing = () =>
  Promise.reject(new Error('the server engine has no session API'));
const NO_AUTH: EngineAuth = {
  login: nothing,
  register: nothing,
  logout: nothing,
};

/**
 * One client-core engine per signed-in user, serving every tab of theirs:
 * `request` runs a command, `open` streams the topics. The key is the
 * guard's user id, so a user only ever reaches their own engine.
 */
@Injectable()
export class EngineHub implements OnModuleDestroy {
  // ponytail: one backend process; engines live in memory. A second
  // instance would need sticky sessions or a shared feed.
  private readonly engines = new Map<string, Loaded>();
  /** Deleted accounts, kept while a token minted before the deletion can
   *  live: it still verifies (ADR 0014), and the page's reconnect would
   *  load a fresh engine for a user that is gone. */
  private readonly deleted = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly sync: SyncService,
    private readonly feed: ChangeFeed,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async request(
    userId: string,
    tab: string,
    id: number,
    command: Command,
  ): Promise<Result> {
    // Only a cold load waits: a loaded engine takes the request at once.
    if (!this.engines.has(userId)) await this.assertLive(userId);
    const loaded = this.load(userId);
    clearTimeout(loaded.unload);
    try {
      return await new Promise<Result>((resolve) => {
        const key = `${tab}:${id}`;
        loaded.waiters.set(key, [...(loaded.waiters.get(key) ?? []), resolve]);
        loaded.dispatch({ type: 'request', build: BUILD, tab, id, command });
      });
    } finally {
      this.idle(userId, loaded);
    }
  }

  /** `end` is how the hub ends the stream itself, on `unload`. */
  open(userId: string, tab: string, send: Send, end: () => void): () => void {
    const loaded = this.load(userId);
    clearTimeout(loaded.unload);
    loaded.streams.set(tab, { send, end });
    loaded.engine.snapshot();
    return () => {
      // A reconnect may have replaced this stream already: leave that one.
      if (loaded.streams.get(tab)?.send !== send) return;
      loaded.streams.delete(tab);
      void loaded.engine.handle({ kind: 'watch', view: null, task: null }, tab);
      this.idle(userId, loaded);
    };
  }

  /** The user is gone (account deleted): end their streams and drop the
   *  engine now, without the idle delay. */
  unload(userId: string): void {
    clearTimeout(this.deleted.get(userId));
    const forget = setTimeout(() => this.deleted.delete(userId), TOKEN_TTL_MS);
    forget.unref();
    this.deleted.set(userId, forget);
    const loaded = this.engines.get(userId);
    if (loaded === undefined) return;
    this.engines.delete(userId);
    clearTimeout(loaded.unload);
    const ends = [...loaded.streams.values()].map((s) => s.end);
    // Cleared first, so each `end` finds its close a no-op.
    loaded.streams.clear();
    for (const end of ends) end();
    loaded.stop();
    // The dispatcher will never answer now: fail what still waits.
    const result: Result = {
      ok: false,
      failure: { kind: 'signed-out', detail: 'the account was deleted' },
    };
    for (const resolves of loaded.waiters.values()) {
      for (const resolve of resolves) resolve(result);
    }
    loaded.waiters.clear();
  }

  /** Shutdown: no unload timer outlives the app, no replica stays open. */
  onModuleDestroy(): void {
    for (const loaded of this.engines.values()) {
      clearTimeout(loaded.unload);
      loaded.stop();
    }
    this.engines.clear();
    for (const forget of this.deleted.values()) clearTimeout(forget);
    this.deleted.clear();
  }

  loaded(userId: string): boolean {
    return this.engines.has(userId);
  }

  /** The 401 the guard would give if access tokens were not stateless.
   *  A loaded engine is live; a cold load asks the database, since
   *  `deleted` does not outlive a restart. Call `load` right after, with
   *  no await between. */
  async assertLive(userId: string): Promise<void> {
    const live =
      this.engines.has(userId) ||
      (await this.prisma.user.count({ where: { id: userId } })) > 0;
    // `deleted` read after the query: an unload may land while it runs.
    if (!live) throw new UnauthorizedException('invalid token');
    this.refuseDeleted(userId);
  }

  private refuseDeleted(userId: string): void {
    if (this.deleted.has(userId)) {
      throw new UnauthorizedException('invalid token');
    }
  }

  private load(userId: string): Loaded {
    this.refuseDeleted(userId);
    const known = this.engines.get(userId);
    if (known !== undefined) return known;
    const store = openReplica(':memory:');
    const mint = () => this.auth.signWithExpiry(userId).token;
    const tokens: EngineTokens = {
      current: () => Promise.resolve(mint()),
      renew: () => Promise.resolve(mint()),
      adopt() {},
      signedIn: () => true,
    };
    const streams = new Map<string, { send: Send; end: () => void }>();
    const waiters = new Map<string, ((result: Result) => void)[]>();
    const engine = createEngine({
      store,
      auth: NO_AUTH,
      tokens,
      send: inProcessTransport(this.sync, userId),
      now: () => new Date(),
      newId: uuidv7,
      publish: (topic, value) => {
        const event = { type: 'publish', topic, value, build: BUILD };
        for (const { send } of streams.values()) send(event as FromWorker);
      },
      onlineOnly: true,
    });
    const dispatch = dispatcher(BUILD, engine, (tab, id, result) => {
      const key = `${tab}:${id}`;
      for (const resolve of waiters.get(key) ?? []) resolve(result);
      waiters.delete(key);
    });
    const unlisten = this.feed.listen(
      userId,
      () => void engine.handle({ kind: 'sync', reason: 'remote' }),
    );
    const loaded: Loaded = {
      engine,
      dispatch,
      waiters,
      streams,
      stop: () => {
        unlisten();
        store.close();
      },
    };
    // Writes and syncs wait for the start inside the engine.
    void engine.start(true);
    this.engines.set(userId, loaded);
    return loaded;
  }

  /** With no stream left, unload after the delay; a stream or a request
   *  before then keeps the engine. */
  private idle(userId: string, loaded: Loaded): void {
    if (loaded.streams.size > 0) return;
    clearTimeout(loaded.unload);
    loaded.unload = setTimeout(() => {
      if (this.engines.get(userId) !== loaded) return;
      this.engines.delete(userId);
      loaded.stop();
    }, UNLOAD_MS);
    loaded.unload.unref();
  }
}
