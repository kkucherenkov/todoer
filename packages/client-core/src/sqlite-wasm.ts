import type { CAPI, Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { SCHEMA, Store, type SqlDatabase, type SqlValue } from './store.js';

/** SqlDatabase over sqlite-wasm's oo1 (design Q12). One connection, owned by
 *  the leader's worker: withWriteLock queues callers in this worker instead
 *  of polling across processes as NodeSqlite does. */
export class WasmSqlite implements SqlDatabase {
  // ponytail: one queue for the whole worker; per-table locks never needed.
  private tail: Promise<unknown> = Promise.resolve();
  // A body is running. Without async context a call made from inside it
  // cannot be told from one made beside it; both are refused, because the
  // first would otherwise queue behind the body that awaits it, forever.
  private held = false;

  constructor(
    private readonly db: Database,
    private readonly capi: CAPI,
  ) {}

  get inTransaction(): boolean {
    return this.capi.sqlite3_get_autocommit(this.db.pointer!) === 0;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params: readonly SqlValue[] = []): void {
    // Bind only when there is something to bind (design W0 note).
    this.db.exec(params.length === 0 ? { sql } : { sql, bind: [...params] });
  }

  // Rows have a null prototype; Store only reads their fields.
  all<T>(sql: string, params: readonly SqlValue[] = []): T[] {
    return this.db.exec({
      sql,
      ...(params.length === 0 ? {} : { bind: [...params] }),
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }

  /** BEGIN IMMEDIATE held across awaits. Callers that arrive before a body
   *  starts wait their turn; there is no other process to wait for. A call
   *  while a body runs is refused (see `held`). */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.held) {
      return Promise.reject(
        new Error(
          'withWriteLock called while a lock body runs: on one connection it would wait for itself',
        ),
      );
    }
    const turn = async () => {
      this.db.exec('BEGIN IMMEDIATE');
      this.held = true;
      try {
        const result = await fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        if (this.inTransaction) this.db.exec('ROLLBACK');
        throw error;
      } finally {
        this.held = false;
      }
    };
    const result = this.tail.then(turn, turn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  close(): void {
    this.db.close();
  }
}

/** Schema applied, rollback journal kept (opfs-sahpool has no WAL). */
export function openWasmStore(sqlite3: Sqlite3Static, db: Database): Store {
  const sql = new WasmSqlite(db, sqlite3.capi);
  sql.exec(SCHEMA);
  return new Store(sql);
}
