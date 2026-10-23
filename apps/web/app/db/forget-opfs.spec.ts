import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetOpfs } from './forget-opfs';

const storage = (names: string[], refuse: string[] = []) => {
  const removed: [string, boolean | undefined][] = [];
  const root = {
    keys: () => names[Symbol.iterator](),
    removeEntry(name: string, options?: { recursive?: boolean }) {
      if (refuse.includes(name)) return Promise.reject(new Error('busy'));
      removed.push([name, options?.recursive]);
      return Promise.resolve();
    },
  };
  return {
    removed,
    getDirectory: () => Promise.resolve(root),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('forgetOpfs', () => {
  it('removes every entry recursively', async () => {
    const s = storage(['todoer.sqlite3', '.opaque']);
    expect(await forgetOpfs(s)).toBe(true);
    expect(s.removed).toEqual([
      ['todoer.sqlite3', true],
      ['.opaque', true],
    ]);
  });

  it("swallows Firefox's UnknownError", async () => {
    const getDirectory = () =>
      Promise.reject(new DOMException('Unknown failure', 'UnknownError'));
    expect(await forgetOpfs({ getDirectory })).toBe(false);
  });

  it('swallows a missing storage manager', async () => {
    vi.stubGlobal('navigator', {});
    expect(await forgetOpfs()).toBe(false);
  });

  it('reports an entry it could not remove, and removes the others', async () => {
    const s = storage(['a', 'b'], ['a']);
    expect(await forgetOpfs(s)).toBe(false);
    expect(s.removed).toEqual([['b', true]]);
  });
});
