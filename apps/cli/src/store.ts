import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Change, Op, OpResult, SyncResponse } from '@todoer/specs';
import { UsageError } from './protocol.js';

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
const SCHEMA = `
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
`;

type OutboxRow = {
  op_id: string;
  op: string;
  status: 'pending' | 'failed';
  reason: string | null;
  current_version: number | null;
};

/**
 * The CLI's local state: the replica of the server's rows, the cursor, and
 * the outbox. One SQLite file, because agents run the CLI in parallel and a
 * JSON file rewritten by each invocation loses whatever the other one wrote
 * (design doc, Q2). WAL lets readers run beside a writer; the busy timeout
 * makes a second writer wait instead of failing.
 */
export class Store {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): Store {
    const onDisk = path !== ':memory:';
    if (onDisk) mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path, { timeout: 5000 });
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA);
    // The replica is the user's whole task list.
    if (onDisk) chmodSync(path, 0o600);
    return new Store(db);
  }

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
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  cursor(): number {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'cursor'")
      .get() as unknown as { value: number } | undefined;
    return row?.value ?? 0;
  }

  /** Only ever forward: a slower invocation's older response must not undo a
   *  newer one's progress. */
  advanceCursor(cursor: number): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('cursor', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value
         WHERE excluded.value > meta.value`,
      )
      .run(cursor);
  }

  enqueue(op: Op): void {
    this.db
      .prepare('INSERT INTO outbox (op_id, op) VALUES (?, ?)')
      .run(op.opId, JSON.stringify(op));
  }

  pending(): Op[] {
    const rows = this.db
      .prepare(
        "SELECT op FROM outbox WHERE status = 'pending' ORDER BY position",
      )
      .all() as unknown as Array<{ op: string }>;
    return rows.map((row) => JSON.parse(row.op) as Op);
  }

  entries(): OutboxEntry[] {
    const rows = this.db
      .prepare(
        'SELECT op_id, op, status, reason, current_version FROM outbox ORDER BY position',
      )
      .all() as unknown as OutboxRow[];
    return rows.map((row) => ({
      opId: row.op_id,
      op: JSON.parse(row.op) as Op,
      status: row.status,
      reason: row.reason,
      currentVersion: row.current_version,
    }));
  }

  counts(): { pending: number; failed: number } {
    const rows = this.db
      .prepare('SELECT status, count(*) AS n FROM outbox GROUP BY status')
      .all() as unknown as Array<{ status: 'pending' | 'failed'; n: number }>;
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
    const remove = this.db.prepare('DELETE FROM outbox WHERE op_id = ?');
    const fail = this.db.prepare(
      "UPDATE outbox SET status = 'failed', reason = ?, current_version = ? WHERE op_id = ?",
    );
    for (const result of results) {
      const refused =
        result.status === 'rejected' || result.status === 'conflict';
      if (refused && !own.has(result.opId)) {
        fail.run(
          result.reason ?? null,
          result.currentVersion ?? null,
          result.opId,
        );
      } else {
        remove.run(result.opId);
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
        (
          this.db
            .prepare("SELECT op_id FROM outbox WHERE status = 'failed'")
            .all() as unknown as Array<{ op_id: string }>
        ).map((row) => row.op_id),
      );
      const refused = opIds.filter((id) => !failed.has(id));
      if (refused.length > 0) {
        throw new UsageError(
          `not a failed operation: ${refused.join(', ')} — only failed operations can be dropped`,
        );
      }
      const remove = this.db.prepare('DELETE FROM outbox WHERE op_id = ?');
      for (const id of opIds) remove.run(id);
    });
  }

  /** Upserts, keeping whichever version of a row has the higher seq. */
  mergeChanges(changes: Change[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO rows (tbl, id, seq, row) VALUES (?, ?, ?, ?)
       ON CONFLICT (tbl, id) DO UPDATE SET seq = excluded.seq, row = excluded.row
       WHERE excluded.seq > rows.seq`,
    );
    for (const change of changes) {
      upsert.run(
        change.table,
        change.id,
        change.seq,
        JSON.stringify(change.row),
      );
    }
  }

  rows(table: string): Row[] {
    const rows = this.db
      .prepare('SELECT row FROM rows WHERE tbl = ? ORDER BY seq')
      .all(table) as unknown as Array<{ row: string }>;
    return rows.map((row) => JSON.parse(row.row) as Row);
  }

  /** After a 410: the replica is unrecoverable, the outbox is not (ADR 0013). */
  resetReplica(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM rows');
      this.db.exec(
        `INSERT INTO meta (key, value) VALUES ('cursor', 0)
         ON CONFLICT (key) DO UPDATE SET value = 0`,
      );
    });
  }

  /** One response, one transaction: verdicts, rows and cursor land together. */
  applyResponse(response: SyncResponse, own: ReadonlySet<string>): void {
    this.transaction(() => {
      this.settle(response.results, own);
      this.mergeChanges(response.changes);
      this.advanceCursor(response.cursor);
    });
  }
}
