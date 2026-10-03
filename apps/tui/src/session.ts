import {
  RefusalError,
  type EngineAuth,
  type EngineTokens,
  type Store,
  type TokenSource,
} from '@todoer/client-core';

const USE_CLI = 'sign in with `todoer login`; the TUI uses that session';

/**
 * The CLI's session as the engine sees it. The TUI reads it and renews it
 * (under the store's write lock, so the CLI and the TUI never both spend one
 * refresh token) but never starts or ends it: `todoer login` and
 * `todoer logout` own it. So `adopt` and `logout` change nothing, and the
 * engine's own sign-in is refused with a pointer to the CLI.
 */
export function cliSession(
  store: Store,
  tokens: TokenSource,
  envToken: string,
): { auth: EngineAuth; tokens: EngineTokens } {
  return {
    auth: {
      login: () => Promise.reject(new RefusalError(USE_CLI)),
      register: () => Promise.reject(new RefusalError(USE_CLI)),
      logout: () => Promise.resolve(undefined),
    },
    tokens: {
      current: () => tokens.current(),
      renew: (refused) => tokens.renew(refused),
      adopt: () => undefined,
      signedIn: () => envToken !== '' || store.auth() !== undefined,
    },
  };
}
