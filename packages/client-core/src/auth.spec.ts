import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cookieTokenSource,
  httpAuthApi,
  httpCookieAuthApi,
  subject,
  tokenSource,
  type AuthApi,
  type CookieAuthApi,
} from './auth.js';
import { RefusalError } from './protocol.js';
import type { AccessGrant, Store, StoredAuth } from './store.js';
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

type Seen = { path: string | undefined; body: unknown };

describe('httpAuthApi', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  /** Answers every request with `status` and `body`, recording what it got. */
  async function serve(status: number, body: unknown, seen: Seen[] = []) {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seen.push({
          path: req.url,
          body: raw === '' ? undefined : JSON.parse(raw),
        });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    return httpAuthApi({ base: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
  }

  describe('logout', () => {
    it('maps a 401 to unauthorized', async () => {
      const api = await serve(401, {});
      expect(await api.logout('access', { all: true })).toBe('unauthorized');
    });

    it('rejects any other failure with a RefusalError', async () => {
      const api = await serve(500, {});
      await expect(api.logout('access', { all: true })).rejects.toBeInstanceOf(
        RefusalError,
      );
    });
  });

  describe('sessions', () => {
    const noRefresh = { accessToken: 'a', accessExpiresAt: at(900) };

    it('login refuses a response without a refresh token', async () => {
      const api = await serve(200, noRefresh);
      await expect(api.login('a@b.c', 'pw')).rejects.toThrow(
        /no refresh token/,
      );
      await expect(api.login('a@b.c', 'pw')).rejects.toBeInstanceOf(
        RefusalError,
      );
    });

    it('refresh refuses a response without a refresh token', async () => {
      const api = await serve(200, noRefresh);
      await expect(api.refresh('r')).rejects.toThrow(/no refresh token/);
      await expect(api.refresh('r')).rejects.toBeInstanceOf(RefusalError);
    });

    it('login sends exactly email and password', async () => {
      const seen: Seen[] = [];
      const api = await serve(200, { ...noRefresh, refreshToken: 'r' }, seen);
      await api.login('a@b.c', 'pw');
      expect(seen).toEqual([
        { path: '/auth/login', body: { email: 'a@b.c', password: 'pw' } },
      ]);
    });
  });
});

const grant = (access: string, seconds: number): AccessGrant => ({
  accessToken: access,
  accessExpiresAt: at(seconds),
});

/** A CookieAuthApi whose refresh answers from `results`, last one repeating. */
function fakeCookieApi(...results: (AccessGrant | 'invalid' | Error)[]) {
  const calls = { refresh: 0 };
  const api: CookieAuthApi = {
    login: () => Promise.reject(new Error('unused')),
    refresh: async () => {
      const result = results[Math.min(calls.refresh++, results.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (result instanceof Error) throw result;
      return result ?? 'invalid';
    },
    logout: () => Promise.reject(new Error('unused')),
  };
  return { api, calls };
}

describe('cookieTokenSource', () => {
  it('refreshes once before any grant and returns the new token', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    expect(await tokens.current()).toBe('new');
    expect(await tokens.current()).toBe('new');
    expect(calls.refresh).toBe(1);
  });

  it('returns an adopted grant without calling the API', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    tokens.adopt(grant('fresh', 600));
    expect(await tokens.current()).toBe('fresh');
    expect(calls.refresh).toBe(0);
  });

  it('refreshes a grant within 60 s of expiry', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    tokens.adopt(grant('old', 30));
    expect(await tokens.current()).toBe('new');
    expect(calls.refresh).toBe(1);
  });

  it('shares one refresh between current and renew in flight', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    const [a, b] = await Promise.all([tokens.current(), tokens.renew('x')]);
    expect(calls.refresh).toBe(1);
    expect([a, b]).toEqual(['new', 'new']);
  });

  it('renew returns the held token when it differs from the refused one', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    tokens.adopt(grant('held', 600));
    expect(await tokens.renew('stale')).toBe('held');
    expect(calls.refresh).toBe(0);
  });

  it('a refused refresh rejects, signs out, and is not tried again', async () => {
    const { api, calls } = fakeCookieApi('invalid');
    const tokens = cookieTokenSource(api, now);
    expect(tokens.signedIn()).toBe(true);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
    expect(tokens.signedIn()).toBe(false);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
    expect(calls.refresh).toBe(1);
  });

  it('after adopt(undefined) current rejects without calling the API', async () => {
    const { api, calls } = fakeCookieApi(grant('new', 900));
    const tokens = cookieTokenSource(api, now);
    tokens.adopt(grant('held', 600));
    tokens.adopt(undefined);
    expect(tokens.signedIn()).toBe(false);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
    expect(calls.refresh).toBe(0);
  });

  /** A refresh that answers only when `settle` is called. */
  function heldRefresh() {
    let settle: (result: AccessGrant | 'invalid') => void = () => {};
    const api: CookieAuthApi = {
      login: () => Promise.reject(new Error('unused')),
      refresh: () => new Promise((resolve) => (settle = resolve)),
      logout: () => Promise.reject(new Error('unused')),
    };
    return { api, settle: (result: AccessGrant | 'invalid') => settle(result) };
  }

  it('a refresh in flight does not undo a logout', async () => {
    const { api, settle } = heldRefresh();
    const tokens = cookieTokenSource(api, now);
    const pending = tokens.current();
    const outcome = expect(pending).rejects.toThrow(RefusalError);
    tokens.adopt(undefined);
    settle(grant('late', 900));
    await outcome;
    expect(tokens.signedIn()).toBe(false);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
  });

  it('a late refusal does not end a session adopted meanwhile', async () => {
    const { api, settle } = heldRefresh();
    const tokens = cookieTokenSource(api, now);
    const pending = tokens.current();
    tokens.adopt(grant('fresh', 600));
    settle('invalid');
    expect(await pending).toBe('fresh');
    expect(tokens.signedIn()).toBe(true);
    expect(await tokens.current()).toBe('fresh');
  });

  it('retries a network error once', async () => {
    const { api, calls } = fakeCookieApi(
      new TypeError('fetch failed'),
      grant('new', 900),
    );
    expect(await cookieTokenSource(api, now).current()).toBe('new');
    expect(calls.refresh).toBe(2);
  });

  it('propagates a second network error and stays signed in', async () => {
    const { api, calls } = fakeCookieApi(new TypeError('fetch failed'));
    const tokens = cookieTokenSource(api, now);
    await expect(tokens.current()).rejects.toThrow(TypeError);
    expect(calls.refresh).toBe(2);
    expect(tokens.signedIn()).toBe(true);
  });

  it('does not retry a refusal and stays signed in', async () => {
    const { api, calls } = fakeCookieApi(
      new RefusalError('refresh refused: 429'),
    );
    const tokens = cookieTokenSource(api, now);
    await expect(tokens.current()).rejects.toThrow(RefusalError);
    expect(calls.refresh).toBe(1);
    expect(tokens.signedIn()).toBe(true);
  });
});

describe('httpCookieAuthApi', () => {
  let server: Server | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  type Got = Seen & { authorization: string | undefined };
  async function serve(status: number, body: unknown, seen: Got[] = []) {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        seen.push({
          path: req.url,
          body: raw === '' ? undefined : JSON.parse(raw),
          authorization: req.headers.authorization,
        });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    return httpCookieAuthApi({
      base: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    });
  }

  const two = { accessToken: 'a', accessExpiresAt: at(900) };

  it('login sends exactly email, password and the cookie transport', async () => {
    const seen: Got[] = [];
    const api = await serve(200, two, seen);
    await api.login('a@b.c', 'pw');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/auth/login');
    expect(seen[0]?.body).toEqual({
      email: 'a@b.c',
      password: 'pw',
      transport: 'cookie',
    });
  });

  it('login resolves to the two grant fields', async () => {
    expect(await (await serve(200, two)).login('a@b.c', 'pw')).toStrictEqual(
      two,
    );
  });

  it('never keeps a refresh token the server sent anyway', async () => {
    const api = await serve(200, { ...two, refreshToken: 'secret' });
    const result = await api.login('a@b.c', 'pw');
    expect(Object.keys(result as object).sort()).toEqual([
      'accessExpiresAt',
      'accessToken',
    ]);
  });

  it('refresh never keeps a refresh token the server sent anyway', async () => {
    const api = await serve(200, { ...two, refreshToken: 'secret' });
    expect(Object.keys((await api.refresh()) as object).sort()).toEqual([
      'accessExpiresAt',
      'accessToken',
    ]);
  });

  it('login maps 401 to invalid and 429 to a RefusalError', async () => {
    expect(await (await serve(401, {})).login('a@b.c', 'pw')).toBe('invalid');
    await expect(
      (await serve(429, {})).login('a@b.c', 'pw'),
    ).rejects.toBeInstanceOf(RefusalError);
  });

  it('refresh sends an empty object; 401 is invalid', async () => {
    const seen: Got[] = [];
    const api = await serve(200, two, seen);
    await api.refresh();
    expect(seen[0]?.path).toBe('/auth/refresh');
    expect(seen[0]?.body).toEqual({});
    expect(await (await serve(401, {})).refresh()).toBe('invalid');
  });

  it('logout sends an empty object with the bearer; 401 is unauthorized', async () => {
    const seen: Got[] = [];
    const api = await serve(204, {}, seen);
    await api.logout('tok');
    expect(seen[0]?.path).toBe('/auth/logout');
    expect(seen[0]?.body).toEqual({});
    expect(seen[0]?.authorization).toBe('Bearer tok');
    expect(await (await serve(401, {})).logout('tok')).toBe('unauthorized');
  });
});

describe('fetch credentials', () => {
  const credentialsOf = async (
    call: (base: ReturnType<typeof httpCookieAuthApi>) => Promise<unknown>,
  ) => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ accessToken: 'a', accessExpiresAt: at(900) }),
        ),
      );
    try {
      await call(
        httpCookieAuthApi({ base: 'http://unused.invalid', timeoutMs: 1000 }),
      );
      return spy.mock.calls.map(([, init]) => init?.credentials);
    } finally {
      spy.mockRestore();
    }
  };

  it('sends the cookie same-origin on login, refresh and logout', async () => {
    expect(await credentialsOf((api) => api.login('a@b.c', 'pw'))).toEqual([
      'same-origin',
    ]);
    expect(await credentialsOf((api) => api.refresh())).toEqual([
      'same-origin',
    ]);
    expect(await credentialsOf((api) => api.logout('tok'))).toEqual([
      'same-origin',
    ]);
  });

  it('body mode sends no credentials key', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(Response.json({})));
    try {
      const api = httpAuthApi({
        base: 'http://unused.invalid',
        timeoutMs: 1000,
      });
      await api.logout('tok', { all: true });
      const init = spy.mock.calls[0]?.[1] as RequestInit;
      expect('credentials' in init).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('subject', () => {
  it('decodes an unpadded base64url payload holding - and _', () => {
    // '>>>???' base64 is 'Pj4+Pz8/'; in base64url it carries - and _.
    const sub = '>>>???';
    const segment = Buffer.from(JSON.stringify({ sub })).toString('base64url');
    expect(segment).toMatch(/[-_]/);
    expect(segment).not.toContain('=');
    expect(subject(`${segment}.mac`)).toBe(sub);
  });

  it('decodes a non-ASCII sub as UTF-8', () => {
    const sub = 'Ж-é';
    const segment = Buffer.from(JSON.stringify({ sub })).toString('base64url');
    expect(subject(`${segment}.mac`)).toBe(sub);
  });

  it('returns undefined for garbage', () => {
    expect(subject('not a token')).toBeUndefined();
    expect(subject('')).toBeUndefined();
  });
});
