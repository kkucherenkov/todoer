import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA, Store } from '@todoer/client-core';
import { NodeSqlite, isSqliteBusy } from '@todoer/client-core/node-sqlite';

/** Blocks the process for `ms`. `Atomics.wait` is synchronous, which is what
 *  a CLI wants here: there is nothing else to do while another connection
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

export function openStore(path: string): Store {
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
