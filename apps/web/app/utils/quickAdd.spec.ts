import { describe, expect, it, vi } from 'vitest';
import type { Result, Write } from '@todoer/client-core';
import {
  createQuickAddSubmitter,
  planQuickAdd,
  type QuickAddDraft,
} from './quickAdd';

const blank = (): QuickAddDraft => ({
  text: '',
  project: null,
  tags: '',
  priority: null,
  scheduledOn: '',
  dueOn: '',
});

describe('planQuickAdd', () => {
  it('keeps the core grammar and applies progressively revealed overrides', () => {
    expect(
      planQuickAdd({
        ...blank(),
        text: 'Buy milk #home @errand p2',
        project: 'Work errands',
        tags: '@errand calls',
        priority: 0,
        scheduledOn: '2026-10-22',
        dueOn: '2026-10-24',
      }),
    ).toEqual({
      addText: 'Buy milk #home @errand p2',
      changes: {
        project: 'Work errands',
        tags: ['@errand', '@calls'],
        priority: 0,
        scheduledOn: '2026-10-22',
        dueOn: '2026-10-24',
      },
    });
  });

  it('adds field tags to the title tags instead of replacing them', () => {
    expect(
      planQuickAdd({ ...blank(), text: 'Call mom @home', tags: 'calls' })
        .changes,
    ).toEqual({ tags: ['@home', '@calls'] });
  });

  it('refuses a field tag that core would not read as a tag', () => {
    expect(() =>
      planQuickAdd({ ...blank(), text: 'Call mom', tags: '@ok a.b' }),
    ).toThrow('"@a.b" is not a tag');
  });

  it('leaves a title-only or grammar-only add as one core write', () => {
    expect(planQuickAdd({ ...blank(), text: 'Call a@b.c #home p1' })).toEqual({
      addText: 'Call a@b.c #home p1',
      changes: null,
    });
  });
});

describe('createQuickAddSubmitter', () => {
  const failure: Result = {
    ok: false,
    failure: { kind: 'refused', detail: 'no' },
  };
  const success: Result = { ok: true };

  function database(results: Result[]) {
    let n = 0;
    const mint = vi.fn(
      (draft: Omit<Write, 'opId' | 'id'> & { id?: string }) => {
        n += 1;
        return {
          ...draft,
          ...(draft.kind === 'add' ? { id: `task-${n}` } : {}),
          opId: `op-${n}`,
        } as Write;
      },
    );
    const write = vi.fn((_write: Write) =>
      Promise.resolve(results.shift() ?? success),
    );
    return { mint, write };
  }

  it('retries a refused add with the same task id and opId', async () => {
    const db = database([failure, success]);
    const submit = createQuickAddSubmitter(db);
    const draft = { ...blank(), text: 'Keep this draft' };

    expect((await submit(draft)).result).toEqual(failure);
    expect((await submit(draft)).result).toEqual(success);

    expect(db.mint).toHaveBeenCalledTimes(1);
    expect(db.write).toHaveBeenCalledTimes(2);
    expect(db.write.mock.calls[1]![0]).toBe(db.write.mock.calls[0]![0]);
  });

  it('does not add twice when the structured edit is refused', async () => {
    const db = database([success, failure, success]);
    const submit = createQuickAddSubmitter(db);
    const draft = {
      ...blank(),
      text: 'Dated task',
      dueOn: '2026-10-24',
    };

    expect((await submit(draft)).result).toEqual(failure);
    const accepted = await submit(draft);
    expect(accepted).toEqual({
      result: success,
      taskId: 'task-1',
      created: true,
    });

    expect(db.write.mock.calls.map(([write]) => write.kind)).toEqual([
      'add',
      'edit',
      'edit',
    ]);
    expect(db.write.mock.calls[2]![0]).toBe(db.write.mock.calls[1]![0]);
  });

  it('keeps the accepted add when a field changes after a refused edit', async () => {
    const db = database([success, failure, success]);
    const submit = createQuickAddSubmitter(db);
    const draft = { ...blank(), text: 'Dated task', dueOn: '2026-10-24' };

    expect(await submit(draft)).toEqual({
      result: failure,
      taskId: 'task-1',
      created: true,
    });
    expect(await submit({ ...draft, dueOn: '2026-10-25' })).toEqual({
      result: success,
      taskId: 'task-1',
      created: true,
    });

    const writes = db.write.mock.calls.map(([write]) => write);
    expect(writes.map((write) => write.kind)).toEqual(['add', 'edit', 'edit']);
    expect(writes[2]).toMatchObject({
      taskId: 'task-1',
      changes: { dueOn: '2026-10-25' },
    });
    expect(writes[2]!.opId).not.toBe(writes[1]!.opId);
  });

  it('creates a second task for a second identical add after success', async () => {
    const db = database([success, success]);
    const submit = createQuickAddSubmitter(db);
    const draft = { ...blank(), text: 'Same twice' };

    expect((await submit(draft)).taskId).toBe('task-1');
    expect((await submit(draft)).taskId).toBe('task-2');
    expect(db.write.mock.calls.map(([write]) => write.opId)).toEqual([
      'op-1',
      'op-2',
    ]);
  });

  it('refuses an invalid field tag without writing', async () => {
    const db = database([]);
    const submit = createQuickAddSubmitter(db);

    expect(
      (await submit({ ...blank(), text: 'Call mom', tags: 'a.b' })).result,
    ).toEqual({
      ok: false,
      failure: { kind: 'invalid', detail: '"@a.b" is not a tag' },
    });
    expect(db.write).not.toHaveBeenCalled();
  });
});
