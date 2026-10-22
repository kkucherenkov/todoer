import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import {
  createEngine,
  localDate,
  NOT_APPLIED,
  type Engine,
  type Transport,
} from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import type { Tui } from './tui.js';
import type { Pane } from './pi/app-shell.js';
import { createStatusLine } from './status-line.js';
import { createTopics, type Topics$ } from './topics.js';

export const NOW = new Date('2026-10-03T10:00:00.000Z');

/** The backend's reason for an op whose transaction rolled back: it keeps
 *  no verdict for it, so the same opId is judged afresh. */
export { NOT_APPLIED };

/** A server that applies every op once and serves the rows it holds;
 *  `offline` makes every request fail like a dropped connection, `status`
 *  answers every request that carries ops with that HTTP status (429, …),
 *  `refuse` rejects an op with its reason (unapplied). A refusal other than
 *  NOT_APPLIED sticks to its opId, as the backend records it: the same opId
 *  is refused again until a spec deletes it from `refused`. With `hold`,
 *  each request waits until a spec calls its `held[i]` (arrival order);
 *  `until(n)` resolves once n requests are waiting or were. */
export function fakeServer(rows: Change['row'][] = []) {
  const changes: Change[] = rows.map((row, i) => ({
    table: typeof row.table === 'string' ? row.table : 'task',
    id: String(row.id),
    seq: i + 1,
    row: { deletedAt: null, ...row },
  }));
  const sent: Op[] = [];
  const state: {
    offline: boolean;
    status?: number;
    refuse?: (op: Op) => string | undefined;
    hold?: boolean;
  } = { offline: false };
  const seen = new Set<string>();
  const refused = new Map<string, string>();
  const held: (() => void)[] = [];
  const waiters: { n: number; resolve: () => void }[] = [];
  const until = (n: number) =>
    new Promise<void>((resolve) => {
      if (held.length >= n) resolve();
      else waiters.push({ n, resolve });
    });
  const send: Transport = async (request: SyncRequest) => {
    if (state.hold === true) {
      await new Promise<void>((release) => {
        held.push(release);
        for (const w of waiters) if (held.length >= w.n) w.resolve();
      });
    }
    if (state.offline) throw new TypeError('fetch failed');
    if (state.status !== undefined && request.ops.length > 0) {
      return new Response('refused as it stands', { status: state.status });
    }
    const verdicts = new Map<string, string>();
    for (const op of request.ops) {
      sent.push(op);
      if (seen.has(op.opId)) continue;
      const reason = refused.get(op.opId) ?? state.refuse?.(op);
      if (reason !== undefined) {
        verdicts.set(op.opId, reason);
        if (reason !== NOT_APPLIED) refused.set(op.opId, reason);
        continue;
      }
      seen.add(op.opId);
      const seq = changes.length + 1;
      if (op.kind === 'create') {
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: { id: op.id, deletedAt: null, version: 1, ...op.fields },
        });
      } else if (op.kind === 'set') {
        const prev = [...changes].reverse().find((c) => c.id === op.id);
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: { ...(prev?.row ?? { id: op.id }), [op.field]: op.value },
        });
      } else if (op.kind === 'delete') {
        const prev = [...changes].reverse().find((c) => c.id === op.id);
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: {
            ...(prev?.row ?? { id: op.id }),
            deletedAt: NOW.toISOString(),
          },
        });
      }
    }
    const body = {
      cursor: changes.length,
      results: request.ops.map((op) => {
        const reason = verdicts.get(op.opId);
        return reason === undefined
          ? { opId: op.opId, status: 'applied' }
          : { opId: op.opId, status: 'rejected', reason };
      }),
      changes: changes.filter((c) => c.seq > request.since),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { send, sent, state, refused, held, until };
}

export const TOKEN = `${btoa(JSON.stringify({ sub: 'u1' })).replace(/=+$/, '')}.mac`;

/** An app that draws nothing; specs pass the pane they test. */
const blank: Pane = { render: () => [], invalidate: () => undefined };

/**
 * A pane under a real engine, signed in as u1 on a temp replica. The frame
 * is the root's render at `width`, cut to `rows` like the viewport would.
 */
export async function renderApp({
  server = fakeServer(),
  width = 80,
  rows = 24,
  app = () => blank,
}: {
  server?: ReturnType<typeof fakeServer>;
  width?: number;
  rows?: number;
  /** Builds the root from the wiring and the viewport's size; the shell
   *  does not exist in specs. */
  app?: (tui: Tui, size: { rows: () => number; columns: () => number }) => Pane;
} = {}) {
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
  let published = 0;
  topics.subscribe(() => (published += 1));
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
  // instead of guessing how long SQLite and the fake server take.
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
  const tui = {
    engine,
    topics,
    newId,
    today: () => localDate(NOW),
    status: createStatusLine(),
  };
  const size = { width, rows };
  const root = app(tui, {
    rows: () => size.rows,
    columns: () => size.width,
  });
  /** Until no command is in flight and nothing was published for 20 ms. */
  const settle = async () => {
    for (;;) {
      await Promise.all(inflight);
      const seen = published;
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (inflight.size === 0 && published === seen) return;
    }
  };
  await settle();
  const lines = () => root.render(size.width).slice(0, size.rows);
  return {
    frame: () => lines().join('\n'),
    lines,
    /** Feeds `keys` to the root one at a time, settling after each. */
    async press(...keys: string[]) {
      for (const key of keys) {
        root.handleInput?.(key);
        await settle();
      }
    },
    /** Feeds `keys` without settling: a held write stays in flight. */
    input(...keys: string[]) {
      for (const key of keys) root.handleInput?.(key);
    },
    resize(w: number, r: number) {
      size.width = w;
      size.rows = r;
    },
    settle,
    ...tui,
    store,
    server,
    // An arrow: specs hand it to `afterEach` unbound.
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Raw sequences for keys `press` cannot spell as text. */
export const KEY = {
  enter: '\r',
  escape: '\u001b',
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  tab: '\t',
  shiftTab: '\u001b[Z',
  altUp: '\u001b\u001b[A',
  altDown: '\u001b\u001b[B',
} as const;
