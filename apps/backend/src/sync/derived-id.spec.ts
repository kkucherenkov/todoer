import { describe, expect, it } from 'vitest';
import { taskOccurrenceId, taskTagId } from '@todoer/specs';
import { derivedIdRejection, isDerivedIdTable } from './derived-id.js';

const TASK = '0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const TAG = '0192a1b2-c3d4-7e5f-8a9b-ffffffffffff';
const TS = '2026-09-28T08:00:00.000Z';

function create(table: string, id: string, fields: Record<string, unknown>) {
  return { opId: TASK, kind: 'create' as const, table, id, fields, ts: TS };
}

describe('derived ids', () => {
  it('names exactly the two toggle tables', () => {
    expect(['task_occurrence', 'task_tag'].every(isDerivedIdTable)).toBe(true);
    expect(['task', 'project', 'tag'].some(isDerivedIdTable)).toBe(false);
  });

  it('accepts a create whose id is derived from its fields', () => {
    const id = taskOccurrenceId(TASK, '2026-09-28');
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', id, {
          taskId: TASK,
          occurrence: '2026-09-28',
        }),
      ),
    ).toBeNull();
    expect(
      derivedIdRejection(
        'task_tag',
        create('task_tag', taskTagId(TASK, TAG), { taskId: TASK, tagId: TAG }),
      ),
    ).toBeNull();
  });

  it('treats a missing occurrence as null', () => {
    const id = taskOccurrenceId(TASK, null);
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', id, { taskId: TASK }),
      ),
    ).toBeNull();
  });

  it('accepts an upper-case taskId whose id came from the lower-case form', () => {
    const id = taskOccurrenceId(TASK, '2026-09-28');
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', id.toUpperCase(), {
          taskId: TASK.toUpperCase(),
          occurrence: '2026-09-28',
        }),
      ),
    ).toBeNull();
  });

  it('rejects a create whose id is not the derivation', () => {
    expect(
      derivedIdRejection(
        'task_occurrence',
        create('task_occurrence', TAG, {
          taskId: TASK,
          occurrence: '2026-09-28',
        }),
      ),
    ).toBe('id does not match the id derived from taskId, occurrence');
  });

  it('rejects a create without the key fields it is derived from', () => {
    expect(
      derivedIdRejection('task_tag', create('task_tag', TAG, { taskId: TASK })),
    ).toBe('id does not match the id derived from taskId, tagId');
  });

  it('refuses to change an identity field', () => {
    const op = {
      opId: TASK,
      kind: 'set' as const,
      table: 'task_occurrence',
      id: TAG,
      field: 'occurrence',
      value: '2026-09-29',
      ts: TS,
    };
    expect(derivedIdRejection('task_occurrence', op)).toBe(
      'occurrence is part of this row’s identity and cannot change',
    );
    expect(
      derivedIdRejection('task_occurrence', {
        ...op,
        field: 'taskId',
        value: TASK,
      }),
    ).toBe('taskId is part of this row’s identity and cannot change');
    expect(
      derivedIdRejection('task_tag', {
        ...op,
        table: 'task_tag',
        field: 'tagId',
        value: TAG,
      }),
    ).toBe('tagId is part of this row’s identity and cannot change');
  });

  it('refuses delete and names the toggle to use instead', () => {
    const op = {
      opId: TASK,
      kind: 'delete' as const,
      table: 'task_tag',
      id: TAG,
      baseVersion: 1,
    };
    expect(derivedIdRejection('task_tag', op)).toBe(
      'rows of task_tag are never deleted; set attached instead',
    );
    expect(
      derivedIdRejection('task_occurrence', {
        ...op,
        table: 'task_occurrence',
      }),
    ).toBe('rows of task_occurrence are never deleted; set state instead');
  });

  it('has nothing to say about other tables', () => {
    expect(
      derivedIdRejection('task', create('task', TAG, { title: 'x' })),
    ).toBeNull();
  });
});
