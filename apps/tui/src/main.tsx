#!/usr/bin/env node
import { render } from 'ink';
import { uuidv7 } from 'uuidv7';
import {
  createEngine,
  httpAuthApi,
  httpTransport,
  localDate,
  tokenSource,
} from '@todoer/client-core';
import { openReplica, readConfig } from '@todoer/client-core/node-sqlite';
import { App } from './app.js';
import { TuiContext } from './context.js';
import { cliSession } from './session.js';
import { createStatusLine } from './status-line.js';
import { createTopics } from './topics.js';

/** The cadence (design, Routine choices): a tick every 30 s. */
const TICK_MS = 30_000;

async function main(): Promise<number> {
  const config = readConfig(process.env);
  const store = openReplica(config.dbPath);
  try {
    const now = () => new Date();
    const api = httpAuthApi(config);
    // The CLI's wiring: the transport may use TODOER_TOKEN, the session is
    // the stored one (index.ts in apps/cli).
    const send = httpTransport(
      config,
      tokenSource(store, api, config.token, now),
    );
    const { auth, tokens } = cliSession(
      store,
      tokenSource(store, api, config.token, now),
      config.token,
    );
    const topics = createTopics();
    const engine = createEngine({
      store,
      auth,
      tokens,
      send,
      now,
      newId: uuidv7,
      publish: (topic, value) => topics.publish(topic, value),
    });
    const tui = {
      engine,
      topics,
      newId: uuidv7,
      today: () => localDate(now()),
      status: createStatusLine(),
    };
    const app = render(
      <TuiContext.Provider value={tui}>
        <App />
      </TuiContext.Provider>,
      { alternateScreen: true, exitOnCtrlC: true },
    );
    void engine.start(tokens.signedIn());
    const timer = setInterval(
      () => void engine.handle({ kind: 'sync', reason: 'tick' }, 'tui'),
      TICK_MS,
    );
    try {
      await app.waitUntilExit();
    } finally {
      clearInterval(timer);
    }
    return 0;
  } finally {
    store.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // An unexpected local failure, as for the CLI: Ink has restored the
    // terminal by the time this runs.
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 3;
  },
);
