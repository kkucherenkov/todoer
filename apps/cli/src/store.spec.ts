import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@todoer/client-core';
import type { Op } from '@todoer/specs';
import {
  openReplica as openStore,
  retryOnBusy,
} from '@todoer/client-core/node-sqlite';

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

function storeAt(name = 'todoer.db'): Store {
  const store = openStore(join(dir, name));
  open.push(store);
  return store;
}

describe('openStore', () => {
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

  // Minor 5: a directory plan A created 0755 stays so, and the -wal/-shm
  // files SQLite creates in it must not be readable by another local user.
  it('creates the side files private to their owner in a shared directory', () => {
    mkdirSync(join(dir, 'shared'), { mode: 0o755 });
    chmodSync(join(dir, 'shared'), 0o755);
    storeAt('shared/todoer.db').enqueue(create('a'));
    for (const suffix of ['-wal', '-shm']) {
      const mode = statSync(join(dir, 'shared', `todoer.db${suffix}`)).mode;
      expect(mode & 0o777).toBe(0o600);
    }
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
// compiled `openReplica` under real OS-process concurrency — an in-process
// fake or a hand-rolled `node:sqlite` script proves nothing about the actual
// bug. It lives in `@todoer/client-core/node-sqlite`, whose `dist/` turbo's
// `^build` has written before this runs; each attempt spawns a fresh `node`
// process that imports that built entry and opens a brand-new file, matching
// the CLI's own first run.
//
// A plain "spawn 20 processes and hope" mostly measures process-startup
// jitter, not the lock race: by the time each child reaches `openStore`,
// the others are already spread out over tens of milliseconds. So each
// worker does everything up to `openStore`, prints `ready`, and blocks
// reading its stdin; once every worker of a round is ready, the parent
// writes `go` to all of them back to back. A wall-clock barrier was tried
// first and failed on a loaded CI runner (8 of 20 workers started in
// time): a pipe releases them together however slow the machine is.
describe('parallel first opens (openStore under real concurrency)', () => {
  it('never leaves SQLITE_BUSY unhandled when many processes race to create the file', () => {
    // The built entry turbo's `^build` produced before this test ran.
    const storeDist = fileURLToPath(
      import.meta.resolve('@todoer/client-core/node-sqlite'),
    );

    // `readSync` on the stdin pipe blocks until the parent writes; a
    // non-blocking descriptor answers EAGAIN instead, which is retried.
    const workerScript = `
        import { readSync, writeSync } from 'node:fs';
        import { openReplica as openStore } from ${JSON.stringify(storeDist)};
        const dbPath = process.argv[1];
        writeSync(1, 'ready\\n');
        const buffer = Buffer.alloc(1);
        for (;;) {
          try {
            if (readSync(0, buffer) > 0) break;
          } catch (error) {
            if (error.code !== 'EAGAIN') throw error;
          }
        }
        try {
          const store = openStore(dbPath);
          store.close();
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
      `;

    type Worker = {
      child: ChildProcessWithoutNullStreams;
      ready: Promise<void>;
      done: Promise<{ code: number; stderr: string }>;
    };

    function startWorker(dbPath: string): Worker {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', workerScript, dbPath],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      const done = new Promise<{ code: number; stderr: string }>((resolve) =>
        child.on('close', (code) => resolve({ code: code ?? 1, stderr })),
      );
      const ready = new Promise<void>((resolve, reject) => {
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (stdout.includes('ready\n')) resolve();
        });
        void done.then(({ code, stderr: err }) =>
          reject(new Error(`worker exited ${code} before ready: ${err}`)),
        );
      });
      return { child, ready, done };
    }

    return (async () => {
      const rounds = 10;
      const perRound = 20;
      const readyTimeoutMs = 10_000;
      const failures: string[] = [];
      for (let round = 0; round < rounds; round++) {
        const roundDir = mkdtempSync(join(tmpdir(), 'todoer-race-'));
        const dbPath = join(roundDir, 'nested', 'todoer.db');
        const workers = Array.from({ length: perRound }, () =>
          startWorker(dbPath),
        );
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            Promise.all(workers.map((w) => w.ready)),
            new Promise((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      `round ${round}: not every worker was ready within ${readyTimeoutMs} ms`,
                    ),
                  ),
                readyTimeoutMs,
              );
            }),
          ]);
        } catch (error) {
          for (const { child } of workers) child.kill();
          throw error;
        } finally {
          clearTimeout(timer);
        }
        for (const { child } of workers) child.stdin.write('go\n');
        for (const { child } of workers) child.stdin.end();
        for (const { code, stderr } of await Promise.all(
          workers.map((w) => w.done),
        )) {
          if (code !== 0) failures.push(stderr.trim() || `exit ${code}`);
        }
        rmSync(roundDir, { recursive: true, force: true });
      }
      expect(failures).toEqual([]);
    })();
  }, 120_000);
});
