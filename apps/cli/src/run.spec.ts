import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import { taskOccurrenceId, taskTagId } from '@todoer/specs';
import { tokenSource, type AuthApi } from './auth.js';
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
  const now = () => new Date('2026-09-26T10:00:00.000Z');
  const auth = fakeAuth().api;
  return {
    store,
    send,
    now,
    newId: () => `id-${++n}`,
    auth,
    tokens: tokenSource(store, auth, '', now),
    envToken: false,
    readPassword: () => Promise.resolve('secret'),
  };
}

/** Swaps the auth API, and the token source built on it. */
function useAuth(d: Deps, api: AuthApi): void {
  d.auth = api;
  d.tokens = tokenSource(d.store, api, '', d.now);
}

const SESSION = {
  accessToken: 'acc',
  accessExpiresAt: '2026-09-26T10:15:00.000Z',
  refreshToken: 'ref',
};

function fakeAuth(overrides: Partial<AuthApi> = {}) {
  const calls: { login: string[][]; logout: unknown[] } = {
    login: [],
    logout: [],
  };
  const api: AuthApi = {
    login: (email, password) => {
      calls.login.push([email, password]);
      return Promise.resolve(SESSION);
    },
    refresh: () => Promise.reject(new Error('unused')),
    logout: (access, body) => {
      calls.logout.push([access, body]);
      return Promise.resolve(undefined);
    },
    ...overrides,
  };
  return { api, calls };
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
  const rows = new Map<string, Change>();
  // Above every row, including ones a test seeded with its own seq.
  const nextSeq = () =>
    Math.max(0, ...[...rows.values()].map((c) => c.seq)) + 1;
  const requests: SyncRequest[] = [];
  const send: Transport = (request) => {
    requests.push(structuredClone(request));
    const results = request.ops.map((op) => {
      const existing = rows.get(op.id);
      if (op.kind === 'create' && existing === undefined) {
        rows.set(op.id, {
          table: op.table,
          id: op.id,
          seq: nextSeq(),
          row: { ...op.fields, id: op.id, deletedAt: null, version: 1 },
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
          seq: nextSeq(),
          row: {
            ...existing.row,
            ...op.fields,
            version: Number(existing.row.version ?? 1) + 1,
          },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      if (op.kind === 'set' && existing !== undefined) {
        const version = Number(existing.row.version ?? 1) + 1;
        rows.set(op.id, {
          ...existing,
          seq: nextSeq(),
          row: { ...existing.row, [op.field]: op.value, version },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      if (op.kind === 'delete' && existing !== undefined) {
        const version = Number(existing.row.version ?? 1) + 1;
        rows.set(op.id, {
          ...existing,
          seq: nextSeq(),
          row: {
            ...existing.row,
            deletedAt: '2026-09-26T10:00:00.000Z',
            version,
          },
        });
        return { opId: op.opId, status: 'applied' as const };
      }
      return { opId: op.opId, status: 'duplicate' as const };
    });
    const changes = [...rows.values()].filter((c) => c.seq > request.since);
    const cursor = Math.max(request.since, ...changes.map((c) => c.seq));
    return Promise.resolve(json({ cursor, results, changes }));
  };
  return { send, requests, rows };
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
      data: { ...task, version: 1 },
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

  describe('quick-add markers', () => {
    // Scenario 1.
    it('queues the tag, the project, the task and its TaskTag, in order', async () => {
      const d = deps(unreachable);
      const out = await run(['add', 'call the bank @phone #finance'], d);

      expect(d.store.pending().map((op) => `${op.kind} ${op.table}`)).toEqual([
        'create project',
        'create tag',
        'create task',
        'create task_tag',
      ]);
      const [project, tag, task, link] = d.store.pending();
      expect(project).toMatchObject({
        id: 'id-1',
        fields: { name: 'finance', rank: 'a0' },
      });
      expect(tag).toMatchObject({ id: 'id-3', fields: { name: '@phone' } });
      expect(task).toMatchObject({
        id: 'id-6',
        fields: { title: 'call the bank', projectId: 'id-1' },
      });
      expect(link).toMatchObject({
        id: taskTagId('id-6', 'id-3'),
        fields: { taskId: 'id-6', tagId: 'id-3' },
      });
      expect(out.stderr).toContain('note: created #finance @phone');
      expect(out.stdout).toEqual(['call the bank']);
    });

    // Scenario 2 and Review Focus 2: reuse works on pending rows too.
    it('reuses a tag by name, even one still waiting in the outbox', async () => {
      const d = deps(unreachable);
      await run(['add', 'call the bank @phone'], d);
      await run(['add', 'text mum @Phone'], d);
      const creates = d.store.pending().filter((op) => op.table === 'tag');
      expect(creates).toHaveLength(1);
      const links = d.store.pending().filter((op) => op.table === 'task_tag');
      expect(
        links.map((op) => (op.kind === 'create' ? op.fields.tagId : null)),
      ).toEqual(['id-1', 'id-1']);
    });

    // Review Focus 5: any refused op is the command's failure.
    it('exits 1 when the server refuses the tag create, not only the task', async () => {
      const d = deps((request) =>
        Promise.resolve(
          json({
            cursor: 0,
            results: request.ops.map((op) => ({
              opId: op.opId,
              status:
                op.table === 'tag'
                  ? ('rejected' as const)
                  : ('applied' as const),
              ...(op.table === 'tag' ? { reason: 'nope' } : {}),
            })),
            changes: [],
          }),
        ),
      );
      await expect(run(['add', 'x @phone'], d)).rejects.toThrow(RefusalError);
      expect(d.store.entries().some((e) => e.op.table === 'tag')).toBe(false);
    });

    // Any of the add's ops, not just the first, decides the exit.
    it.each(['task', 'task_tag'])(
      'exits 1 when the server refuses only the %s create',
      async (table) => {
        const d = deps((request) =>
          Promise.resolve(
            json({
              cursor: 0,
              results: request.ops.map((op) => ({
                opId: op.opId,
                status:
                  op.table === table
                    ? ('rejected' as const)
                    : ('applied' as const),
                ...(op.table === table ? { reason: 'nope' } : {}),
              })),
              changes: [],
            }),
          ),
        );
        await expect(run(['add', 'x @phone'], d)).rejects.toThrow(RefusalError);
      },
    );

    // `submit` queues every op or none: a half-queued add would leave a tag
    // with no task, or a link with no task.
    it("queues nothing when one of the add's operations cannot be queued", async () => {
      const d = deps(unreachable);
      d.newId = () => 'same';
      await expect(run(['add', 'x @t'], d)).rejects.toThrow();
      expect(d.store.pending()).toEqual([]);
    });

    it('says nothing about markers when there are none', async () => {
      const d = deps(fakeServer().send);
      const out = await run(['add', 'buy milk'], d);
      expect(out.stderr).toEqual([]);
    });

    // Scenario 3.
    it('shows labels after the title and filters by all of them', async () => {
      const d = deps(fakeServer().send);
      await run(['add', 'call the bank @phone #finance'], d);
      await run(['add', 'water the plants @home'], d);
      await run(['add', 'ring the plumber @phone @home'], d);

      expect((await run(['list'], d)).stdout).toEqual([
        'id-6  0  call the bank  #finance @phone',
        'id-11  0  water the plants  @home',
        'id-14  0  ring the plumber  @home @phone',
      ]);
      expect((await run(['list', '@Phone', '@home'], d)).stdout).toEqual([
        'id-14  0  ring the plumber  @home @phone',
      ]);
      expect((await run(['list', '#finance'], d)).stdout).toEqual([
        'id-6  0  call the bank  #finance @phone',
      ]);
      expect(
        envelope((await run(['list', '#finance', '--json'], d)).stdout),
      ).toMatchObject({
        data: [
          { title: 'call the bank', project: 'finance', tags: ['@phone'] },
        ],
      });
    });

    /** Seeds one live task with an optional project and attached tags, as a server would hand them over. */
    function seed(d: Deps, opts: { project?: string; tags?: string[] }) {
      const row = (
        table: string,
        id: string,
        fields: Record<string, unknown>,
      ) => ({
        table,
        id,
        seq: 1,
        row: { id, deletedAt: null, ...fields },
      });
      d.store.mergeChanges([
        ...(opts.project === undefined
          ? []
          : [row('project', 'p1', { name: opts.project })]),
        row('task', 't1', {
          title: 'seeded',
          priority: 0,
          rrule: null,
          dtstart: null,
          parentId: null,
          projectId: opts.project === undefined ? null : 'p1',
        }),
        ...(opts.tags ?? []).flatMap((name, i) => [
          row('tag', `g${i}`, { name }),
          row('task_tag', `l${i}`, { taskId: 't1', tagId: `g${i}` }),
        ]),
      ]);
    }

    it('matches a tag by name key but prints its stored spelling', async () => {
      const d = deps(unreachable);
      seed(d, { tags: ['@Phone'] });
      expect((await run(['list', '@phone'], d)).stdout).toEqual([
        't1  0  seeded  @Phone',
      ]);
    });

    it('matches a project by name key, case and Unicode form', async () => {
      const d = deps(unreachable);
      seed(d, { project: 'Fina\u0301nce' });
      expect((await run(['list', '#finance'], d)).stdout).toEqual([]);
      expect((await run(['list', '#fin\u00e1nce'], d)).stdout).toEqual([
        't1  0  seeded  #Fina\u0301nce',
      ]);
      expect((await run(['list', '#FIN\u00c1NCE'], d)).stdout).toEqual([
        't1  0  seeded  #Fina\u0301nce',
      ]);
    });

    it('matches a tag across Unicode forms', async () => {
      const d = deps(unreachable);
      seed(d, { tags: ['@cafe\u0301'] });
      expect((await run(['list', '@caf\u00e9'], d)).stdout).toEqual([
        't1  0  seeded  @cafe\u0301',
      ]);
      // The reverse: a decomposed filter is a marker too, not a usage error.
      expect((await run(['list', '@cafe\u0301'], d)).stdout).toEqual([
        't1  0  seeded  @cafe\u0301',
      ]);
      // U+1FD3 is a letter whose canonical form is U+0390.
      const e = deps(unreachable);
      seed(e, { tags: ['@\u0390'] });
      expect((await run(['list', '@\u1fd3'], e)).stdout).toEqual([
        't1  0  seeded  @\u0390',
      ]);
    });

    it('matches a composed filter against a decomposed stored tag, and the reverse', async () => {
      const d = deps(unreachable);
      seed(d, { tags: ['@caf\u00e9'] });
      expect((await run(['list', '@cafe\u0301'], d)).stdout).toEqual([
        't1  0  seeded  @caf\u00e9',
      ]);
    });

    it('validates arguments before sending anything', async () => {
      const send = vi.fn(unreachable);
      const d = deps(send);
      await run(['add', 'queued'], d);
      send.mockClear();
      await expect(run(['list', 'phone'], d)).rejects.toThrow(UsageError);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses a list argument that is not a marker', async () => {
      const d = deps(unreachable);
      await expect(run(['list', 'phone'], d)).rejects.toThrow(
        /list takes @tag and #project filters/,
      );
    });
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

  it('names every queued operation of a multi-op add when the token is refused', async () => {
    const d = deps(() => Promise.resolve(json({ title: 'Unauthorized' }, 401)));
    await expect(run(['add', 'x @phone'], d)).rejects.toThrow(
      /operations id-\d+, id-\d+, id-\d+ are queued .* do not run add again for them$/,
    );
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

    // M5: a rule producing nothing still queues the task, but says so.
    it('warns on stderr when the new rule produces no occurrence', async () => {
      const d = deps(unreachable);
      const out = await run(
        ['add', 'leap task', '--rrule', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31'],
        d,
      );
      expect(queuedFields(d)).toMatchObject({
        rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
      });
      expect(out.stderr.join('\n')).toMatch(
        /this rule produces no occurrence from 2026-09-26/,
      );
    });

    it('says nothing about an empty rule for one that does produce', async () => {
      const d = deps(unreachable);
      const out = await run(
        ['add', 'water the plants', '--rrule', 'FREQ=DAILY'],
        d,
      );
      expect(out.stderr.join('\n')).not.toMatch(/produces no occurrence/);
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

    // I3: the server settled undo's create, but kept the row's earlier
    // state — a later change from another device decided it first.
    it('notes on stderr when the server kept another state', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      await run(['done', '0002'], d);

      d.send = (request) =>
        Promise.resolve(
          json({
            cursor: request.since,
            results: request.ops.map((op) => ({
              opId: op.opId,
              status: 'superseded',
            })),
            changes: [],
          }),
        );
      const out = await run(['undo', '0002', '--json'], d);

      expect(out.exit).toBe(0);
      expect(out.stderr.join('\n')).toMatch(/the server kept 'done'/);
      expect(envelope(out.stdout)).toMatchObject({ data: { state: 'done' } });
    });

    // M2: the refusal names the command that actually queued the operation.
    it('keeps done queued when the token is refused, naming done', async () => {
      const d = hexDeps(fakeServer().send);
      await run(['add', 'water the plants', '--rrule', 'FREQ=DAILY'], d);
      d.send = () => Promise.resolve(json({ title: 'Unauthorized' }, 401));

      const refused = run(['done', '0002'], d);
      await expect(refused).rejects.toThrow(RefusalError);
      await expect(refused).rejects.toThrow(/do not run done again/);
      expect(d.store.entries().map((e) => e.status)).toEqual(['pending']);
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

    // M1: a tombstoned task is neither listed nor markable.
    it('omits a tombstoned task from list and refuses to mark it', async () => {
      const d = hexDeps(fakeServer().send);
      d.store.mergeChanges([
        {
          table: 'task',
          id: 'ghost-0000-00dddd',
          seq: 1,
          row: {
            id: 'ghost-0000-00dddd',
            title: 'ghost task',
            priority: 0,
            rrule: null,
            dtstart: null,
            parentId: null,
            deletedAt: '2026-09-01T00:00:00.000Z',
          },
        },
      ]);
      expect(await lines(d)).toEqual([]);
      await expect(run(['done', 'dddd'], d)).rejects.toThrow(
        /no task matches dddd/,
      );
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

  describe('merging duplicate names', () => {
    // Scenario 4 and Review Focus 3.
    it('queues the merge after a pull, sends it with the next command, and stops', async () => {
      const server = fakeServer();
      const d = deps(server.send);
      await run(['add', 'call the bank @phone'], d);
      // Another device created the same name offline.
      server.rows.set('other-tag', {
        table: 'tag',
        id: 'other-tag',
        seq: 100,
        row: { id: 'other-tag', name: '@Phone', version: 1, deletedAt: null },
      });

      const first = await run(['list'], d);
      expect(first.stderr.join('\n')).toMatch(/merging duplicate @phone \(2\)/);
      expect(d.store.pending().map((op) => `${op.kind} ${op.table}`)).toEqual([
        'delete tag',
      ]);

      await run(['list'], d);
      const liveTags = [...server.rows.values()].filter(
        (c) => c.table === 'tag' && c.row.deletedAt === null,
      );
      expect(liveTags.map((c) => c.id)).toEqual(['id-1']);
      expect(d.store.pending()).toEqual([]);

      const third = await run(['list'], d);
      expect(third.stderr.join('\n')).not.toMatch(/merging/);
    });

    it('does not merge when the server was not reached', async () => {
      const d = deps(unreachable);
      d.store.mergeChanges([
        {
          table: 'tag',
          id: 'tag-a',
          seq: 1,
          row: { id: 'tag-a', name: '@phone', version: 1, deletedAt: null },
        },
        {
          table: 'tag',
          id: 'tag-b',
          seq: 2,
          row: { id: 'tag-b', name: '@Phone', version: 1, deletedAt: null },
        },
      ]);
      const out = await run(['list'], d);
      expect(out.stderr.join('\n')).not.toMatch(/merging/);
      expect(d.store.pending()).toEqual([]);
    });

    // Two clients merging the same duplicates both send the delete; the
    // second one's conflicts although the row is gone.
    describe('failed deletes', () => {
      function failedDelete(d: Deps, deletedAt: string | null) {
        d.store.mergeChanges([
          {
            table: 'tag',
            id: 'tag-x',
            seq: 1,
            row: { id: 'tag-x', name: '@x', version: 3, deletedAt },
          },
        ]);
        d.store.enqueue({
          opId: 'del-x',
          kind: 'delete',
          table: 'tag',
          id: 'tag-x',
          baseVersion: 2,
        });
        d.store.settle(
          [{ opId: 'del-x', status: 'conflict', currentVersion: 3 }],
          new Set(),
        );
        expect(d.store.entry('del-x')?.status).toBe('failed');
      }

      it('removes a failed delete whose row is already a tombstone', async () => {
        const d = deps(fakeServer().send);
        failedDelete(d, '2026-09-26T09:00:00.000Z');
        const out = await run(['list'], d);
        expect(d.store.entry('del-x')).toBeUndefined();
        expect(out.stderr.join('\n')).not.toMatch(/failed/);
      });

      // The cleanup is for moot deletes only: a failed set on a tombstone
      // is evidence the user may want to see.
      it('keeps a failed non-delete entry on a tombstoned row', async () => {
        const d = deps(fakeServer().send);
        d.store.mergeChanges([
          {
            table: 'tag',
            id: 'tag-x',
            seq: 1,
            row: {
              id: 'tag-x',
              name: '@x',
              version: 3,
              deletedAt: '2026-09-26T09:00:00.000Z',
            },
          },
        ]);
        d.store.enqueue({
          opId: 'set-x',
          kind: 'set',
          table: 'tag',
          id: 'tag-x',
          field: 'name',
          value: '@y',
          ts: 'T',
        });
        d.store.settle(
          [{ opId: 'set-x', status: 'conflict', currentVersion: 3 }],
          new Set(),
        );
        await run(['list'], d);
        expect(d.store.entry('set-x')?.status).toBe('failed');
      });

      it('leaves a moot failed delete out of outbox --json, data and counts alike', async () => {
        const d = deps(fakeServer().send);
        failedDelete(d, '2026-09-26T09:00:00.000Z');
        const out = await run(['outbox', '--json'], d);
        expect(envelope(out.stdout)).toMatchObject({
          data: [],
          outbox: { pending: 0, failed: 0 },
        });
      });

      it('keeps a failed delete whose row is still live', async () => {
        const d = deps(fakeServer().send);
        failedDelete(d, null);
        const out = await run(['list'], d);
        expect(d.store.entry('del-x')?.status).toBe('failed');
        expect(out.stderr.join('\n')).toMatch(/1 queued operation\(s\) failed/);
      });
    });

    // Review: a merge op the server refuses is an ordinary failed entry; the
    // command that reports it still succeeds.
    it('turns a refused merge op into a failed entry without failing the command', async () => {
      const server = fakeServer();
      const d = deps(server.send);
      await run(['add', 'call the bank @phone'], d);
      server.rows.set('other-tag', {
        table: 'tag',
        id: 'other-tag',
        seq: 100,
        row: { id: 'other-tag', name: '@Phone', version: 1, deletedAt: null },
      });
      await run(['list'], d);
      expect(d.store.pending().map((op) => op.kind)).toEqual(['delete']);

      d.send = (request) =>
        Promise.resolve(
          json({
            cursor: 0,
            results: request.ops.map((op) => ({
              opId: op.opId,
              status: 'conflict',
              currentVersion: 9,
            })),
            changes: [],
          }),
        );
      const out = await run(['list'], d);
      expect(out.exit).toBe(0);
      expect(
        d.store.entries().filter((e) => e.status === 'failed'),
      ).toMatchObject([{ op: { kind: 'delete', table: 'tag' } }]);
      expect(out.stderr.join('\n')).toMatch(/queued operation\(s\) failed/);
    });

    it('merges duplicate projects: the winner stays and takes the tasks', async () => {
      const server = fakeServer();
      const project = (id: string, name: string) =>
        server.rows.set(id, {
          table: 'project',
          id,
          seq: id === 'p-a' ? 1 : 2,
          row: { id, name, rank: 'a0', version: 1, deletedAt: null },
        });
      project('p-a', 'finance');
      project('p-b', 'Finance');
      server.rows.set('t1', {
        table: 'task',
        id: 't1',
        seq: 3,
        row: {
          id: 't1',
          title: 'pay rent',
          priority: 0,
          rank: 'a0',
          projectId: 'p-b',
          version: 1,
          deletedAt: null,
        },
      });
      const d = deps(server.send);

      await run(['list'], d);
      await run(['list'], d);

      const live = (table: string) =>
        [...server.rows.values()].filter(
          (c) => c.table === table && c.row.deletedAt === null,
        );
      expect(live('project').map((c) => c.id)).toEqual(['p-a']);
      expect(server.rows.get('t1')?.row.projectId).toBe('p-a');
      expect(d.store.pending()).toEqual([]);
    });
  });
});

describe('login and logout', () => {
  const never: Transport = () => Promise.reject(new Error('must not sync'));

  it('login reads the password, stores the session and says who signed in', async () => {
    const d = deps(never);
    const { api, calls } = fakeAuth();
    useAuth(d, api);
    const out = await run(['login', 'a@b.c'], d);
    expect(calls.login).toEqual([['a@b.c', 'secret']]);
    expect(d.store.auth()).toEqual(SESSION);
    expect(out).toEqual({
      exit: 0,
      stdout: ['signed in as a@b.c'],
      stderr: [],
    });
  });

  it('login --json prints the envelope', async () => {
    const out = await run(['login', 'a@b.c', '--json'], deps(never));
    expect(JSON.parse(out.stdout[0] ?? '')).toEqual({
      data: { email: 'a@b.c' },
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
  });

  it('a refused login is a refusal and stores nothing', async () => {
    const d = deps(never);
    d.auth = fakeAuth({
      login: () => Promise.reject(new RefusalError('login refused: 401')),
    }).api;
    await expect(run(['login', 'a@b.c'], d)).rejects.toThrow(RefusalError);
    expect(d.store.auth()).toBeUndefined();
  });

  it('login without exactly one email is a usage error', async () => {
    await expect(run(['login'], deps(never))).rejects.toThrow(UsageError);
    await expect(run(['login', 'a', 'b'], deps(never))).rejects.toThrow(
      UsageError,
    );
  });

  describe('switching accounts in one store', () => {
    const tokenFor = (sub: string): typeof SESSION => ({
      ...SESSION,
      accessToken: `${Buffer.from(JSON.stringify({ sub, exp: 1 })).toString('base64url')}.mac`,
    });
    const loginAs = (d: Deps, sub: string) => {
      useAuth(d, fakeAuth({ login: () => Promise.resolve(tokenFor(sub)) }).api);
      return run(['login', `${sub}@b.c`], d);
    };
    const seedReplica = (d: Deps) =>
      d.store.mergeChanges([
        {
          table: 'task',
          id: 't1',
          seq: 5,
          row: {
            id: 't1',
            deletedAt: null,
            title: 'owners',
            priority: 0,
            rrule: null,
            dtstart: null,
            parentId: null,
            projectId: null,
          },
        },
      ]);
    const queue = (d: Deps) =>
      d.store.enqueue({ opId: 'op-1', kind: 'create' } as unknown as Op);

    it('refuses a different user while operations are queued, and keeps the old session', async () => {
      const d = deps(never);
      await loginAs(d, 'owner');
      seedReplica(d);
      queue(d);
      await run(['logout'], d);
      await expect(loginAs(d, 'b')).rejects.toThrow(
        /1 queued operation.*previous account/,
      );
      expect(d.store.auth()).toBeUndefined();
      expect(d.store.rows('task')).toHaveLength(1);
      expect(d.store.counts()).toEqual({ pending: 1, failed: 0 });
      await loginAs(d, 'owner');
      expect(d.store.auth()).toEqual(tokenFor('owner'));
    });

    it('resets the replica and cursor for a different user with an empty outbox', async () => {
      const d = deps(never);
      await loginAs(d, 'owner');
      seedReplica(d);
      d.store.advanceCursor(5);
      await run(['logout'], d);
      await loginAs(d, 'b');
      expect(d.store.rows('task')).toEqual([]);
      expect(d.store.cursor()).toBe(0);
      expect(d.store.auth()).toEqual(tokenFor('b'));
    });

    it('keeps the replica when the same user signs back in', async () => {
      const d = deps(never);
      await loginAs(d, 'owner');
      seedReplica(d);
      d.store.advanceCursor(5);
      queue(d);
      await run(['logout'], d);
      await loginAs(d, 'owner');
      expect(d.store.rows('task')).toHaveLength(1);
      expect(d.store.cursor()).toBe(5);
      expect(d.store.counts().pending).toBe(1);
    });
  });

  it('logout sends the stored refresh token and clears the session', async () => {
    const d = deps(never);
    const { api, calls } = fakeAuth();
    useAuth(d, api);
    d.store.saveAuth(SESSION);
    const out = await run(['logout'], d);
    expect(calls.logout).toEqual([['acc', { refreshToken: 'ref' }]]);
    expect(d.store.auth()).toBeUndefined();
    expect(out).toEqual({ exit: 0, stdout: ['signed out'], stderr: [] });
  });

  it('logout --all sends all: true', async () => {
    const d = deps(never);
    const { api, calls } = fakeAuth();
    useAuth(d, api);
    d.store.saveAuth(SESSION);
    await run(['logout', '--all'], d);
    expect(calls.logout).toEqual([['acc', { all: true }]]);
  });

  it('logout with nothing stored sends nothing and exits 0', async () => {
    const d = deps(never);
    const { api, calls } = fakeAuth();
    useAuth(d, api);
    expect((await run(['logout'], d)).exit).toBe(0);
    expect(calls.logout).toEqual([]);
  });

  it('logout --json prints data: null', async () => {
    const out = await run(['logout', '--json'], deps(never));
    expect(JSON.parse(out.stdout[0] ?? '')).toEqual({
      data: null,
      synced: true,
      outbox: { pending: 0, failed: 0 },
    });
  });

  it('a refused logout still clears the session, then fails with exit 1', async () => {
    const d = deps(never);
    useAuth(
      d,
      fakeAuth({
        logout: () => Promise.reject(new RefusalError('logout refused: 500')),
      }).api,
    );
    d.store.saveAuth(SESSION);
    await expect(run(['logout'], d)).rejects.toThrow(
      /signed out locally.*logout refused: 500/,
    );
    expect(d.store.auth()).toBeUndefined();
  });

  it('an unreachable server on logout still clears the session and exits 5', async () => {
    const d = deps(never);
    useAuth(
      d,
      fakeAuth({
        logout: () => Promise.reject(new TypeError('fetch failed')),
      }).api,
    );
    d.store.saveAuth(SESSION);
    const out = await run(['logout', '--json'], d);
    expect(out.exit).toBe(5);
    expect(out.stderr.join()).toMatch(/signed out locally/);
    expect(JSON.parse(out.stdout[0] ?? '')).toMatchObject({ synced: false });
    expect(d.store.auth()).toBeUndefined();
  });

  const NEW = {
    accessToken: 'acc2',
    accessExpiresAt: '2026-09-26T10:30:00.000Z',
    refreshToken: 'ref2',
  };

  it('logout refreshes an expired access token first, so the server revokes', async () => {
    const d = deps(never);
    const refreshed: string[] = [];
    const { api, calls } = fakeAuth({
      refresh: (token) => {
        refreshed.push(token);
        return Promise.resolve(NEW);
      },
    });
    useAuth(d, api);
    d.store.saveAuth({
      ...SESSION,
      accessExpiresAt: '2026-09-26T09:00:00.000Z',
    });
    const out = await run(['logout'], d);
    expect(refreshed).toEqual(['ref']);
    expect(calls.logout).toEqual([['acc2', { refreshToken: 'ref2' }]]);
    expect(d.store.auth()).toBeUndefined();
    expect(out).toEqual({ exit: 0, stdout: ['signed out'], stderr: [] });
  });

  it('logout after a refused refresh is signed out: the session is dead already', async () => {
    const d = deps(never);
    const { api, calls } = fakeAuth({
      refresh: () => Promise.resolve('invalid'),
    });
    useAuth(d, api);
    d.store.saveAuth({
      ...SESSION,
      accessExpiresAt: '2026-09-26T09:00:00.000Z',
    });
    const out = await run(['logout'], d);
    expect(calls.logout).toEqual([]);
    expect(d.store.auth()).toBeUndefined();
    expect(out).toEqual({ exit: 0, stdout: ['signed out'], stderr: [] });
  });

  it('a 401 on logout renews once and retries once', async () => {
    const d = deps(never);
    let refreshes = 0;
    const { api, calls } = fakeAuth({
      refresh: () => {
        refreshes += 1;
        return Promise.resolve(NEW);
      },
      logout: (access, body) => {
        calls.logout.push([access, body]);
        return Promise.resolve(access === 'acc' ? 'unauthorized' : undefined);
      },
    });
    useAuth(d, api);
    d.store.saveAuth(SESSION);
    const out = await run(['logout'], d);
    expect(refreshes).toBe(1);
    expect(calls.logout).toEqual([
      ['acc', { refreshToken: 'ref' }],
      ['acc2', { refreshToken: 'ref2' }],
    ]);
    expect(d.store.auth()).toBeUndefined();
    expect(out.exit).toBe(0);
  });

  it('a 401 that survives the retry is a refusal, and the tokens still go', async () => {
    const d = deps(never);
    useAuth(
      d,
      fakeAuth({
        refresh: () => Promise.resolve(NEW),
        logout: () => Promise.resolve('unauthorized'),
      }).api,
    );
    d.store.saveAuth(SESSION);
    await expect(run(['logout'], d)).rejects.toThrow(/signed out locally/);
    expect(d.store.auth()).toBeUndefined();
  });

  it('logout with nothing stored and TODOER_TOKEN set says the token is not a session', async () => {
    const d = deps(never);
    d.envToken = true;
    const out = await run(['logout'], d);
    expect(out.exit).toBe(0);
    expect(out.stderr).toEqual([
      'TODOER_TOKEN is not a session the CLI can sign out',
    ]);
  });

  it('login with TODOER_TOKEN set warns that it still overrides the session', async () => {
    const d = deps(never);
    d.envToken = true;
    const out = await run(['login', 'a@b.c'], d);
    expect(out.stderr).toEqual([
      'TODOER_TOKEN is set and still overrides the stored session',
    ]);
    expect(d.store.auth()).toEqual(SESSION);
  });

  it('lets a RefusalError from flush through, for index.ts to exit 1', async () => {
    const ended: Transport = () =>
      Promise.reject(
        new RefusalError('your session has ended — run todoer login'),
      );
    await expect(run(['list'], deps(ended))).rejects.toThrow(
      'your session has ended — run todoer login',
    );
  });
});
