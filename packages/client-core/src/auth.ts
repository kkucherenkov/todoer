import type { LogoutRequest, SessionTokens } from '@todoer/specs';
import type { HttpConfig } from './transport.js';
import { RefusalError } from './protocol.js';
import type { AccessGrant, Store, StoredAuth } from './store.js';

export type AuthApi = {
  login(email: string, password: string): Promise<StoredAuth>;
  /** `'invalid'`: the server no longer accepts this refresh token. */
  refresh(refreshToken: string): Promise<StoredAuth | 'invalid'>;
  /** `'unauthorized'`: the server refused the access token. */
  logout(
    accessToken: string,
    body: LogoutRequest,
  ): Promise<'unauthorized' | undefined>;
};

export type TokenSource = {
  current(): Promise<string>;
  /** A token to retry with after the server refused `refused`, or null when
   *  there is nothing to renew. */
  renew(refused: string): Promise<string | null>;
};

/** Renew an access token this close to its expiry, so it does not lapse
 *  between the check and the server reading it. */
const RENEW_WITHIN_MS = 60_000;

/**
 * A lost response may have rotated the token; the server answers a repeat
 * inside its grace window with the same successor. A refusal is an answer,
 * not a loss, and is not retried.
 */
async function retryOnce<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RefusalError) throw error;
    return call();
  }
}

/**
 * `TODOER_TOKEN` wins when set and is never renewed. Otherwise the stored
 * session is used, refreshed under the store's write lock: the refresh token
 * rotates on every use, so two processes refreshing the same one would make
 * the second look like a replay. The second therefore re-reads inside the
 * lock and takes what the first stored.
 */
export function tokenSource(
  store: Store,
  api: AuthApi,
  envToken: string,
  now: () => Date,
): TokenSource {
  const expiring = (auth: StoredAuth) =>
    Date.parse(auth.accessExpiresAt) - now().getTime() < RENEW_WITHIN_MS;

  const renew = async (refused: string): Promise<string | null> => {
    if (envToken !== '') return null;
    const renewed = await store.withWriteLock(async () => {
      const auth = store.auth();
      if (auth === undefined) return null;
      // Another process already rotated the token the server refused.
      if (auth.accessToken !== refused) return auth.accessToken;
      const next = await retryOnce(() => api.refresh(auth.refreshToken));
      if (next === 'invalid') store.clearAuth();
      else store.saveAuth(next);
      return next === 'invalid' ? 'invalid' : next.accessToken;
    });
    // Thrown outside the lock: an error inside would roll the clearAuth back.
    if (renewed === 'invalid') {
      throw new RefusalError('your session has ended — run todoer login');
    }
    return renewed;
  };

  return {
    async current() {
      if (envToken !== '') return envToken;
      const auth = store.auth();
      if (auth === undefined) return '';
      return expiring(auth)
        ? ((await renew(auth.accessToken)) ?? '')
        : auth.accessToken;
    },
    renew,
  };
}

/** POST /auth/*, bounded by the configured timeout like /sync. */
const post = (
  config: HttpConfig,
  path: string,
  body: unknown,
  bearer?: string,
  sameOrigin = false,
) =>
  fetch(`${config.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify(body),
    ...(sameOrigin ? { credentials: 'same-origin' as const } : {}),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

const refuse = async (path: string, response: Response) =>
  new RefusalError(
    `${path} refused: ${response.status} ${await response.text().catch(() => '')}`,
  );

export function httpAuthApi(config: HttpConfig): AuthApi {
  const send = (path: string, body: unknown, bearer?: string) =>
    post(config, path, body, bearer);
  // The CLI asks for the body transport (it never sends `transport`), so a
  // missing token means a server that does not speak this contract. Storing
  // it as undefined would leave a session that can never refresh.
  const tokens = (body: SessionTokens): StoredAuth => {
    if (typeof body.refreshToken !== 'string' || body.refreshToken === '') {
      throw new RefusalError('the server sent no refresh token');
    }
    return {
      accessToken: body.accessToken,
      accessExpiresAt: body.accessExpiresAt,
      refreshToken: body.refreshToken,
    };
  };

  return {
    async login(email, password) {
      const response = await send('/auth/login', { email, password });
      if (!response.ok) throw await refuse('login', response);
      return tokens((await response.json()) as SessionTokens);
    },
    async refresh(refreshToken) {
      const response = await send('/auth/refresh', { refreshToken });
      if (response.status === 401) return 'invalid';
      if (!response.ok) throw await refuse('refresh', response);
      return tokens((await response.json()) as SessionTokens);
    },
    async logout(accessToken, body) {
      const response = await send('/auth/logout', body, accessToken);
      if (response.status === 401) return 'unauthorized';
      if (!response.ok) throw await refuse('logout', response);
    },
  };
}

/** POST /auth/* with the refresh token in the HttpOnly cookie (ADR 0011). */
export type CookieAuthApi = {
  /** `'invalid'`: wrong email or password (401). */
  login(email: string, password: string): Promise<AccessGrant | 'invalid'>;
  /** `'invalid'`: no cookie, or one the server no longer accepts (401). */
  refresh(): Promise<AccessGrant | 'invalid'>;
  logout(accessToken: string): Promise<'unauthorized' | undefined>;
};

export function httpCookieAuthApi(config: HttpConfig): CookieAuthApi {
  const send = (path: string, body: unknown, bearer?: string) =>
    post(config, path, body, bearer, true);
  // Picked by name, never spread: a refresh token in the body is not kept.
  const grant = async (response: Response): Promise<AccessGrant> => {
    const body = (await response.json()) as SessionTokens;
    return {
      accessToken: body.accessToken,
      accessExpiresAt: body.accessExpiresAt,
    };
  };

  return {
    async login(email, password) {
      const response = await send('/auth/login', {
        email,
        password,
        transport: 'cookie',
      });
      if (response.status === 401) return 'invalid';
      if (!response.ok) throw await refuse('login', response);
      return grant(response);
    },
    async refresh() {
      const response = await send('/auth/refresh', {});
      if (response.status === 401) return 'invalid';
      if (!response.ok) throw await refuse('refresh', response);
      return grant(response);
    },
    async logout(accessToken) {
      const response = await send('/auth/logout', {}, accessToken);
      if (response.status === 401) return 'unauthorized';
      if (!response.ok) throw await refuse('logout', response);
    },
  };
}

export type CookieTokenSource = TokenSource & {
  /** The grant a login returned; `undefined` after a logout, after which no
   *  refresh is tried until the next adopt. */
  adopt(grant: AccessGrant | undefined): void;
  /** False after a logout or a refused refresh. True before the first
   *  refresh too: the cookie may still hold a session. */
  signedIn(): boolean;
};

/**
 * The web's session (ADR 0011): the refresh token is an HttpOnly cookie the
 * worker cannot read, so only the access token is held, in memory. One
 * worker per origin, so no lock: concurrent callers share one refresh.
 */
export function cookieTokenSource(
  api: CookieAuthApi,
  now: () => Date,
): CookieTokenSource {
  // 'unknown': not refreshed yet, the cookie may hold a session.
  // 'ended': logged out or refused; nothing to try until the next adopt.
  let held: AccessGrant | 'unknown' | 'ended' = 'unknown';
  let inflight: Promise<string> | undefined;

  const refresh = (): Promise<string> =>
    (inflight ??= retryOnce(() => api.refresh())
      .then((next) => {
        if (next === 'invalid') {
          held = 'ended';
          throw new RefusalError('your session has ended — sign in again');
        }
        held = next;
        return next.accessToken;
      })
      .finally(() => (inflight = undefined)));

  const renew = async (refused: string): Promise<string | null> => {
    if (held === 'ended') throw new RefusalError('signed out');
    if (typeof held === 'object' && held.accessToken !== refused) {
      return held.accessToken;
    }
    return refresh();
  };

  return {
    async current() {
      if (
        typeof held === 'object' &&
        Date.parse(held.accessExpiresAt) - now().getTime() >= RENEW_WITHIN_MS
      ) {
        return held.accessToken;
      }
      return (
        (await renew(typeof held === 'object' ? held.accessToken : '')) ?? ''
      );
    },
    renew,
    adopt(next) {
      held = next ?? 'ended';
    },
    signedIn: () => held !== 'ended',
  };
}

/** The `sub` claim of an access token (base64url(JSON) + '.' + mac). Read, not
 *  verified: the server verifies it, this only names whose replica it is. */
export function subject(token: string): string | undefined {
  try {
    const segment = (token.split('.')[0] ?? '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(segment), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      sub?: unknown;
    };
    return typeof claims.sub === 'string' ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The replica, cursor and outbox belong to one account: `change_seq` is
 * global, so another account's cursor would skip its rows, and queued
 * operations would be delivered to the wrong user. Signing in as someone else
 * drops the replica, but never operations nobody has delivered.
 */
export function adoptAccount(store: Store, accessToken: string): void {
  const user = subject(accessToken);
  if (user === undefined) return;
  const owner = store.owner();
  if (owner !== undefined && owner !== user) {
    const { pending, failed } = store.counts();
    if (pending + failed > 0) {
      throw new RefusalError(
        `${pending + failed} queued operation(s) belong to the previous account: sign back in as it to deliver them (todoer outbox drop forgets failed ones)`,
      );
    }
    store.resetReplica();
  }
  store.setOwner(user);
}
