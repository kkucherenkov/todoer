import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { columns, modeFor, tooSmall, widths } from './layout.js';

describe('modeFor', () => {
  it.each([
    [140, 'three'],
    [120, 'three'],
    [119, 'two'],
    [90, 'two'],
    [89, 'one'],
    [60, 'one'],
  ] as const)('%i columns is %s', (cols, mode) => {
    expect(modeFor(cols)).toBe(mode);
  });
});

describe('widths', () => {
  it('fills the terminal minus the gaps', () => {
    expect(widths(140, 'three')).toEqual({
      sidebar: 24,
      outline: 66,
      detail: 48,
    });
    expect(widths(120, 'three')).toEqual({
      sidebar: 24,
      outline: 52,
      detail: 42,
    });
    expect(widths(100, 'two')).toEqual({ sidebar: 0, outline: 64, detail: 35 });
    expect(widths(80, 'one')).toEqual({ sidebar: 0, outline: 80, detail: 0 });
  });
});

describe('columns', () => {
  it.each([['plain'], ['Разобрать'], ['買い物'], ['👍🏽 done']])(
    'zips %s to exactly rows lines of the full width',
    (text) => {
      const parts = [
        { lines: [text, text, text], width: 8 },
        { lines: [text], width: 3 },
        { lines: [], width: 5 },
      ];
      const out = columns(parts, 2);
      expect(out).toHaveLength(2);
      for (const line of out) expect(visibleWidth(line)).toBe(8 + 3 + 5 + 2);
    },
  );
});

describe('tooSmall', () => {
  it('names the minimum', () => {
    const message = ['Terminal too small (need 60×12)'];
    expect(tooSmall(59, 30)).toEqual(message);
    expect(tooSmall(80, 11)).toEqual(message);
    expect(tooSmall(60, 12)).toBeNull();
  });
});
