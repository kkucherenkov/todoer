import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {
  cookieTokenSource,
  httpCookieAuthApi,
  httpTransport,
} from '@todoer/client-core';
import { openWasmStore } from '@todoer/client-core/sqlite-wasm';
import { createEngine } from './engine';
import { installPool } from './pool';
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

self.onmessage = async ({ data }: MessageEvent<Init>) => {
  try {
    const sqlite3 = await sqlite3InitModule();
    // sqlite-wasm caches a failed install per VFS name and rethrows it to
    // every later call; without this option a retry never retries. Its
    // typings omit it, hence the variable (no excess-property check).
    const options = { name: 'todoer', forceReinitIfPreviouslyFailed: true };
    const pool = await installPool(() =>
      sqlite3.installOpfsSAHPoolVfs(options),
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
