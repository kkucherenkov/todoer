import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlValue } from './store.js';

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
