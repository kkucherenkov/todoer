import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { UsageError } from './protocol.js';
import { SCHEMA, Store, type SqlDatabase, type SqlValue } from './store.js';

/** What every ordinary statement waits for a busy database. */
export const BUSY_TIMEOUT_MS = 5000;

/** How long `withWriteLock` waits for another holder. Longer than the default
 *  HTTP timeout of 3s, which bounds the holder's own refresh; a
 *  `TODOER_TIMEOUT_MS` above this can outlast it, and the waiter then fails
 *  with the busy error instead of waiting on. */
const WRITE_LOCK_WAIT_MS = 10_000;

/** SQLITE_BUSY. Verified against the actual error `node:sqlite` throws:
 *  `{ code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' }`.
 *  `errcode` is libsqlite3's own error code, not node's wrapper `code`. */
const SQLITE_BUSY = 5;

export function isSqliteBusy(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { errcode?: unknown }).errcode === SQLITE_BUSY
  );
}

/** SqlDatabase over node:sqlite. A statement is prepared per call, as Store
 *  did before W0 for all but settle and mergeChanges. */
// ponytail: no statement cache; add a Map<string, StatementSync> if a pull
// of many thousands of rows ever shows up in a profile.
export class NodeSqlite implements SqlDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  }

  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    this.db.prepare(sql).run(...(params as SQLInputValue[]));
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
  }

  /**
   * `transaction` for an async body: the write lock is held across awaits, so
   * another process (or Store) that wants it waits. Waiting polls with the
   * busy timeout off, because a blocking wait would freeze this event loop —
   * and, when the holder lives in the same process, never let it finish.
   */
  async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + WRITE_LOCK_WAIT_MS;
    for (let delay = 10; ; delay = Math.min(delay * 2, 100)) {
      this.db.exec('PRAGMA busy_timeout = 0');
      try {
        this.db.exec('BEGIN IMMEDIATE');
        break;
      } catch (error) {
        if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
      } finally {
        this.db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** Blocks the process for `ms`. `Atomics.wait` is synchronous, which is what
 *  a Node client wants here: there is nothing else to do while another connection
 *  holds the lock, and there is no event loop worth yielding to. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Retries `fn` while it throws SQLITE_BUSY, waiting a growing amount
 * between attempts, until ~5s of wall-clock time have passed since the
 * first attempt; any other error rethrows at once, as does a SQLITE_BUSY
 * past the budget. Wall-clock, not the sum of the sleeps, because `fn`
 * itself can block for a while (each attempt may wait up to
 * `DatabaseSync`'s own busy timeout) and that time counts too.
 *
 * Exists because ~10 processes opening a database file that does not exist
 * yet all race to switch it to WAL, which needs a momentary exclusive lock —
 * and `DatabaseSync`'s own `timeout` does not reliably cover that specific
 * lock upgrade (an upstream `node:sqlite`/SQLite quirk: the busy handler
 * isn't always consulted for it). Once the file exists this never triggers;
 * the race is only the first moment a fresh HOME creates it.
 *
 * `sleep` and `now` are both injectable so a test can fake time passing —
 * a busy loop that never really waits — instead of either burning 5 real
 * seconds or racing the actual clock.
 */
export function retryOnBusy<T>(
  fn: () => T,
  sleep: (ms: number) => void = sleepSync,
  now: () => number = Date.now,
): T {
  const budgetMs = 5000;
  const deadline = now() + budgetMs;
  let delay = 10;
  for (;;) {
    try {
      return fn();
    } catch (error) {
      if (!isSqliteBusy(error) || now() >= deadline) throw error;
      sleep(delay);
      delay = Math.min(delay * 2, 50);
    }
  }
}

export function openReplica(path: string): Store {
  const onDisk = path !== ':memory:';
  // 0700: SQLite creates -wal/-shm at the umask's permissions (0644, wide
  // open) before `chmodSync` below narrows the main file, so a private
  // directory is what keeps another local user out while the connection
  // is open. `mkdirSync`'s `mode` only applies to a directory this call
  // creates — an existing one, which the user may deliberately share, is
  // left as it is rather than chmodded out from under them.
  if (onDisk) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // And for a directory that already exists and is not private (plan A
  // created it 0755): a 077 umask while SQLite creates its files makes
  // the database, -wal and -shm 0600 from the first byte.
  const umask = process.umask(0o077);
  let db: NodeSqlite;
  try {
    db = new NodeSqlite(path);
    // Retried as one unit: both statements are idempotent, and a busy
    // error from either one means the file did not finish this
    // initialisation.
    retryOnBusy(() => {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec(SCHEMA);
    });
  } finally {
    process.umask(umask);
  }
  // The replica is the user's whole task list.
  if (onDisk) chmodSync(path, 0o600);
  return new Store(db);
}

export type NodeConfig = {
  base: string;
  token: string;
  dbPath: string;
  timeoutMs: number;
};

/**
 * The only reader of the environment. A bad value is a usage error here, at
 * startup, rather than a request that waits forever or not at all.
 */
export function readConfig(env: NodeJS.ProcessEnv): NodeConfig {
  const raw = env.TODOER_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === '' ? 3000 : Number(raw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new UsageError(
      `TODOER_TIMEOUT_MS must be a positive whole number of milliseconds, not ${String(raw)}`,
    );
  }
  return {
    base: env.TODOER_URL ?? 'http://localhost:3000/api/v1',
    token: env.TODOER_TOKEN ?? '',
    dbPath: join(env.HOME ?? homedir(), '.config', 'todoer', 'todoer.db'),
    timeoutMs,
  };
}
