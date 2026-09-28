import { afterEach, describe, expect, it } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import { taskOccurrenceId } from '@todoer/specs';
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

/** Like deps, with ids shaped like UUIDs so a suffix can name them:
 *  the first task is …000000000002 (op ids take the odd numbers). */
function hexDeps(send: Transport): Deps {
  const d = deps(send);
  let n = 0;
  d.newId = () => `0192a1b2-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  return d;
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
      const existing = rows.get(op.id);
      if (op.kind === 'create' && existing === undefined) {
        rows.set(op.id, {
          table: op.table,
          id: op.id,
          seq: ++seq,
          row: { ...op.fields, id: op.id, deletedAt: null },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      if (
        op.kind === 'create' &&
        op.table === 'task_occurrence' &&
        existing !== undefined
      ) {
        rows.set(op.id, {
          ...existing,
          seq: ++seq,
          row: { ...existing.row, ...op.fields },
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
    expect(out.stdout).toEqual(['id-2  1  offline task']);
  });

  it('prints plain text without --json', async () => {
    const d = deps(fakeServer().send);
    expect((await run(['add', 'call the bank p2'], d)).stdout).toEqual([
      'call the bank',
    ]);
    expect((await run(['list'], d)).stdout).toEqual(['id-2  2  call the bank']);
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

  describe('add --rrule', () => {
    function queuedFields(d: Deps): Record<string, unknown> {
      const [op] = d.store.pending();
      if (op?.kind !== 'create') throw new Error('expected a queued create');
      return op.fields;
    }

    it('queues the rule with --from as dtstart', async () => {
      const d = deps(unreachable);
      await run(
        [
          'add',
          'stand-up',
          '--rrule',
          'FREQ=WEEKLY;BYDAY=MO',
          '--from',
          '2026-09-28',
        ],
        d,
      );
      expect(queuedFields(d)).toMatchObject({
        title: 'stand-up',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        dtstart: '2026-09-28',
      });
    });

    it('anchors the rule today when --from is absent', async () => {
      const d = deps(unreachable);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      expect(queuedFields(d)).toMatchObject({ dtstart: '2026-09-26' });
    });

    // Review Focus 4.
    it('keeps an option-looking word inside a quoted title', async () => {
      const d = deps(unreachable);
      await run(['add', 'fix --rrule parsing'], d);
      expect(queuedFields(d)).toMatchObject({ title: 'fix --rrule parsing' });
      expect(queuedFields(d)).not.toHaveProperty('rrule');
    });

    it.each([
      [['--rrule', 'FREQ=DAILY;BYHOUR=9'], /--rrule: BYHOUR is not supported/],
      [
        ['--rrule', 'FREQ=DAILY', '--from', '2026-02-30'],
        /--from must be a date/,
      ],
      [['--from', '2026-09-28'], /--from needs --rrule/],
      [['--rrule'], /--rrule needs a value/],
      [
        ['--rrule', 'FREQ=DAILY', '--rrule', 'FREQ=WEEKLY'],
        /--rrule given twice/,
      ],
      [
        [
          '--rrule',
          'FREQ=DAILY',
          '--from',
          '2026-09-28',
          '--from',
          '2026-09-29',
        ],
        /--from given twice/,
      ],
    ])('refuses %j and queues nothing', async (flags, reason) => {
      const d = deps(unreachable);
      const attempt = run(['add', 'x', ...flags], d);
      await expect(attempt).rejects.toThrow(UsageError);
      await expect(run(['add', 'x', ...flags], d)).rejects.toThrow(reason);
      expect(d.store.pending()).toEqual([]);
    });
  });

  describe('recurrence and marks', () => {
    const TASK = '0192a1b2-0000-7000-8000-000000000002';

    async function lines(d: Deps): Promise<string[]> {
      return (await run(['list'], d)).stdout;
    }

    // Scenario 1.
    it('lists a recurring task at today with its reference', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      expect(await lines(d)).toEqual([
        '000002  0  water the plants  2026-09-26',
      ]);
    });

    // Scenario 2 and Review Focus 1.
    it('moves on after done, and undo reopens the same day', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);

      const done = await run(['done', '0002', '--json'], d);
      expect(done.exit).toBe(0);
      expect(envelope(done.stdout)).toMatchObject({
        data: {
          taskId: TASK,
          occurrence: '2026-09-26',
          state: 'done',
          completedAt: '2026-09-26T10:00:00.000Z',
        },
      });
      expect(await lines(d)).toEqual([
        '000002  0  water the plants  2026-09-27',
      ]);

      const undo = await run(['undo', '0002', '--json'], d);
      expect(envelope(undo.stdout)).toMatchObject({
        data: { state: 'open', completedAt: null },
      });
      expect(await lines(d)).toEqual([
        '000002  0  water the plants  2026-09-26',
      ]);
    });

    it('queues a create of the derived task occurrence', async () => {
      const d = hexDeps(unreachable);
      await run(['add', 'x', '--rrule', 'FREQ=DAILY'], d);
      await run(['skip', '0002'], d);
      expect(d.store.pending().at(-1)).toMatchObject({
        kind: 'create',
        table: 'task_occurrence',
        id: taskOccurrenceId(TASK, '2026-09-26'),
        fields: {
          taskId: TASK,
          occurrence: '2026-09-26',
          state: 'skipped',
          completedAt: null,
        },
      });
    });

    // Scenario 3.
    it('hides a one-off task once done and shows it again after undo', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'file taxes'], d);
      await run(['done', '000002'], d);
      expect(await lines(d)).toEqual([]);
      await run(['undo', '000002'], d);
      expect(await lines(d)).toEqual(['000002  0  file taxes']);
    });

    // Scenario 4 and Review Focus 2.
    it('marks offline, exits 5, and list already shows it', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      d.send = unreachable;
      expect((await run(['done', '0002'], d)).exit).toBe(5);
      expect(await lines(d)).toEqual([
        '000002  0  water the plants  2026-09-27',
      ]);
      await run(['undo', '0002'], d);
      expect(await lines(d)).toEqual([
        '000002  0  water the plants  2026-09-26',
      ]);
    });

    // Scenario 5 and Review Focus 3.
    it('lists a daily task missed for days once, at today', async () => {
      const d = hexDeps(fakeServer().send);
      await run(
        ['add', 'stretch', '--rrule', 'FREQ=DAILY', '--from', '2026-09-20'],
        d,
      );
      expect(await lines(d)).toEqual(['000002  0  stretch  2026-09-26']);
    });

    it('marks a named occurrence with --on', async () => {
      const d = hexDeps(fakeServer().send);
      await run(
        [
          'add',
          'stand-up',
          '--rrule',
          'FREQ=WEEKLY;BYDAY=MO',
          '--from',
          '2026-09-28',
        ],
        d,
      );
      await run(['done', '0002', '--on', '2026-10-05'], d);
      expect(await lines(d)).toEqual(['000002  0  stand-up  2026-09-28']);
      await run(['done', '0002'], d);
      expect(await lines(d)).toEqual(['000002  0  stand-up  2026-10-12']);
    });

    // Review Focus 5.
    it('refuses done without --on once the rule has run out', async () => {
      const d = hexDeps(fakeServer().send);
      await run(
        [
          'add',
          'twice',
          '--rrule',
          'FREQ=DAILY;COUNT=1',
          '--from',
          '2026-09-20',
        ],
        d,
      );
      await run(['done', '0002'], d);
      expect(await lines(d)).toEqual([]);
      await expect(run(['done', '0002'], d)).rejects.toThrow(
        /no open occurrence left/,
      );
    });

    it.each([
      [
        ['done', '0002', '--on', '2026-09-27'],
        /2026-09-27 is not an occurrence/,
      ],
      [['done', '0002', '--on', 'soon'], /--on must be a date/],
      [['done'], /needs exactly one task id/],
      [['done', '0002', '0002'], /needs exactly one task id/],
      [['done', 'ffff'], /no task matches ffff/],
    ])('refuses %j with exit 2 and queues nothing', async (argv, reason) => {
      const d = hexDeps(unreachable);
      await run(
        [
          'add',
          'weekly',
          '--rrule',
          'FREQ=WEEKLY;BYDAY=MO',
          '--from',
          '2026-09-28',
        ],
        d,
      );
      const before = d.store.pending().length;
      await expect(run(argv, d)).rejects.toThrow(UsageError);
      await expect(run(argv, d)).rejects.toThrow(reason);
      expect(d.store.pending()).toHaveLength(before);
    });

    it('refuses --on for a one-off task, and undo with nothing to undo', async () => {
      const d = hexDeps(unreachable);
      await run(['add', 'once'], d);
      await expect(
        run(['done', '0002', '--on', '2026-09-26'], d),
      ).rejects.toThrow(/--on is only for recurring tasks/);
      const before = d.store.pending().length;
      await expect(run(['undo', '0002'], d)).rejects.toThrow(/nothing to undo/);
      expect(d.store.pending()).toHaveLength(before);
      await run(['add', 'daily', '--rrule', 'FREQ=DAILY'], d);
      await expect(run(['undo', '0004'], d)).rejects.toThrow(/nothing to undo/);
    });

    // FR-009: a task occurrence whose task this replica does not hold.
    it('ignores a task occurrence whose task is absent', async () => {
      const d = hexDeps(fakeServer().send);
      d.store.mergeChanges([
        {
          table: 'task_occurrence',
          id: 'orphan',
          seq: 1,
          row: {
            id: 'orphan',
            taskId: 'gone',
            occurrence: null,
            state: 'done',
            deletedAt: null,
          },
        },
      ]);
      await run(['add', 'file taxes'], d);
      expect(await lines(d)).toEqual(['000002  0  file taxes']);
    });

    // FR-010, ADR 0009: a subtask lives on its parent's occurrence axis.
    it("lists a subtask at its parent's occurrence and marks it there", async () => {
      const d = hexDeps(unreachable);
      d.store.mergeChanges([
        {
          table: 'task',
          id: 'parent-0000-00aaaa',
          seq: 1,
          row: {
            id: 'parent-0000-00aaaa',
            title: 'clean the kitchen',
            priority: 0,
            rrule: 'FREQ=WEEKLY;BYDAY=MO',
            dtstart: '2026-09-21',
            parentId: null,
            deletedAt: null,
          },
        },
        {
          table: 'task',
          id: 'child-00000-00bbbb',
          seq: 2,
          row: {
            id: 'child-00000-00bbbb',
            title: 'dishes',
            priority: 0,
            rrule: null,
            dtstart: null,
            parentId: 'parent-0000-00aaaa',
            deletedAt: null,
          },
        },
      ]);
      expect(await lines(d)).toEqual([
        '00aaaa  0  clean the kitchen  2026-09-21',
        '00bbbb  0  dishes  2026-09-21',
      ]);
      await run(['done', 'bbbb'], d);
      expect(d.store.pending().at(-1)).toMatchObject({
        id: taskOccurrenceId('child-00000-00bbbb', '2026-09-21'),
        fields: { taskId: 'child-00000-00bbbb', occurrence: '2026-09-21' },
      });
    });
  });
});
