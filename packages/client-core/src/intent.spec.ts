import { describe, expect, it } from 'vitest';
import type { Result, Write } from './engine-protocol.js';
import { createIntent, mint, type Draft } from './intent.js';

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
  const forGood: Result = {
    ok: false,
    failure: { kind: 'refused', detail: 'no', retryable: false },
  };
  const forNow: Result = {
    ok: false,
    failure: { kind: 'refused', detail: 'no', retryable: true },
  };

  it('drops the write a permanent refusal answered: the same draft is new', async () => {
    const db = fakeDb([forGood]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('a'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-2']);
  });

  it('keeps the write a retryable refusal answered', async () => {
    const db = fakeDb([forNow]);
    const send = createIntent(db);
    await send(edit('a'));
    await send(edit('a'));
    expect(db.sent.map((w) => w.opId)).toEqual(['op-1', 'op-1']);
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

describe('mint', () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  const creates: Draft[] = [
    { kind: 'add', text: 't' },
    {
      kind: 'saveView',
      fields: { name: 'v', layout: 'list', sort: 'manual', filter: null },
    },
    { kind: 'saveStatus', name: 's' },
    { kind: 'moveOccurrence', taskId: 't', occurrence: 'o', to: 'd' },
  ];
  it.each(creates)('gives $kind an id different from its opId', (draft) => {
    const w = mint(draft, newId);
    expect(w).toHaveProperty('id');
    expect(w).toHaveProperty('opId');
    expect((w as { id: string }).id).not.toBe(w.opId);
  });

  it('keeps the id a create names', () => {
    expect(mint({ kind: 'add', text: 't', id: 'mine' }, newId)).toMatchObject({
      id: 'mine',
    });
  });

  it('gives an edit an opId only', () => {
    const w = mint(edit('a'), newId);
    expect(w).toHaveProperty('opId');
    expect(w).not.toHaveProperty('id');
  });
});
