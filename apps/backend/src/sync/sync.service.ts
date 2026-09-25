import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyOp, type Op, type Outcome, type Row } from './apply-op.js';

type SyncRequest = { since: number; ops: Op[] };
type OpResult = {
  opId: string;
  status: 'applied' | 'duplicate' | 'superseded' | 'conflict' | 'rejected';
  reason?: string;
  currentVersion?: number;
};
type Change = { table: string; id: string; seq: number; row: Record<string, unknown> };

const TABLES = ['task', 'project', 'tag', 'task_tag'] as const;
type TableName = (typeof TABLES)[number];

const DELEGATE = {
  task: 'task', project: 'project', tag: 'tag', task_tag: 'taskTag',
} as const;

/**
 * Columns a client may set through `create`/`set`, per table. `applyOp`
 * already guards the protocol-owned columns (id, version, fieldTs, seq,
 * deletedAt, ...); this guards the opposite direction — a field that is not
 * a column at all, which applyOp has no way to know and would otherwise
 * reach Prisma as an "unknown argument" and throw. See the sync design
 * doc's section 3, "Permitted?".
 */
const WRITABLE_FIELDS: Record<TableName, ReadonlySet<string>> = {
  task: new Set([
    'title', 'notes', 'projectId', 'parentId', 'priority',
    'scheduledOn', 'dueOn', 'rrule', 'dtstart', 'rank',
  ]),
  project: new Set(['name', 'rank', 'archivedAt']),
  tag: new Set(['name', 'color']),
  task_tag: new Set(['taskId', 'tagId']),
};

/**
 * The minimal shape this module needs from a Prisma model delegate, picked
 * dynamically by table name. Prisma's own delegate types don't unify across
 * models (each has its own create/update input type), so reaching them by a
 * runtime string requires a cast; this interface is the one place that cast
 * lands, kept to exactly the methods called below.
 */
type SyncDelegate = {
  findFirst(args: unknown): Promise<Row | null>;
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
};

type DelegateKey = (typeof DELEGATE)[TableName];

function delegateFor(client: unknown, table: TableName): SyncDelegate {
  return (client as unknown as Record<DelegateKey, SyncDelegate>)[DELEGATE[table]];
}

/**
 * The protocol columns a client's replica needs from every table — `seq`
 * is excluded on purpose, since it is already the `Change`'s own top-level
 * field, and it is a `bigint`, which has no `JSON.stringify` representation
 * of its own.
 */
const READABLE_PROTOCOL_FIELDS = ['id', 'version', 'fieldTs', 'deletedAt'] as const;

/**
 * The row as returned to a client: an explicit allow-list, not a deny-list
 * on an unrestricted `findMany`. A deny-list reaches every column a future
 * migration adds by default — including, one day, another `BigInt` — and
 * the failure that produces would land in production rather than in a
 * test. Naming exactly what a client receives means a new column stays out
 * until someone decides it belongs in `WRITABLE_FIELDS` or here.
 */
function toChangeRow(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [...READABLE_PROTOCOL_FIELDS, ...WRITABLE_FIELDS[table]]) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/**
 * The field an op targets that is not one of `table`'s writable columns, or
 * `null` if there is nothing to object to here. A malformed `fields`/`field`
 * (wrong type, missing) is left to `applyOp`, which already rejects those —
 * this only adds the one check `applyOp` cannot make, because it does not
 * know the schema.
 */
function unpermittedField(table: TableName, op: Op): string | null {
  if (op.kind === 'create') {
    if (typeof op.fields !== 'object' || op.fields === null || Array.isArray(op.fields)) return null;
    for (const key of Object.keys(op.fields)) {
      if (!WRITABLE_FIELDS[table].has(key)) return key;
    }
    return null;
  }
  if (op.kind === 'set') {
    if (typeof op.field !== 'string') return null;
    return WRITABLE_FIELDS[table].has(op.field) ? null : op.field;
  }
  return null;
}

type StoredOutcome = { status: string; reason: string | null; currentVersion: number | null };

/**
 * Turns a previously recorded outcome back into the `OpResult` a fresh
 * application of the same op would have produced. This is what makes a
 * redelivered `conflict` or `rejected` surface to the client again on
 * replay, instead of arriving as a bare `duplicate` that the client's
 * outbox rule drops silently — dropping it silently is only correct for an
 * outcome that already had its effect, which is the one case this maps to
 * `duplicate` rather than replaying verbatim.
 */
function replay(opId: string, stored: StoredOutcome): OpResult {
  if (stored.status === 'applied') return { opId, status: 'duplicate' };
  const status = stored.status as 'superseded' | 'conflict' | 'rejected';
  return {
    opId,
    status,
    ...(stored.reason !== null ? { reason: stored.reason } : {}),
    ...(stored.currentVersion !== null ? { currentVersion: stored.currentVersion } : {}),
  };
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(
    userId: string,
    body: SyncRequest,
  ): Promise<{ cursor: number; results: OpResult[]; changes: Change[] }> {
    if (!Number.isInteger(body.since) || body.since < 0) {
      throw new BadRequestException('since must be a non-negative integer');
    }

    const results: OpResult[] = [];
    const now = new Date();

    for (const op of body.ops) {
      results.push(await this.applyOne(userId, op, now));
    }

    const { cursor, changes } = await this.changesSince(userId, body.since);

    return { cursor, results, changes };
  }

  private async applyOne(userId: string, op: Op, now: Date): Promise<OpResult> {
    try {
      // The whole operation is one transaction: recording the op id and
      // applying its effect must either both happen or neither, or a crash
      // between them turns a retry into a duplicate.
      return await this.prisma.$transaction(async (tx) => {
        // Step 1 of the design doc's section 3: "seen before?" — a retry
        // after a lost response is a no-op, whatever today's schema thinks
        // of the op's table or field.
        const seen = await tx.appliedOp.findUnique({ where: { opId: op.opId } });
        if (seen !== null) return replay(op.opId, seen);

        // Step 2: "Permitted?" — the table must be one this protocol
        // writes, and (for create/set) the field must be a real column.
        // This comes after step 1, not before, for the same reason: a
        // previously applied op whose table or field the schema has since
        // narrowed must still replay as itself on redelivery, not fail a
        // fresh check against today's allow-list.
        const table = TABLES.includes(op.table as TableName) ? (op.table as TableName) : null;
        const badField = table !== null ? unpermittedField(table, op) : null;

        let delegate: SyncDelegate | null = null;
        let current: Row | null = null;
        let outcome: Outcome;
        if (table === null) {
          outcome = { status: 'rejected', reason: 'unknown table' };
        } else if (badField !== null) {
          outcome = { status: 'rejected', reason: `unknown field: ${badField}` };
        } else {
          delegate = delegateFor(tx, table);
          current = await delegate.findFirst({ where: { id: op.id, userId } });
          outcome = applyOp(op, current, now);
        }

        // Recorded before the row write, not after: both still land in the
        // same transaction either way, but writing appliedOp first is what
        // lets a row-write failure roll back a record that was genuinely
        // already inserted, rather than one that was never reached — a
        // constraint violation on the row can only prove atomicity if there
        // is something written earlier in the same transaction for it to
        // undo.
        await tx.appliedOp.create({
          data: {
            opId: op.opId,
            userId,
            status: outcome.status,
            reason: outcome.status === 'rejected' ? outcome.reason : null,
            currentVersion: outcome.status === 'conflict' ? outcome.currentVersion : null,
          },
        });

        if (outcome.status === 'applied') {
          // Guaranteed set together above: `outcome.status` can only be
          // 'applied' when the permitted-checks passed and `delegate` was
          // resolved. TS cannot see that coupling across the earlier
          // if/else, so this makes it an explicit, checked invariant
          // instead of a silent assumption.
          if (delegate === null) {
            throw new Error('unreachable: applied outcome without a resolved delegate');
          }
          // seq is a protocol/storage column applyOp never touches — it comes
          // from the one sequence shared by all four tables, and it has to be
          // reassigned on *every* applied write (create or update). Postgres
          // only consults a column DEFAULT on INSERT, so leaning on the
          // schema's default would silently stop advancing the cursor for
          // any `set`/`delete`, which is exactly what D15 (returning
          // tombstones) depends on.
          const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`
            SELECT nextval('change_seq') AS nextval
          `;
          const { id, version, fieldTs, deletedAt, seq: _seq, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } =
            outcome.row;
          const data = { ...rest, version, fieldTs, deletedAt, userId, seq: nextval };
          if (current === null) {
            await delegate.create({ data: { ...data, id } });
          } else {
            // Scoped by userId too, even though `current` was already
            // resolved through a userId-scoped findFirst above — that scope
            // should never depend on a line elsewhere staying correct.
            await delegate.update({ where: { id, userId }, data });
          }
          return { opId: op.opId, status: 'applied' as const };
        }
        if (outcome.status === 'superseded') return { opId: op.opId, status: 'superseded' as const };
        if (outcome.status === 'conflict') {
          return {
            opId: op.opId, status: 'conflict' as const,
            currentVersion: outcome.currentVersion,
          };
        }
        return { opId: op.opId, status: 'rejected' as const, reason: outcome.reason };
      });
    } catch (error) {
      // The transaction above has already rolled back in full by the time
      // this runs, so neither the row write nor the appliedOp record exist
      // either way. What differs is what the client is told.
      //
      // A PrismaClientKnownRequestError — a constraint, a foreign key, a
      // validation failure — means retrying will not help: the data itself
      // is the problem, so this is an honest `rejected`, the same as any
      // other applyOp rejection. Per the client rules, `rejected` is shown
      // to the person and dropped from the outbox.
      //
      // Anything else — a P2028 interactive-transaction timeout, a
      // deadlock, a connection blip — is not the data's fault, and
      // reporting it as `rejected` would tell the client "this did not
      // happen, stop retrying" about a perfectly good edit that a retry
      // would likely succeed at. Rethrown, it becomes a 5xx, which the
      // client's transport already knows to retry.
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(error);
        return { opId: op.opId, status: 'rejected', reason: 'could not be applied' };
      }
      this.logger.error(error);
      throw error;
    }
  }

  private async changesSince(
    userId: string,
    since: number,
  ): Promise<{ cursor: number; changes: Change[] }> {
    // The four tables are read inside one transaction so they share a single
    // snapshot. Read separately (the original shape of this method), a
    // write that commits between two of the reads is visible to one and not
    // the other, and a cursor built off whichever read happened to see it
    // leaves the other table's matching row below the client's `since`
    // forever — one user with two devices is enough to hit it. REPEATABLE
    // READ is what makes "one snapshot" a guarantee instead of an accident
    // of timing: Prisma's default (READ COMMITTED) lets each statement in a
    // transaction see newly committed rows from other transactions.
    //
    // The cursor itself is the max of what the scans actually returned, not
    // change_seq's own position. Sequences are not transactional in
    // Postgres, so reading change_seq inside this same REPEATABLE READ
    // transaction still returns its live, real-time value — not a
    // snapshotted one — which is always at least the max of what the scans
    // saw, and usually more: a concurrent writer that has called nextval()
    // but not yet committed already moved it. A cursor built from that
    // value can claim ground these scans never covered, on a pull that
    // returns nothing at all. Building it from delivered rows instead means
    // the residual race (an in-flight low seq *and* no higher seq visible
    // to shrink the gap) needs both conditions at once, rather than either
    // alone — see ADR 0016 for what still gets through.
    return this.prisma.$transaction(
      async (tx) => {
        // Tombstoned rows are returned on purpose: they are how a client
        // learns about a deletion, and filtering them out is silent data
        // corruption, not a missing feature (see D15).
        const out: Change[] = [];
        for (const table of TABLES) {
          const delegate = delegateFor(tx, table);
          const rows = await delegate.findMany({
            where: { userId, seq: { gt: BigInt(since) } },
            orderBy: { seq: 'asc' },
          });
          for (const row of rows) {
            out.push({ table, id: String(row.id), seq: Number(row.seq), row: toChangeRow(table, row) });
          }
        }
        out.sort((a, b) => a.seq - b.seq);

        const cursor = out.reduce((m, c) => Math.max(m, c.seq), since);

        return { cursor, changes: out };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
