import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpAuthApi, tokenSource, type AuthApi } from './auth.js';
import { RefusalError } from './protocol.js';
import type { Store, StoredAuth } from './store.js';
import { openStore } from './test-store.js';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const now = () => NOW;
const at = (seconds: number) =>
  new Date(NOW.getTime() + seconds * 1000).toISOString();
const session = (access: string, seconds: number): StoredAuth => ({
  accessToken: access,
  accessExpiresAt: at(seconds),
  refreshToken: `r-${access}`,
});

let dir: string;
let stores: Store[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-auth-'));
  stores = [];
});
afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});
const storeAt = () => {
  const store = openStore(join(dir, 'todoer.db'));
  stores.push(store);
  return store;
};

function fakeApi(next: StoredAuth | 'invalid' = session('new', 900)) {
  const calls: string[] = [];
  const api: AuthApi = {
    login: () => Promise.reject(new Error('unused')),
    refresh: async (refreshToken) => {
      calls.push(refreshToken);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return next;
    },
    logout: () => Promise.reject(new Error('unused')),
  };
  return { api, calls };
}

describe('tokenSource', () => {
  it('returns the env token and never touches the API', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 5));
    const { api, calls } = fakeApi();
    const tokens = tokenSource(store, api, 'env-token', now);
    expect(await tokens.current()).toBe('env-token');
    expect(await tokens.renew('env-token')).toBeNull();
    expect(calls).toEqual([]);
    expect(store.auth()).toEqual(session('old', 5));
  });

  it('returns a still-valid stored access token without refreshing', async () => {
    const store = storeAt();
    store.saveAuth(session('ok', 600));
    const { api, calls } = fakeApi();
    expect(await tokenSource(store, api, '', now).current()).toBe('ok');
    expect(calls).toEqual([]);
  });

  it('returns an empty token when nothing is stored', async () => {
    const { api, calls } = fakeApi();
    expect(await tokenSource(storeAt(), api, '', now).current()).toBe('');
    expect(calls).toEqual([]);
  });

  it('refreshes an access token that expires within a minute', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 30));
    const { api, calls } = fakeApi();
    expect(await tokenSource(store, api, '', now).current()).toBe('new');
    expect(calls).toEqual(['r-old']);
    expect(store.auth()).toEqual(session('new', 900));
  });

  it('clears the session and says to log in when the refresh token is refused', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 30));
    const { api } = fakeApi('invalid');
    const tokens = tokenSource(store, api, '', now);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
    await expect(tokens.current()).resolves.toBe('');
    expect(store.auth()).toBeUndefined();
  });

  it('names todoer login in the message', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 30));
    await expect(
      tokenSource(store, fakeApi('invalid').api, '', now).current(),
    ).rejects.toThrow(/run todoer login/);
  });

  // Review Focus 4: the refresh token rotates on every use, so a second
  // process refreshing the same one would be treated as a replay.
  it('refreshes once when two processes find the token expiring', async () => {
    const [a, b] = [storeAt(), storeAt()];
    a.saveAuth(session('old', 30));
    const { api, calls } = fakeApi();
    const [x, y] = await Promise.all([
      tokenSource(a, api, '', now).current(),
      tokenSource(b, api, '', now).current(),
    ]);
    expect(calls).toHaveLength(1);
    expect([x, y]).toEqual(['new', 'new']);
  });

  it('retries a refresh whose response was lost once, with the same token', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 5));
    const refreshed = session('new', 900);
    const calls: string[] = [];
    const api: AuthApi = {
      ...fakeApi().api,
      refresh: (token) => {
        calls.push(token);
        return calls.length === 1
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(refreshed);
      },
    };
    expect(await tokenSource(store, api, '', now).current()).toBe('new');
    expect(calls).toEqual(['r-old', 'r-old']);
    expect(store.auth()).toEqual(refreshed);
  });

  it('gives up after a second network error and keeps the session', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 5));
    let calls = 0;
    const api: AuthApi = {
      ...fakeApi().api,
      refresh: () => {
        calls++;
        return Promise.reject(new TypeError('fetch failed'));
      },
    };
    await expect(tokenSource(store, api, '', now).current()).rejects.toThrow(
      TypeError,
    );
    expect(calls).toBe(2);
    expect(store.auth()).toEqual(session('old', 5));
  });

  it('does not retry a refusal', async () => {
    const store = storeAt();
    store.saveAuth(session('old', 5));
    let calls = 0;
    const api: AuthApi = {
      ...fakeApi().api,
      refresh: () => {
        calls++;
        return Promise.reject(new RefusalError('refresh refused: 500'));
      },
    };
    await expect(tokenSource(store, api, '', now).current()).rejects.toThrow(
      RefusalError,
    );
    expect(calls).toBe(1);
  });

  it('renew returns the stored token when another process already rotated it', async () => {
    const store = storeAt();
    store.saveAuth(session('fresh', 600));
    const { api, calls } = fakeApi();
    expect(await tokenSource(store, api, '', now).renew('stale')).toBe('fresh');
    expect(calls).toEqual([]);
  });

  // FR-011: a 401 for a token the client believes valid (clock skew).
  it('renew refreshes the refused token even when it is not expiring', async () => {
    const store = storeAt();
    store.saveAuth(session('skewed', 600));
    const { api, calls } = fakeApi();
    expect(await tokenSource(store, api, '', now).renew('skewed')).toBe('new');
    expect(calls).toEqual(['r-skewed']);
    expect(store.auth()).toEqual(session('new', 900));
  });
});

describe('httpAuthApi.logout', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  async function logoutWith(status: number) {
    server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    const config = {
      base: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    };
    return httpAuthApi(config).logout('access', { all: true });
  }

  it('maps a 401 to unauthorized', async () => {
    expect(await logoutWith(401)).toBe('unauthorized');
  });

  it('rejects any other failure with a RefusalError', async () => {
    await expect(logoutWith(500)).rejects.toBeInstanceOf(RefusalError);
  });
});
