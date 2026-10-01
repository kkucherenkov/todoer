import type { LogoutRequest, SessionTokens } from '@todoer/specs';
import type { Config } from './config.js';
import { RefusalError } from './protocol.js';
import type { Store, StoredAuth } from './store.js';

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
      const next = await api.refresh(auth.refreshToken);
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
export function httpAuthApi(config: Config): AuthApi {
  const post = (path: string, body: unknown, bearer?: string) =>
    fetch(`${config.base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  const refuse = async (path: string, response: Response) =>
    new RefusalError(
      `${path} refused: ${response.status} ${await response.text().catch(() => '')}`,
    );
  const tokens = (body: SessionTokens): StoredAuth => ({
    accessToken: body.accessToken,
    accessExpiresAt: body.accessExpiresAt,
    refreshToken: body.refreshToken,
  });

  return {
    async login(email, password) {
      const response = await post('/auth/login', { email, password });
      if (!response.ok) throw await refuse('login', response);
      return tokens((await response.json()) as SessionTokens);
    },
    async refresh(refreshToken) {
      const response = await post('/auth/refresh', { refreshToken });
      if (response.status === 401) return 'invalid';
      if (!response.ok) throw await refuse('refresh', response);
      return tokens((await response.json()) as SessionTokens);
    },
    async logout(accessToken, body) {
      const response = await post('/auth/logout', body, accessToken);
      if (response.status === 401) return 'unauthorized';
      if (!response.ok) throw await refuse('logout', response);
    },
  };
}
