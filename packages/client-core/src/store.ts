import type { Change, Op, OpResult, SyncResponse } from '@todoer/specs';
import { UsageError } from './protocol.js';

export type SqlValue = string | number | null;

/**
 * The only per-platform part of the core (design, Q3). Synchronous: the core
 * runs beside SQLite in one thread, a CLI process or the web's leader worker
 * (Q13). Node's built-in DatabaseSync and sqlite-wasm's oo1.DB each implement
 * it directly.
 */
export interface SqlDatabase {
  /** One or more statements, no parameters, no result. */
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): void;
  /** Every row, as an object keyed by column name. */
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  /** False outside BEGIN … COMMIT, including after SQLite ended one itself. */
  readonly inTransaction: boolean;
  /** BEGIN IMMEDIATE held across awaits until `fn` settles: COMMIT on
   *  resolve, ROLLBACK (when still open) on reject. How a second caller waits
   *  is the platform's business. */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T>;
  close(): void;
}

/** A row as the server sent it; the CLI never interprets more than it shows. */
export type Row = Record<string, unknown>;

export type OutboxEntry = {
  opId: string;
  op: Op;
  status: 'pending' | 'failed';
  reason: string | null;
  currentVersion: number | null;
};

// `rows` mirrors `Change` on the wire rather than the server's tables: the
// contract can grow a column without this client migrating anything (design
// doc, Q8). `position` orders the outbox; op ids are UUIDv7 but come from
// other devices' clocks too, so they are not an order.
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rows (
    tbl TEXT    NOT NULL,
    id  TEXT    NOT NULL,
    seq INTEGER NOT NULL,
    row TEXT    NOT NULL,
    PRIMARY KEY (tbl, id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    position        INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id           TEXT    NOT NULL UNIQUE,
    op              TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'failed')),
    reason          TEXT,
    current_version INTEGER
  );
  CREATE TABLE IF NOT EXISTS owner (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT    NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    access_token      TEXT    NOT NULL,
    access_expires_at TEXT    NOT NULL,
    refresh_token     TEXT    NOT NULL
  );
`;

/** The session as `POST /auth/login` and `/auth/refresh` return it. */
export type StoredAuth = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
};

type OutboxRow = {
  op_id: string;
  op: string;
  status: 'pending' | 'failed';
  reason: string | null;
  current_version: number | null;
};

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    opId: row.op_id,
    op: JSON.parse(row.op) as Op,
    status: row.status,
    reason: row.reason,
    currentVersion: row.current_version,
  };
}

/**
 * The CLI's local state: the replica of the server's rows, the cursor, and
 * the outbox. One SQLite file, because agents run the CLI in parallel and a
 * JSON file rewritten by each invocation loses whatever the other one wrote
 * (design doc, Q2). WAL lets readers run beside a writer; the busy timeout
 * makes a second writer wait instead of failing.
 */
export class Store {
  constructor(private readonly db: SqlDatabase) {}

  close(): void {
    this.db.close();
  }

  /** IMMEDIATE: take the write lock up front, so two invocations serialise
   *  here instead of failing half-way with SQLITE_BUSY on upgrade. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      // SQLite can end the transaction itself before `fn` returns (e.g.
      // SQLITE_FULL); an unconditional ROLLBACK would then find none active,
      // throw "no transaction is active", and hide `error`.
      if (this.db.inTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * `transaction` for an async body: the write lock is held across awaits, so
   * another process (or Store) that wants it waits.
   */
  withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.withWriteLock(fn);
  }

  auth(): StoredAuth | undefined {
    const row = this.db.all<{
      access_token: string;
      access_expires_at: string;
      refresh_token: string;
    }>(
      'SELECT access_token, access_expires_at, refresh_token FROM auth WHERE id = 1',
    )[0];
    return row === undefined
      ? undefined
      : {
          accessToken: row.access_token,
          accessExpiresAt: row.access_expires_at,
          refreshToken: row.refresh_token,
        };
  }

  saveAuth(auth: StoredAuth): void {
    this.db.run(
      `INSERT INTO auth (id, access_token, access_expires_at, refresh_token)
       VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token,
         access_expires_at = excluded.access_expires_at,
         refresh_token = excluded.refresh_token`,
      [auth.accessToken, auth.accessExpiresAt, auth.refreshToken],
    );
  }

  clearAuth(): void {
    this.db.exec('DELETE FROM auth');
  }

  /** The user the replica and cursor belong to; unset until a login records it. */
  owner(): string | undefined {
    return this.db.all<{ user_id: string }>(
      'SELECT user_id FROM owner WHERE id = 1',
    )[0]?.user_id;
  }

  setOwner(userId: string): void {
    this.db.run(
      `INSERT INTO owner (id, user_id) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id`,
      [userId],
    );
  }

  cursor(): number {
    return (
      this.db.all<{ value: number }>(
        "SELECT value FROM meta WHERE key = 'cursor'",
      )[0]?.value ?? 0
    );
  }

  /** Only ever forward: a slower invocation's older response must not undo a
   *  newer one's progress. */
  advanceCursor(cursor: number): void {
    this.db.run(
      `INSERT INTO meta (key, value) VALUES ('cursor', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE excluded.value > meta.value`,
      [cursor],
    );
  }

  enqueue(op: Op): void {
    this.db.run('INSERT INTO outbox (op_id, op) VALUES (?, ?)', [
      op.opId,
      JSON.stringify(op),
    ]);
  }

  pending(): Op[] {
    const rows = this.db.all<{ op: string }>(
      "SELECT op FROM outbox WHERE status = 'pending' ORDER BY position",
    );
    return rows.map((row) => JSON.parse(row.op) as Op);
  }

  entries(): OutboxEntry[] {
    const rows = this.db.all<OutboxRow>(
      'SELECT op_id, op, status, reason, current_version FROM outbox ORDER BY position',
    );
    return rows.map(toEntry);
  }

  entry(opId: string): OutboxEntry | undefined {
    const row = this.db.all<OutboxRow>(
      'SELECT op_id, op, status, reason, current_version FROM outbox WHERE op_id = ?',
      [opId],
    )[0];
    return row === undefined ? undefined : toEntry(row);
  }

  remove(opId: string): void {
    this.db.run('DELETE FROM outbox WHERE op_id = ?', [opId]);
  }

  counts(): { pending: number; failed: number } {
    const rows = this.db.all<{ status: 'pending' | 'failed'; n: number }>(
      'SELECT status, count(*) AS n FROM outbox GROUP BY status',
    );
    const counts = { pending: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  /**
   * Applies the server's verdicts to the outbox. `applied`, `duplicate` and
   * `superseded` all mean the intent is in the server's state, so the entry
   * goes. `rejected` and `conflict` mean it did not happen: an entry some
   * earlier invocation queued stays as `failed` for `todoer outbox` to show
   * (design doc, Q6); the running command's own entry goes, because that
   * command reports it through its exit code (plan B1, ruling 4).
   */
  settle(results: OpResult[], own: ReadonlySet<string>): void {
    for (const result of results) {
      const refused =
        result.status === 'rejected' || result.status === 'conflict';
      if (refused && !own.has(result.opId)) {
        this.db.run(
          "UPDATE outbox SET status = 'failed', reason = ?, current_version = ? WHERE op_id = ?",
          [result.reason ?? null, result.currentVersion ?? null, result.opId],
        );
      } else {
        this.db.run('DELETE FROM outbox WHERE op_id = ?', [result.opId]);
      }
    }
  }

  /**
   * Forgets failed entries. Only failed ones: a pending entry may already be
   * on the server (a lost response), so forgetting it here would undo
   * nothing. Refuses the whole call if any id is not a failed entry.
   */
  drop(opIds: string[]): void {
    this.transaction(() => {
      const failed = new Set(
        this.db
          .all<{
            op_id: string;
          }>("SELECT op_id FROM outbox WHERE status = 'failed'")
          .map((row) => row.op_id),
      );
      const refused = opIds.filter((id) => !failed.has(id));
      if (refused.length > 0) {
        throw new UsageError(
          `not a failed operation: ${refused.join(', ')} — only failed operations can be dropped`,
        );
      }
      for (const id of opIds) {
        this.db.run('DELETE FROM outbox WHERE op_id = ?', [id]);
      }
    });
  }

  /** Upserts, keeping whichever version of a row has the higher seq. */
  mergeChanges(changes: Change[]): void {
    for (const change of changes) {
      this.db.run(
        `INSERT INTO rows (tbl, id, seq, row) VALUES (?, ?, ?, ?)
         ON CONFLICT (tbl, id) DO UPDATE SET seq = excluded.seq, row = excluded.row
         WHERE excluded.seq > rows.seq`,
        [change.table, change.id, change.seq, JSON.stringify(change.row)],
      );
    }
  }

  rows(table: string): Row[] {
    const rows = this.db.all<{ row: string }>(
      'SELECT row FROM rows WHERE tbl = ? ORDER BY seq',
      [table],
    );
    return rows.map((row) => JSON.parse(row.row) as Row);
  }

  /** After a 410, or a login as another user: the replica is unrecoverable
   *  or foreign, the outbox is not (ADR 0013). Joins a surrounding write lock. */
  resetReplica(): void {
    const reset = () => {
      this.db.exec('DELETE FROM rows');
      this.db.exec(
        `INSERT INTO meta (key, value) VALUES ('cursor', 0)
         ON CONFLICT (key) DO UPDATE SET value = 0`,
      );
    };
    if (this.db.inTransaction) reset();
    else this.transaction(reset);
  }

  /**
   * One response, one transaction: verdicts, rows and cursor land together.
   * `since` is the cursor the request carried, so `changes` holds only what
   * came after it. The verdicts always apply; the delta only if the replica
   * still holds everything up to `since` — a parallel invocation's 410 may
   * have reset it meanwhile, and merging then would leave a partial replica
   * behind a cursor that claims it is whole.
   */
  applyResponse(
    response: SyncResponse,
    own: ReadonlySet<string>,
    since: number,
  ): void {
    this.transaction(() => {
      this.settle(response.results, own);
      if (this.cursor() < since) return;
      this.mergeChanges(response.changes);
      this.advanceCursor(response.cursor);
    });
  }
}
