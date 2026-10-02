import { describe, expect, it } from 'vitest';
import { rankBetween, ranksBetween, rankWrites, type Ranked } from './rank.js';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (b: string | null, r: string, a: string | null): boolean =>
  (b === null || b < r) && (a === null || r < a);

describe('rankBetween', () => {
  it.each<[string | null, string | null]>([
    [null, null],
    [null, 'a0'],
    ['a0', null],
    ['a0', 'a1'],
    ['az', 'b'],
    ['a0z', 'a1'],
  ])('(%s, %s) is strictly between and never ends in 0', (b, a) => {
    const r = rankBetween(b, a);
    expect(between(b, r, a)).toBe(true);
    expect(r.endsWith('0')).toBe(false);
  });

  it('pins the midpoint', () => {
    expect(rankBetween('a0', 'a1')).toBe('a0i');
    expect(rankBetween('a0', 'a3')).toBe('a1'); // odd sum: rounds down
  });

  it('stays strictly between across random inserts at ends, gaps and equal ranks', () => {
    const rnd = mulberry32(7);
    const keys: string[] = ['a0'];
    for (let i = 0; i < 2000; i += 1) {
      const sorted = [...keys].sort();
      const k = Math.floor(rnd() * (sorted.length + 1)); // gap index, 0 and length are the ends
      let b = k === 0 ? null : sorted[k - 1]!;
      const a = k === sorted.length ? null : sorted[k]!;
      if (b !== null && a !== null && b >= a) b = null; // tie: only the open side is usable
      const r = rankBetween(b, a);
      expect(between(b, r, a)).toBe(true);
      expect(r.endsWith('0')).toBe(false);
      keys.push(r);
    }
    // random gaps stay short; the same-gap worst case is bounded below
    expect(Math.max(...keys.map((s) => s.length))).toBeLessThan(40);
  });

  it('keeps keys under 50 characters over 200 inserts at the same gap (about 5 inserts per character)', () => {
    for (const [b, a] of [
      ['a0', 'a1'],
      ['a0', null],
      [null, 'a0'],
    ] as const) {
      let lo: string | null = b;
      let hi: string | null = a;
      for (let i = 0; i < 200; i += 1) {
        const r = rankBetween(lo, hi);
        expect(between(lo, r, hi)).toBe(true);
        expect(r.length).toBeLessThan(50);
        if (i % 2 === 0) lo = r;
        else hi = r;
      }
    }
  });

  it('throws when before >= after', () => {
    expect(() => rankBetween('a0', 'a0')).toThrow();
    expect(() => rankBetween('b', 'a')).toThrow();
  });
});

describe('ranksBetween', () => {
  it('returns n ascending keys, short', () => {
    const rs = ranksBetween('a0', 'a1', 50);
    expect(rs).toHaveLength(50);
    expect([...rs].sort()).toEqual(rs);
    expect(new Set(rs).size).toBe(50);
    for (const r of rs) expect(between('a0', r, 'a1')).toBe(true);
    expect(Math.max(...rs.map((r) => r.length))).toBeLessThanOrEqual(6);
  });

  it('handles open ends and zero', () => {
    expect(ranksBetween(null, null, 0)).toEqual([]);
    const rs = ranksBetween(null, null, 100);
    expect([...rs].sort()).toEqual(rs);
    expect(new Set(rs).size).toBe(100);
  });
});

describe('rankWrites', () => {
  const t = (id: string, rank: string): Ranked => ({ id, rank });
  const apply = (
    ordered: Ranked[],
    writes: Ranked[],
    moved: string,
  ): Ranked[] => {
    const m = new Map(ordered.map((x) => [x.id, x.rank]));
    for (const w of writes) m.set(w.id, w.rank);
    if (!m.has(moved)) throw new Error('moved not written');
    return [...m]
      .map(([id, rank]) => t(id, rank))
      .sort((x, y) =>
        x.rank < y.rank
          ? -1
          : x.rank > y.rank
            ? 1
            : x.id < y.id
              ? -1
              : x.id > y.id
                ? 1
                : 0,
      );
  };

  it('writes one rank when neighbours differ', () => {
    const o = [t('1', 'a0'), t('2', 'a1'), t('3', 'a2')];
    const w = rankWrites(o, 'm', '1');
    expect(w).toHaveLength(1);
    expect(apply(o, w, 'm').map((x) => x.id)).toEqual(['1', 'm', '2', '3']);
  });

  it('writes one rank to the top and to the bottom', () => {
    const o = [t('1', 'a0'), t('2', 'a1')];
    const top = rankWrites(o, 'm', null);
    expect(top).toHaveLength(1);
    expect(apply(o, top, 'm').map((x) => x.id)).toEqual(['m', '1', '2']);
    const bottom = rankWrites(o, 'm', '2');
    expect(bottom).toHaveLength(1);
    expect(apply(o, bottom, 'm').map((x) => x.id)).toEqual(['1', '2', 'm']);
    expect(rankWrites([], 'm', null)).toHaveLength(1);
  });

  it('re-ranks the tied run so the order is exactly as asked', () => {
    const o = ['1', '2', '3', '4'].map((id) => t(id, 'a0'));
    const w = rankWrites(o, 'm', '2');
    expect(w.map((x) => x.id).sort()).toEqual(['3', '4', 'm']);
    expect(apply(o, w, 'm').map((x) => x.id)).toEqual([
      '1',
      '2',
      'm',
      '3',
      '4',
    ]);
  });

  it('keeps a run that ends before a higher neighbour below it', () => {
    const o = [t('1', 'a0'), t('2', 'a0'), t('3', 'a0'), t('4', 'b')];
    const w = rankWrites(o, 'm', '1');
    expect(apply(o, w, 'm').map((x) => x.id)).toEqual([
      '1',
      'm',
      '2',
      '3',
      '4',
    ]);
  });

  it('throws when after is not in ordered', () => {
    expect(() => rankWrites([t('1', 'a0')], 'm', 'zz')).toThrow();
  });

  it('property: any drop lands exactly where asked, among equal ranks too', () => {
    const rnd = mulberry32(42);
    for (let round = 0; round < 300; round += 1) {
      const n = 1 + Math.floor(rnd() * 8);
      const ranks = Array.from(
        { length: n },
        () => `a${Math.floor(rnd() * 3)}`,
      ).sort();
      const o = ranks.map((r, i) => t(`${i + 1}`, r)); // sorted by rank then id (ids single digit)
      const k = Math.floor(rnd() * (n + 1));
      const after = k === 0 ? null : o[k - 1]!.id;
      const w = rankWrites(o, 'm', after);
      const expected = [
        ...o.slice(0, k).map((x) => x.id),
        'm',
        ...o.slice(k).map((x) => x.id),
      ];
      expect(apply(o, w, 'm').map((x) => x.id)).toEqual(expected);
      for (const x of w) expect(x.rank.endsWith('0')).toBe(false);
    }
  });
});
