import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RefusalError,
  type Store,
  type TokenSource,
} from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import { cliSession } from './session.js';

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-tui-'));
  store = openReplica(join(dir, 'todoer.db'));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const tokens: TokenSource = {
  current: () => Promise.resolve('access'),
  renew: () => Promise.resolve(null),
};
const saved = {
  accessToken: 'a',
  accessExpiresAt: '2099-01-01T00:00:00.000Z',
  refreshToken: 'r',
};

describe('cliSession', () => {
  it('is signed in with a stored session or an env token, not without', () => {
    expect(cliSession(store, tokens, '').tokens.signedIn()).toBe(false);
    expect(cliSession(store, tokens, 'env').tokens.signedIn()).toBe(true);
    store.saveAuth(saved);
    expect(cliSession(store, tokens, '').tokens.signedIn()).toBe(true);
  });

  it('passes current and renew through', async () => {
    const { tokens: t } = cliSession(store, tokens, '');
    expect(await t.current()).toBe('access');
    expect(await t.renew('x')).toBeNull();
  });

  it('never changes the stored session: adopt and logout do nothing', async () => {
    store.saveAuth(saved);
    const s = cliSession(store, tokens, '');
    s.tokens.adopt(undefined);
    expect(await s.auth.logout('a')).toBeUndefined();
    expect(store.auth()).toEqual(saved);
  });

  it('refuses to sign in, pointing at the CLI', async () => {
    const { auth } = cliSession(store, tokens, '');
    await expect(auth.login('a@b.c', 'x')).rejects.toThrow(RefusalError);
    await expect(auth.login('a@b.c', 'x')).rejects.toThrow(/todoer login/);
    await expect(auth.register('a@b.c', 'x')).rejects.toThrow(/todoer login/);
  });
});
