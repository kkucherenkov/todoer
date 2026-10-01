import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { Store } from './store.js';
import { flush } from './sync.js';
import type { TokenSource } from './auth.js';
import { httpTransport } from './transport.js';

let server: Server | undefined;
let store: Store | undefined;

afterEach(async () => {
  store?.close();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  }
  server = store = undefined;
});

const request = { since: 0, ops: [] };

function tokens(current = '', renewed: string | null = null): TokenSource {
  return {
    current: () => Promise.resolve(current),
    renew: () => Promise.resolve(renewed),
  };
}

/** Answers each request with the next status, recording its authorization. */
async function serve(
  statuses: number[],
): Promise<{ config: Config; seen: Array<string | undefined> }> {
  const seen: Array<string | undefined> = [];
  server = createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(statuses[seen.length - 1] ?? 200, {
      'content-type': 'application/json',
    });
    res.end('{}');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    config: {
      base: `http://127.0.0.1:${port}`,
      token: '',
      dbPath: ':memory:',
      timeoutMs: 1000,
    },
    seen,
  };
}

describe('httpTransport', () => {
  it('retries once with the renewed token after a 401', async () => {
    const { config, seen } = await serve([401, 200]);
    const response = await httpTransport(config, tokens('old', 'new'))(request);
    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('returns the second 401 instead of retrying again', async () => {
    const { config, seen } = await serve([401, 401, 200]);
    const response = await httpTransport(config, tokens('old', 'new'))(request);
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(2);
  });

  it('does not resend when there is nothing new to send', async () => {
    const { config, seen } = await serve([401, 200]);
    for (const renewed of [null, 'old']) {
      seen.length = 0;
      const response = await httpTransport(
        config,
        tokens('old', renewed),
      )(request);
      expect(response.status).toBe(seen.length === 1 ? 401 : 200);
      expect(seen).toHaveLength(1);
    }
  });

  it('sends no authorization header without a token', async () => {
    const { config, seen } = await serve([200]);
    await httpTransport(config, tokens())(request);
    expect(seen).toEqual([undefined]);
  });

  it('turns a 401 into a refusal that says to log in', async () => {
    const { config } = await serve([401, 401]);
    store = Store.open(':memory:');
    store.enqueue({
      opId: 'a',
      kind: 'create',
      table: 'task',
      id: 't',
      fields: { title: 'a', rank: 'a0' },
      ts: '2026-10-01T00:00:00.000Z',
    });
    await expect(flush(store, httpTransport(config, tokens()))).rejects.toThrow(
      /run todoer login/,
    );
  });

  // FR-011: a server that accepts the connection and never answers is as
  // unreachable as one that refuses it.
  it('gives up on a server that never answers', async () => {
    server = createServer(() => {});
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    store = Store.open(':memory:');
    const send = httpTransport(
      {
        base: `http://127.0.0.1:${port}`,
        token: '',
        dbPath: ':memory:',
        timeoutMs: 200,
      },
      tokens(),
    );

    const started = Date.now();
    const flushed = await flush(store, send);

    expect(flushed.synced).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  }, 3000);
});
