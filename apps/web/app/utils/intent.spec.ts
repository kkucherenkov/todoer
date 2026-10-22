import { describe, expect, it } from 'vitest';
import type { Result, Write } from '@todoer/client-core';
import type { Draft } from '../db/client';
import { createIntent } from './intent';

const refused: Result = {
  ok: false,
  failure: { kind: 'invalid', detail: 'no' },
};

function fakeDb(results: Result[]) {
  let n = 0;
  const sent: Write[] = [];
  return {
    sent,
    mint: (draft: Draft) => ({ ...draft, opId: `op-${++n}` }) as Write,
    write: (write: Write): Promise<Result> => {
      sent.push(write);
      return Promise.resolve(results.shift() ?? { ok: true });
    },
  };
}

const edit = (title: string): Draft => ({
  kind: 'edit',
  taskId: 't',
  changes: { title },
});

describe('held intent', () => {
  const refusal = (retryable: boolean): Result => ({
    ok: false,
    failure: { kind: 'refused', detail: 'no', retryable },
  });

  it('Retry change resends a retryable refusal as the same write', async () => {
    const db = fakeDb([refusal(true)]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('a'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-1']);
  });

  it('Save again after a refusal for good is a new write', async () => {
    const db = fakeDb([refusal(false)]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('a'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-2']);
  });

  it('resends the same write after a refusal', async () => {
    const db = fakeDb([refused]);
    const send = createIntent(db);
    expect(await send(edit('a'))).toMatchObject(refused);
    expect(await send(edit('a'))).toMatchObject({ ok: true });
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-1']);
  });

  it('hands back the write it sent, the retry the held one', async () => {
    const db = fakeDb([refused]);
    const send = createIntent(db);
    const first = await send(edit('a'));
    const retry = await send(edit('a'));
    expect(first.write).toBe(db.sent[0]);
    expect(retry.write).toBe(first.write);
  });

  it('mints a new write for a new draft', async () => {
    const db = fakeDb([refused]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('b'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-2']);
  });

  it('forgets an accepted write: the same draft again is a new one', async () => {
    const db = fakeDb([]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('a'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-2']);
  });
});
