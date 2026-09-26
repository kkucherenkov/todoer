import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Op } from '@todoer/specs';
import { UsageError } from './protocol.js';
import { Store, retryOnBusy } from './store.js';

let dir: string;
let open: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-store-'));
  open = [];
});

afterEach(() => {
  for (const store of open) store.close();
  rmSync(dir, { recursive: true, force: true });
});

function storeAt(name = 'todoer.db'): Store {
  const store = Store.open(join(dir, name));
  open.push(store);
  return store;
}

function create(opId: string): Op {
  return {
    opId,
    kind: 'create',
    table: 'task',
    id: `task-${opId}`,
    fields: { title: opId, rank: 'a0' },
    ts: '2026-09-26T00:00:00.000Z',
  };
}

describe('Store', () => {
  it('keeps queued operations in the order they were queued', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    expect(store.pending().map((op) => op.opId)).toEqual(['a', 'b']);
  });

  it('keeps the outbox on disk across a reopen', () => {
    const first = Store.open(join(dir, 'todoer.db'));
    first.enqueue(create('a'));
    first.close();
    expect(storeAt().pending()).toEqual([create('a')]);
  });

  // Review Focus 1: two invocations share one file. With a JSON file, the
  // second writer's copy would not contain the first writer's operation.
  it('loses no operation when two connections queue into one file', () => {
    const first = storeAt();
    const second = storeAt();
    first.enqueue(create('a'));
    second.enqueue(create('b'));
    first.enqueue(create('c'));
    expect(second.pending().map((op) => op.opId)).toEqual(['a', 'b', 'c']);
  });

  it('removes settled operations and keeps refused ones as failed', () => {
    const store = storeAt();
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.enqueue(create(id));
    store.settle(
      [
        { opId: 'a', status: 'applied' },
        { opId: 'b', status: 'duplicate' },
        { opId: 'c', status: 'superseded' },
        { opId: 'd', status: 'rejected', reason: 'unknown field: x' },
        { opId: 'e', status: 'conflict', currentVersion: 7 },
      ],
      new Set(),
    );
    expect(store.pending()).toEqual([]);
    expect(
      store
        .entries()
        .map((e) => [e.opId, e.status, e.reason, e.currentVersion]),
    ).toEqual([
      ['d', 'failed', 'unknown field: x', null],
      ['e', 'failed', null, 7],
    ]);
    expect(store.counts()).toEqual({ pending: 0, failed: 2 });
  });

  // Plan ruling 4: the invocation that queued it reports it by exit code.
  it("removes the caller's own refused operation instead of keeping it", () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.settle(
      [{ opId: 'a', status: 'rejected', reason: 'no' }],
      new Set(['a']),
    );
    expect(store.entries()).toEqual([]);
  });

  it('drops failed entries, and refuses anything else without dropping', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.enqueue(create('b'));
    store.settle([{ opId: 'a', status: 'rejected', reason: 'no' }], new Set());

    expect(() => store.drop(['a', 'b'])).toThrow(UsageError);
    expect(() => store.drop(['nope'])).toThrow(UsageError);
    expect(store.entries()).toHaveLength(2);

    store.drop(['a']);
    expect(store.entries().map((e) => [e.opId, e.status])).toEqual([
      ['b', 'pending'],
    ]);
  });

  // Review Focus 5: two invocations flushing at once can merge an older
  // response after a newer one.
  it('never replaces a row with an older version of it', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 5, row: { id: 'x', title: 'new' } },
    ]);
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 3, row: { id: 'x', title: 'old' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'new' }]);
  });

  it('never moves the cursor backwards', () => {
    const store = storeAt();
    expect(store.cursor()).toBe(0);
    store.advanceCursor(9);
    store.advanceCursor(4);
    expect(store.cursor()).toBe(9);
  });

  it('keeps rows of different tables apart even with the same id', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'x', seq: 1, row: { id: 'x', title: 'task' } },
      { table: 'project', id: 'x', seq: 2, row: { id: 'x', name: 'project' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'x', title: 'task' }]);
  });

  it('returns rows in seq order', () => {
    const store = storeAt();
    store.mergeChanges([
      { table: 'task', id: 'b', seq: 2, row: { id: 'b' } },
      { table: 'task', id: 'a', seq: 1, row: { id: 'a' } },
    ]);
    expect(store.rows('task')).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('discards the replica but not the outbox on reset', () => {
    const store = storeAt();
    store.mergeChanges([{ table: 'task', id: 'x', seq: 5, row: { id: 'x' } }]);
    store.advanceCursor(5);
    store.enqueue(create('a'));

    store.resetReplica();

    expect(store.rows('task')).toEqual([]);
    expect(store.cursor()).toBe(0);
    expect(store.pending()).toHaveLength(1);
  });

  it('applies a whole response in one step', () => {
    const store = storeAt();
    store.enqueue(create('a'));
    store.applyResponse(
      {
        cursor: 3,
        results: [{ opId: 'a', status: 'applied' }],
        changes: [
          { table: 'task', id: 'task-a', seq: 3, row: { id: 'task-a' } },
        ],
      },
      new Set(),
    );
    expect(store.pending()).toEqual([]);
    expect(store.rows('task')).toEqual([{ id: 'task-a' }]);
    expect(store.cursor()).toBe(3);
  });

  it('rolls a transaction back when it throws', () => {
    const store = storeAt();
    expect(() =>
      store.transaction(() => {
        store.enqueue(create('a'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.pending()).toEqual([]);
  });

  it('keeps the database readable only by its owner', () => {
    storeAt();
    expect(statSync(join(dir, 'todoer.db')).mode & 0o777).toBe(0o600);
  });

  // G2: the -wal/-shm side files are created at the umask's permissions
  // before `chmodSync` narrows the main file, so it is the directory, not
  // those files, that has to keep another local user out.
  it('creates a fresh database directory private to its owner', () => {
    storeAt('nested/todoer.db');
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
  });

  // G6: a ROLLBACK issued after the transaction already ended (SQLite can
  // end one itself, e.g. on SQLITE_FULL) throws "no transaction is active"
  // and must not hide the real error `fn` threw.
  it('surfaces the original error even when the transaction already ended', () => {
    const store = storeAt();
    expect(() =>
      store.transaction(() => {
        (store as unknown as { db: { exec(sql: string): void } }).db.exec(
          'ROLLBACK',
        );
        throw new Error('original');
      }),
    ).toThrow('original');
  });
});

/** A fake SQLITE_BUSY, shaped exactly like the error `node:sqlite` actually
 *  throws (verified by provoking a real one): `errcode: 5`, not the `code`
 *  string, which is the same `ERR_SQLITE_ERROR` for every SQLite error. */
function busyError(): Error {
  return Object.assign(new Error('database is locked'), {
    code: 'ERR_SQLITE_ERROR',
    errcode: 5,
  });
}

describe('retryOnBusy', () => {
  it('retries a busy operation until it succeeds', () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = retryOnBusy(
      () => {
        attempts += 1;
        if (attempts < 3) throw busyError();
        return 'ok';
      },
      (ms) => delays.push(ms),
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it('does not retry an error that is not SQLITE_BUSY', () => {
    let attempts = 0;
    const delays: number[] = [];
    expect(() =>
      retryOnBusy(
        () => {
          attempts += 1;
          throw new Error('disk full');
        },
        (ms) => delays.push(ms),
      ),
    ).toThrow('disk full');

    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it('rethrows a persistent busy error once the wall-clock budget is spent', () => {
    let attempts = 0;
    // A fake clock that jumps a full second on every read: no real wait
    // (`sleep` is a no-op below), and the ~5s budget passes in a handful of
    // calls instead of 5 real seconds.
    let simulatedNow = 0;
    const now = () => {
      simulatedNow += 1000;
      return simulatedNow;
    };
    expect(() =>
      retryOnBusy(
        () => {
          attempts += 1;
          throw busyError();
        },
        () => {},
        now,
      ),
    ).toThrow('database is locked');

    // The exact count depends on the fake clock's step, which is an
    // implementation detail of this test, not of `retryOnBusy`; this only
    // pins that it gives up rather than retrying forever.
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThan(10);
  });
});

// Review Focus (Task 3 reopened): ~10 processes opening a database file that
// does not exist yet all race to switch it to WAL, which needs a momentary
// exclusive lock that `DatabaseSync`'s own `timeout` does not reliably cover
// (an upstream node:sqlite/SQLite quirk). This must exercise the real,
// compiled `Store.open` under real OS-process concurrency — an in-process
// fake or a hand-rolled `node:sqlite` script proves nothing about the actual
// bug. `tsc` builds `dist/store.js` once up front (a few hundred ms), then
// each attempt spawns a fresh `node` process that imports the built `Store`
// and opens a brand-new file, matching the CLI's own first run.
//
// A plain "spawn 20 processes and hope" mostly measures process-startup
// jitter, not the lock race: by the time each child reaches `Store.open`,
// the others are already spread out over tens of milliseconds. Each worker
// is instead handed a shared instant (`Date.now() + 250` from the parent)
// and blocks on `Atomics.wait` until that exact wall-clock time before
// calling `Store.open` — every process's clock agrees on "now", so this
// lines them up far tighter than spawn timing alone, which is what turns
// this from an occasional flake into a reliable proof.
describe('parallel first opens (Store.open under real concurrency)', () => {
  const cliDir = fileURLToPath(new URL('..', import.meta.url));
  const storeDist = join(cliDir, 'dist', 'store.js');

  it('never leaves SQLITE_BUSY unhandled when many processes race to create the file', () => {
    execFileSync('pnpm', ['run', 'build'], { cwd: cliDir, stdio: 'pipe' });

    const workerScript = `
        import { Store } from ${JSON.stringify(storeDist)};
        const startAt = Number(process.argv[1]);
        const dbPath = process.argv[2];
        const remaining = startAt - Date.now();
        if (remaining > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
        }
        try {
          const store = Store.open(dbPath);
          store.close();
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      `;

    function openAt(
      startAt: number,
      dbPath: string,
    ): Promise<{ code: number; stderr: string }> {
      return new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          ['--input-type=module', '-e', workerScript, String(startAt), dbPath],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.on(
          'data',
          (chunk: Buffer) => (stderr += chunk.toString()),
        );
        child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
      });
    }

    return (async () => {
      const rounds = 10;
      const perRound = 20;
      const failures: string[] = [];
      for (let round = 0; round < rounds; round++) {
        const roundDir = mkdtempSync(join(tmpdir(), 'todoer-race-'));
        const dbPath = join(roundDir, 'nested', 'todoer.db');
        const startAt = Date.now() + 250;
        const results = await Promise.all(
          Array.from({ length: perRound }, () => openAt(startAt, dbPath)),
        );
        for (const { code, stderr } of results) {
          if (code !== 0) failures.push(stderr.trim() || `exit ${code}`);
        }
        rmSync(roundDir, { recursive: true, force: true });
      }
      expect(failures).toEqual([]);
    })();
  }, 20_000);
});
