import { afterEach, describe, expect, it } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import { RefusalError, UsageError } from './protocol.js';
import { run, type Deps } from './run.js';
import { Store } from './store.js';
import type { Transport } from './sync.js';

const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function deps(send: Transport): Deps {
  const store = Store.open(':memory:');
  stores.push(store);
  let n = 0;
  return {
    store,
    send,
    now: () => new Date('2026-09-26T10:00:00.000Z'),
    newId: () => `id-${++n}`,
  };
}

const unreachable: Transport = () =>
  Promise.reject(new TypeError('fetch failed'));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Just enough of the server: creates rows, reports duplicates, pulls. */
function fakeServer() {
  let seq = 0;
  const rows = new Map<string, Change>();
  const requests: SyncRequest[] = [];
  const send: Transport = (request) => {
    requests.push(structuredClone(request));
    const results = request.ops.map((op) => {
      if (op.kind === 'create' && !rows.has(op.id)) {
        rows.set(op.id, {
          table: op.table,
          id: op.id,
          seq: ++seq,
          row: { ...op.fields, id: op.id, deletedAt: null },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      return { opId: op.opId, status: 'duplicate' as const };
    });
    const changes = [...rows.values()].filter((c) => c.seq > request.since);
    const cursor = Math.max(request.since, ...changes.map((c) => c.seq));
    return Promise.resolve(json({ cursor, results, changes }));
  };
  return { send, requests };
}

function envelope(stdout: string[]): unknown {
  expect(stdout).toHaveLength(1);
  return JSON.parse(stdout[0] ?? '');
}

const task = {
  title: 'call the bank',
  priority: 2,
  rank: 'a0',
  id: 'id-2',
  deletedAt: null,
};

describe('run', () => {
  it('adds a task online and says the server has it', async () => {
    const d = deps(fakeServer().send);
    const out = await run(['add', 'call the bank p2', '--json'], d);
    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toEqual({
      data: task,
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
    expect(out.stderr).toEqual([]);
  });

  // Scenario 1: queued, exit 5, the task is shown from the overlay.
  it('queues an add without a server and exits 5', async () => {
    const d = deps(unreachable);
    const out = await run(['add', 'call the bank p2', '--json'], d);
    expect(out.exit).toBe(5);
    expect(envelope(out.stdout)).toEqual({
      data: task,
      synced: false,
      outbox: { pending: 1, failed: 0 },
    });
    expect(out.stderr.join('\n')).toMatch(/not reached/);
  });

  // Scenario 2 and FR-003: a later command delivers it with its original id.
  it('delivers a queued add on the next command, with the id it was queued with', async () => {
    const d = deps(unreachable);
    await run(['add', 'call the bank'], d);
    const server = fakeServer();
    d.send = server.send;

    const out = await run(['list', '--json'], d);

    expect(server.requests[0]?.ops.map((op: Op) => op.opId)).toEqual(['id-1']);
    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toMatchObject({
      data: [{ id: 'id-2', title: 'call the bank' }],
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
  });

  // Review Focus 4.
  it('lists a queued task without a server', async () => {
    const d = deps(unreachable);
    await run(['add', 'offline task p1'], d);
    const out = await run(['list'], d);
    expect(out.exit).toBe(5);
    expect(out.stdout).toEqual(['1  offline task']);
  });

  it('prints plain text without --json', async () => {
    const d = deps(fakeServer().send);
    expect((await run(['add', 'call the bank p2'], d)).stdout).toEqual([
      'call the bank',
    ]);
    expect((await run(['list'], d)).stdout).toEqual(['2  call the bank']);
  });

  // M4: planAdd's notice about a dropped marker is not part of the answer.
  it("puts planAdd's notice about a dropped marker on stderr, never stdout", async () => {
    const d = deps(fakeServer().send);
    const out = await run(['add', 'buy milk #groceries'], d);
    expect(out.stderr.join('\n')).toMatch(/#groceries/);
    expect(out.stdout.join('\n')).not.toMatch(/#groceries/);
  });

  it("reports the command's own rejected add by throwing, and does not keep it", async () => {
    const d = deps((request) =>
      Promise.resolve(
        json({
          cursor: 0,
          results: request.ops.map((op) => ({
            opId: op.opId,
            status: 'rejected',
            reason: 'nope',
          })),
          changes: [],
        }),
      ),
    );
    await expect(run(['add', 'x'], d)).rejects.toThrow(RefusalError);
    expect(d.store.entries()).toEqual([]);
  });

  // I1: the own op's batch is refused outright (413) — settle removes it
  // from the outbox as `own` — and the follow-up pull cannot reach the
  // server either. `flushed.synced` is false, but the rejection must still
  // surface: reporting exit 5 ("queued, a later command will send it")
  // would be a lie once the op is gone.
  it("throws when the own op's batch is refused and the follow-up pull cannot reach the server", async () => {
    let calls = 0;
    const d = deps(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(new Response('too many', { status: 413 }));
      }
      return Promise.reject(new TypeError('fetch failed'));
    });
    await expect(run(['add', 'x'], d)).rejects.toThrow(RefusalError);
    expect(d.store.entries()).toEqual([]);
  });

  // I2 and ruling 5: the server was reached and reported nothing at all
  // about the own op — not rejected, not applied — which is neither a
  // refusal (nothing to throw) nor a success (nothing confirmed). The
  // command must still say so is queued and unsynced, not synced.
  it('does not call an add synced when the server never mentions its operation', async () => {
    const d = deps(() =>
      Promise.resolve(json({ cursor: 0, results: [], changes: [] })),
    );
    const out = await run(['add', 'x', '--json'], d);
    expect(out.exit).toBe(5);
    expect(envelope(out.stdout)).toMatchObject({
      synced: false,
      outbox: { pending: 1, failed: 0 },
    });
  });

  // Scenario 4 and FR-006.
  it('keeps an earlier operation the server refuses as failed, without failing the list', async () => {
    const d = deps((request) =>
      Promise.resolve(
        json({
          cursor: 0,
          results: request.ops.map((op) => ({
            opId: op.opId,
            status: 'rejected',
            reason: 'nope',
          })),
          changes: [],
        }),
      ),
    );
    d.store.enqueue({
      opId: 'earlier',
      kind: 'create',
      table: 'task',
      id: 'task-earlier',
      fields: { title: 'earlier', rank: 'a0' },
      ts: '2026-09-26T09:00:00.000Z',
    });

    const out = await run(['list', '--json'], d);

    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toMatchObject({
      synced: true,
      outbox: { pending: 0, failed: 1 },
    });
    expect(out.stderr.join('\n')).toMatch(/1 queued operation\(s\) failed/);
  });

  // Review Focus 3.
  it('keeps the add queued when the token is refused', async () => {
    const d = deps(() => Promise.resolve(json({ title: 'Unauthorized' }, 401)));
    const refused = run(['add', 'x'], d);
    await expect(refused).rejects.toThrow(RefusalError);
    // A caller told only "refused" retries the add and queues it twice.
    await expect(refused).rejects.toThrow(
      /operation id-1 is queued .* do not run add again/,
    );
    expect(d.store.entries().map((e) => e.status)).toEqual(['pending']);
  });

  // Minor 4: a parallel invocation can settle this command's op between its
  // enqueue and its flush, so the response never mentions it.
  it('calls an add synced when a parallel command already delivered its operation', async () => {
    const d: Deps = deps((request) => {
      if (request.ops.length > 0) throw new Error('op should be gone');
      return Promise.resolve(json({ cursor: 0, results: [], changes: [] }));
    });
    d.store.enqueue = (op) => {
      Store.prototype.enqueue.call(d.store, op);
      d.store.settle([{ opId: op.opId, status: 'applied' }], new Set());
    };
    const out = await run(['add', 'x', '--json'], d);
    expect(out.exit).toBe(0);
    expect(envelope(out.stdout)).toMatchObject({
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
  });

  it('throws when a parallel command already saw its operation refused', async () => {
    const d: Deps = deps(() =>
      Promise.resolve(json({ cursor: 0, results: [], changes: [] })),
    );
    d.store.enqueue = (op) => {
      Store.prototype.enqueue.call(d.store, op);
      d.store.settle(
        [{ opId: op.opId, status: 'rejected', reason: 'nope' }],
        new Set(),
      );
    };
    await expect(run(['add', 'x'], d)).rejects.toThrow('nope');
    expect(d.store.entries()).toEqual([]);
  });

  it('lists the outbox', async () => {
    const d = deps(unreachable);
    await run(['add', 'x'], d);
    const out = await run(['outbox', '--json'], d);
    expect(out.exit).toBe(5);
    expect(envelope(out.stdout)).toMatchObject({
      data: [{ opId: 'id-1', status: 'pending', reason: null }],
      outbox: { pending: 1, failed: 0 },
    });
  });

  it('drops a failed operation, and refuses a pending one', async () => {
    const d = deps((request) =>
      Promise.resolve(
        json({
          cursor: 0,
          results: request.ops
            .filter((op) => op.opId === 'bad')
            .map((op) => ({ opId: op.opId, status: 'rejected', reason: 'no' })),
          changes: [],
        }),
      ),
    );
    for (const opId of ['bad', 'waiting']) {
      d.store.enqueue({
        opId,
        kind: 'create',
        table: 'task',
        id: `task-${opId}`,
        fields: { title: opId, rank: 'a0' },
        ts: '2026-09-26T09:00:00.000Z',
      });
    }

    await expect(run(['outbox', 'drop', 'waiting'], d)).rejects.toThrow(
      UsageError,
    );
    const out = await run(['outbox', 'drop', 'bad', '--json'], d);

    expect(envelope(out.stdout)).toMatchObject({ data: ['bad'] });
    expect(d.store.entries().map((e) => e.opId)).toEqual(['waiting']);
  });

  it('refuses a drop with no ids, an unknown outbox subcommand and an unknown command', async () => {
    const d = deps(fakeServer().send);
    await expect(run(['outbox', 'drop'], d)).rejects.toThrow(UsageError);
    await expect(run(['outbox', 'frob'], d)).rejects.toThrow(UsageError);
    await expect(run(['frob'], d)).rejects.toThrow(UsageError);
    await expect(run([], d)).rejects.toThrow(UsageError);
  });
});
