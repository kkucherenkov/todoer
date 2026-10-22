import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { render } from 'ink-testing-library';
import { createEngine, localDate, type Engine } from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import { TuiContext } from './context.js';
import { createKeyHold } from './key-hold.js';
import { createStatusLine } from './status-line.js';
import { fakeServer, KEY, NOW, TOKEN } from './pi/test-kit.js';
import { createTopics, type Topics$ } from './topics.js';

/** Renders `ui` inside a real engine, signed in as u1 on a temp replica. */
export async function renderTui(
  ui: ReactNode,
  { server = fakeServer() }: { server?: ReturnType<typeof fakeServer> } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'todoer-tui-test-'));
  const store = openReplica(join(dir, 'todoer.db'));
  store.saveAuth({
    accessToken: TOKEN,
    accessExpiresAt: '2099-01-01T00:00:00.000Z',
    refreshToken: 'r',
  });
  const topics: Topics$ = createTopics();
  let n = 0;
  const newId = () =>
    `00000000-0000-7000-8000-${(n += 1).toString(16).padStart(12, '0')}`;
  const raw: Engine = createEngine({
    store,
    auth: {
      login: () => Promise.reject(new Error('no')),
      register: () => Promise.reject(new Error('no')),
      logout: () => Promise.resolve(undefined),
    },
    tokens: {
      current: () => Promise.resolve(TOKEN),
      renew: () => Promise.resolve(null),
      adopt: () => undefined,
      signedIn: () => true,
    },
    send: server.send,
    now: () => NOW,
    newId,
    publish: (topic, value) => topics.publish(topic, value),
  });
  // Every command the UI sends is tracked, so `settle` can wait for a write
  // (and the state update its `.then` makes) instead of guessing how long
  // SQLite and the fake server take.
  const inflight = new Set<Promise<unknown>>();
  const engine: Engine = {
    ...raw,
    handle: (command, tab) => {
      const run = raw.handle(command, tab);
      inflight.add(run);
      void run.finally(() => inflight.delete(run));
      return run;
    },
  };
  await engine.start(true);
  const status = createStatusLine();
  const tui = {
    engine,
    topics,
    newId,
    today: () => localDate(NOW),
    status,
    keys: createKeyHold(),
  };
  const rendered = render(
    <TuiContext.Provider value={tui}>{ui}</TuiContext.Provider>,
  );
  /** Lets writes, publishes and effects settle before a frame is read: until
   *  no command is in flight and no frame was drawn for 50 ms. A loaded
   *  machine delays React's commit of a write's `.then`, and the effects that
   *  move `useInput` run after it; a fixed pause raced them. 50 ms also
   *  outlasts the 20 ms Ink waits before it takes a lone Esc for Escape. */
  const settle = async () => {
    for (;;) {
      await Promise.all(inflight);
      const drawn = rendered.frames.length;
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (inflight.size === 0 && rendered.frames.length === drawn) return;
    }
  };
  await settle();
  return {
    // Not the whole instance: its Stdout has a private field, which an
    // exported inferred type cannot name (TS4094).
    lastFrame: rendered.lastFrame,
    frames: rendered.frames,
    stdin: rendered.stdin,
    ...tui,
    store,
    server,
    settle,
    /** Types `keys` one write at a time, settling after each. */
    async press(...keys: string[]) {
      for (const key of keys) {
        rendered.stdin.write(key);
        await settle();
      }
    },
    // An arrow: specs hand it to `afterEach` unbound.
    cleanup: () => {
      rendered.unmount();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export { fakeServer, KEY, NOW };
