import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {
  cookieTokenSource,
  httpCookieAuthApi,
  httpTransport,
} from '@todoer/client-core';
import { openWasmStore } from '@todoer/client-core/sqlite-wasm';
import { createEngine } from './engine';
import {
  CHANNEL,
  type Fatal,
  type FromWorker,
  type Init,
  type ToWorker,
} from './protocol';

// The app's lib set includes DOM, which types `self` as a Window.
declare const self: DedicatedWorkerGlobalScope;

type Unstamped<T> = T extends unknown ? Omit<T, 'build'> : never;

/** Retries with doubling delays; the last error is the one thrown. */
async function retry<T>(
  attempt: () => Promise<T>,
  {
    attempts,
    firstDelayMs,
    maxDelayMs,
  }: { attempts: number; firstDelayMs: number; maxDelayMs: number },
): Promise<T> {
  for (
    let i = 1, delay = firstDelayMs;
    ;
    i++, delay = Math.min(delay * 2, maxDelayMs)
  ) {
    try {
      return await attempt();
    } catch (error) {
      if (i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

self.onmessage = async ({ data }: MessageEvent<Init>) => {
  try {
    const sqlite3 = await sqlite3InitModule();
    // The previous leader's worker may still hold the pool's handles for a
    // moment after its tab closed (Review Focus 1).
    const pool = await retry(
      () => sqlite3.installOpfsSAHPoolVfs({ name: 'todoer' }),
      {
        attempts: 10,
        firstDelayMs: 100,
        maxDelayMs: 1000,
      },
    );
    // No journal_mode change: opfs-sahpool has no WAL; the rollback journal
    // undoes a transaction a killed tab left behind.
    const store = openWasmStore(
      sqlite3,
      new pool.OpfsSAHPoolDb('/todoer.sqlite3'),
    );
    const config = { base: '/api/v1', timeoutMs: 10_000 };
    const auth = httpCookieAuthApi(config);
    const tokens = cookieTokenSource(auth, () => new Date());
    const channel = new BroadcastChannel(CHANNEL);
    const post = (m: Unstamped<FromWorker>) =>
      channel.postMessage({ ...m, build: data.build });
    const engine = createEngine({
      store,
      auth,
      tokens,
      send: httpTransport(config, tokens),
      now: () => new Date(),
      publish: (topic, value) =>
        post({ type: 'publish', topic, value } as Unstamped<FromWorker>),
    });
    channel.onmessage = ({ data: m }: MessageEvent<ToWorker>) => {
      if (m.build !== data.build) return void post({ type: 'ready' }); // lets the stale tab see it
      if (m.type === 'hello') return engine.snapshot();
      if (m.type === 'request') {
        void engine
          .handle(m.command)
          .then((result) =>
            post({ type: 'reply', tab: m.tab, id: m.id, result }),
          );
      }
    };
    // A violation inside a worker fires here, not on any document (Review Focus 2).
    // The worker lib's event map lacks this event; the browser fires it.
    self.addEventListener('securitypolicyviolation', (event) => {
      const e = event as SecurityPolicyViolationEvent;
      post({
        type: 'violation',
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
      });
    });
    post({ type: 'ready' });
    post({
      type: 'publish',
      topic: 'engine',
      value: { state: 'ready', reason: null },
    });
    await engine.start(data.hint);
  } catch (error) {
    self.postMessage({ type: 'fatal', reason: String(error) } satisfies Fatal);
  }
};
