import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayStatus, type StatusRow } from './status';

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/statuses.json', import.meta.url), 'utf8'),
) as {
  seed: StatusRow[];
  cases: Array<{
    name: string;
    statusId: string | null;
    closed: boolean;
    statuses?: StatusRow[];
    expected: string | null;
  }>;
};

describe('displayStatus', () => {
  it.each(vectors.cases)('$name', (c) => {
    expect(
      displayStatus(c.statusId, c.statuses ?? vectors.seed, c.closed),
    ).toBe(c.expected);
  });

  it('does not reorder the caller’s array', () => {
    const statuses = [...vectors.seed].reverse();
    const before = statuses.map((s) => s.id);
    displayStatus(null, statuses, false);
    expect(statuses.map((s) => s.id)).toEqual(before);
  });
});
