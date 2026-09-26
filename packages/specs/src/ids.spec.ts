import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ID_NAMESPACE, taskOccurrenceId, taskTagId, uuidv5 } from './ids';

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
});
