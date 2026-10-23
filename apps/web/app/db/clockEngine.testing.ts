// Test support only: a real engine on an in-memory replica, a fake clock and
// a server that hands out `rows` once. Imported by specs, never by the app.
import {
  cookieTokenSource,
  createEngine,
  type Topic,
  type Topics,
  type Transport,
} from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';

/** A pulled row of `table`, live at version 1. */
export const row = (table: string, id: string, fields: object) => ({
  table,
  id,
  seq: 1,
  row: { id, deletedAt: null, version: 1, ...fields },
});

/** Starts the engine at `start`; `clock.now` moves it, and `latest` holds
 *  the last value published on each topic. */
export async function clockEngine(rows: object[], start: Date) {
  const clock = { now: start };
  let pulled = false;
  const send: Transport = () => {
    const changes = pulled ? [] : rows;
    pulled = true;
    return Promise.resolve(
      new Response(JSON.stringify({ cursor: 1, results: [], changes }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  const grant = () => ({
    accessToken: `${btoa(JSON.stringify({ sub: 'u1' })).replace(/=+$/, '')}.mac`,
    accessExpiresAt: new Date(clock.now.getTime() + 3_600_000).toISOString(),
  });
  const auth = {
    login: () => Promise.resolve(grant()),
    register: () => Promise.resolve(grant()),
    refresh: () => Promise.resolve(grant()),
    logout: () => Promise.resolve(undefined),
  };
  const latest: { [T in Topic]?: Topics[T] } = {};
  const engine = createEngine({
    store: openReplica(':memory:'),
    auth,
    tokens: cookieTokenSource(auth, () => clock.now),
    send,
    now: () => clock.now,
    newId: () => crypto.randomUUID(),
    publish: (topic, value) => {
      (latest as Record<string, unknown>)[topic] = value;
    },
  });
  await engine.start(true);
  return { engine, clock, latest };
}
