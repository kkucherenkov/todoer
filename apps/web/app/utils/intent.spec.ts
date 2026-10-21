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
  it('resends the same write after a refusal', async () => {
    const db = fakeDb([refused]);
    const send = createIntent(db);
    expect(await send(edit('a'))).toEqual(refused);
    expect(await send(edit('a'))).toEqual({ ok: true });
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-1']);
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
