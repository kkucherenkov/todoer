import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { HttpConfig } from './transport.js';
import { RefusalError } from './protocol.js';
import type { Store } from './store.js';
import { openStore } from './test-store.js';
import { flush } from './sync.js';
import { tokenSource, type AuthApi, type TokenSource } from './auth.js';
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

const task = {
  opId: 'a',
  kind: 'create',
  table: 'task',
  id: 't',
  fields: { title: 'a', rank: 'a0' },
  ts: '2026-10-01T00:00:00.000Z',
} as const;

/** Answers each request with the next status, recording its authorization. */
async function serve(
  statuses: number[],
): Promise<{ config: HttpConfig; seen: Array<string | undefined> }> {
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

  it('does not resend when there is nothing to renew', async () => {
    const { config, seen } = await serve([401, 200]);
    const response = await httpTransport(config, tokens('old', null))(request);
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  // FR-011: the token source decides whether a refused token is worth a
  // refresh; the transport always resends what it gets back.
  it('asks to renew the token the server refused', async () => {
    const { config, seen } = await serve([401, 200]);
    const refused: string[] = [];
    const source: TokenSource = {
      current: () => Promise.resolve('old'),
      renew: (token) => {
        refused.push(token);
        return Promise.resolve('new');
      },
    };
    await httpTransport(config, source)(request);
    expect(refused).toEqual(['old']);
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
  });

  it('refreshes once on a 401 for a token that looks valid', async () => {
    const { config, seen } = await serve([401, 200]);
    store = openStore(':memory:');
    const now = new Date('2026-10-01T12:00:00.000Z');
    store.saveAuth({
      accessToken: 'skewed',
      accessExpiresAt: '2026-10-01T12:10:00.000Z',
      refreshToken: 'r-skewed',
    });
    const refreshed: string[] = [];
    const api: AuthApi = {
      login: () => Promise.reject(new Error('unused')),
      refresh: (refreshToken) => {
        refreshed.push(refreshToken);
        return Promise.resolve({
          accessToken: 'new',
          accessExpiresAt: '2026-10-01T12:15:00.000Z',
          refreshToken: 'r-new',
        });
      },
      logout: () => Promise.reject(new Error('unused')),
    };
    const source = tokenSource(store, api, '', () => now);
    const response = await httpTransport(config, source)(request);
    expect(response.status).toBe(200);
    expect(refreshed).toEqual(['r-skewed']);
    expect(seen).toEqual(['Bearer skewed', 'Bearer new']);
  });

  // Review Focus 4 on the 401 path: two processes hold the same refused
  // token; the refresh token rotates, so exactly one may spend it.
  it('refreshes once when two processes both get a 401 for the same stored token', async () => {
    const seen: Array<string | undefined> = [];
    server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(req.headers.authorization === 'Bearer new' ? 200 : 401, {
        'content-type': 'application/json',
      });
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    const config: HttpConfig = {
      base: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    };
    const dir = mkdtempSync(join(tmpdir(), 'todoer-transport-'));
    const stores = [0, 1].map(() => openStore(join(dir, 'todoer.db')));
    try {
      stores[0]?.saveAuth({
        accessToken: 'old',
        // Looks valid, so only the 401 triggers a refresh.
        accessExpiresAt: '2026-10-01T12:10:00.000Z',
        refreshToken: 'r-old',
      });
      const refreshed: string[] = [];
      const api: AuthApi = {
        login: () => Promise.reject(new Error('unused')),
        refresh: async (refreshToken) => {
          refreshed.push(refreshToken);
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            accessToken: 'new',
            accessExpiresAt: '2026-10-01T12:15:00.000Z',
            refreshToken: 'r-new',
          };
        },
        logout: () => Promise.reject(new Error('unused')),
      };
      const at = new Date('2026-10-01T12:00:00.000Z');
      const responses = await Promise.all(
        stores.map((s) =>
          httpTransport(
            config,
            tokenSource(s, api, '', () => at),
          )(request),
        ),
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      expect(refreshed).toEqual(['r-old']);
      expect(seen.filter((h) => h === 'Bearer old')).toHaveLength(2);
      expect(seen.filter((h) => h === 'Bearer new')).toHaveLength(2);
    } finally {
      for (const s of stores) s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces a refusal from the token source and keeps operations pending', async () => {
    const { config } = await serve([200]);
    store = openStore(':memory:');
    store.enqueue(task);
    const source: TokenSource = {
      current: () =>
        Promise.reject(
          new RefusalError('your session has ended — run todoer login'),
        ),
      renew: () => Promise.resolve(null),
    };
    await expect(flush(store, httpTransport(config, source))).rejects.toThrow(
      /run todoer login/,
    );
    expect(store.counts()).toEqual({ pending: 1, failed: 0 });
  });

  it('sends no authorization header without a token', async () => {
    const { config, seen } = await serve([200]);
    await httpTransport(config, tokens())(request);
    expect(seen).toEqual([undefined]);
  });

  it('turns a 401 into a refusal that says to log in', async () => {
    const { config } = await serve([401, 401]);
    store = openStore(':memory:');
    store.enqueue(task);
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
    store = openStore(':memory:');
    const send = httpTransport(
      {
        base: `http://127.0.0.1:${port}`,
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
