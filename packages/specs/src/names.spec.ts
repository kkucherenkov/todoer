import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nameKey } from './names';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/names.json', import.meta.url), 'utf8'),
) as { cases: Array<{ a: string; b: string; same: boolean }> };

describe('nameKey', () => {
  it.each(vectors.cases)('$a vs $b → same: $same', ({ a, b, same }) => {
    expect(nameKey(a) === nameKey(b)).toBe(same);
  });

  it('keeps the characters, only folding case and composition', () => {
    expect(nameKey('@Phone')).toBe('@phone');
  });
});
