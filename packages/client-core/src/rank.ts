const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A key strictly between `before` and `after` (ADR 0008); null is open.
 *  Digits 0-9a-z, so JS `<` and SQLite's BINARY collation agree. Throws
 *  when before >= after: callers resolve ties first (rankWrites). */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  const lo = before ?? '';
  if (after !== null && lo >= after) {
    throw new Error(`no rank between ${lo} and ${after}`);
  }
  let hi = after;
  let out = '';
  for (let i = 0; ; i += 1) {
    const l = i < lo.length ? DIGITS.indexOf(lo[i]!) : 0;
    const h = hi === null ? DIGITS.length : DIGITS.indexOf(hi[i]!);
    if (h < 0) throw new Error(`no rank between ${lo} and ${after}`); // `hi` ended: it is `lo` plus zeros
    // Room at this digit: the midpoint is > l >= 0, so never a trailing '0'.
    if (h - l > 1) return out + DIGITS[(l + h) >> 1];
    out += DIGITS[l];
    // Below `hi` from here on: the rest only has to exceed `lo`.
    if (h - l === 1) hi = null;
  }
}

/** `n` keys strictly between, ascending, of length O(log n). */
export function ranksBetween(
  before: string | null,
  after: string | null,
  n: number,
): string[] {
  if (n <= 0) return [];
  const mid = rankBetween(before, after);
  const left = Math.floor((n - 1) / 2);
  return [
    ...ranksBetween(before, mid, left),
    mid,
    ...ranksBetween(mid, after, n - 1 - left),
  ];
}

// Ranks `x` and `x0` hold no key between them, so they count as equal.
const trim = (r: string): string => r.replace(/0+$/, '');
const tied = (lower: string, upper: string): boolean =>
  lower >= upper || trim(lower) === trim(upper);

export type Ranked = { id: string; rank: string };

/**
 * The rank writes that put `moved` right after `after` (null: first) in
 * `ordered`, a container already sorted by rank then id that does not hold
 * `moved`. One write when the neighbours differ. When they tie, the tied
 * run after the gap is re-ranked with `moved`, so the result is exactly
 * the order asked for (departure 4).
 */
export function rankWrites(
  ordered: readonly Ranked[],
  moved: string,
  after: string | null,
): Ranked[] {
  const g = after === null ? 0 : ordered.findIndex((t) => t.id === after) + 1;
  if (g === 0 && after !== null)
    throw new Error(`rank anchor ${after} is not in the container`);
  const lower = ordered[g - 1]?.rank ?? null;
  const upper = ordered[g]?.rank ?? null;
  if (lower === null || upper === null || !tied(lower, upper)) {
    return [{ id: moved, rank: rankBetween(lower, upper) }];
  }
  let j = g;
  while (j < ordered.length && tied(lower, ordered[j]!.rank)) j += 1;
  const ids = [moved, ...ordered.slice(g, j).map((t) => t.id)];
  const ranks = ranksBetween(lower, ordered[j]?.rank ?? null, ids.length);
  return ids.map((id, i) => ({ id, rank: ranks[i]! }));
}
