import { describe, expect, it } from 'vitest';
import { readConfig } from './config.js';
import { UsageError } from './protocol.js';

describe('readConfig', () => {
  it('defaults the URL, the token and the timeout', () => {
    expect(readConfig({ HOME: '/home/a' })).toEqual({
      base: 'http://localhost:3000/api/v1',
      token: '',
      dbPath: '/home/a/.config/todoer/todoer.db',
      timeoutMs: 3000,
    });
  });

  it('reads every variable that is set', () => {
    expect(
      readConfig({
        HOME: '/home/b',
        TODOER_URL: 'https://todo.example/api/v1',
        TODOER_TOKEN: 'secret',
        TODOER_TIMEOUT_MS: '250',
      }),
    ).toEqual({
      base: 'https://todo.example/api/v1',
      token: 'secret',
      dbPath: '/home/b/.config/todoer/todoer.db',
      timeoutMs: 250,
    });
  });

  // A typo must not become "no timeout" or "wait NaN ms".
  it.each(['0', '-5', '1.5', 'soon'])(
    'refuses TODOER_TIMEOUT_MS=%s',
    (value) => {
      expect(() =>
        readConfig({ HOME: '/h', TODOER_TIMEOUT_MS: value }),
      ).toThrow(UsageError);
    },
  );
});
