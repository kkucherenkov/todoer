import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ID_NAMESPACE, sha1, taskOccurrenceId, taskTagId, uuidv5 } from './ids';

type IdCase =
  | {
      kind: 'task_occurrence';
      taskId: string;
      occurrence: string | null;
      expected: string;
    }
  | { kind: 'task_tag'; taskId: string; tagId: string; expected: string };

const vectors = JSON.parse(
  readFileSync(new URL('../vectors/ids.json', import.meta.url), 'utf8'),
) as {
  namespace: string;
  rfcExample: { namespace: string; name: string; expected: string };
  cases: IdCase[];
};

describe('deterministic ids', () => {
  it('is RFC 9562 UUIDv5', () => {
    const { namespace, name, expected } = vectors.rfcExample;
    expect(uuidv5(name, namespace)).toBe(expected);
  });

  it('uses the frozen namespace', () => {
    expect(ID_NAMESPACE).toBe(vectors.namespace);
  });

  it.each(vectors.cases)('derives $kind $expected', (c) => {
    const id =
      c.kind === 'task_tag'
        ? taskTagId(c.taskId, c.tagId)
        : taskOccurrenceId(c.taskId, c.occurrence);
    expect(id).toBe(c.expected);
  });

  it('lower-cases ids before hashing', () => {
    const c = vectors.cases[0] as Extract<IdCase, { kind: 'task_occurrence' }>;
    expect(taskOccurrenceId(c.taskId.toUpperCase(), c.occurrence)).toBe(
      c.expected,
    );
  });

  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
  const enc = (s: string) => new TextEncoder().encode(s);

  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
    ['a'.repeat(1_000_000), '34aa973cd4c4daa4f61eeb2bdbad27316534016f'],
  ])('sha1 matches FIPS 180 for a %#th input', (input, digest) => {
    expect(hex(sha1(enc(input)))).toBe(digest);
  });

  it.each([
    '',
    'задача:2026-10-02',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'я'.repeat(100),
    'long name '.repeat(30),
  ])('derives the same id as node:crypto for %j', (name) => {
    const h = createHash('sha1')
      .update(Buffer.from(ID_NAMESPACE.replaceAll('-', ''), 'hex'))
      .update(name, 'utf8')
      .digest();
    h[6] = (h[6]! & 0x0f) | 0x50;
    h[8] = (h[8]! & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString('hex');
    const want = `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
    expect(uuidv5(name)).toBe(want);
  });

  it('ids.ts is portable: no node: import, no Buffer', () => {
    const src = readFileSync(new URL('./ids.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/node:/);
    expect(src).not.toMatch(/Buffer/);
  });
});
