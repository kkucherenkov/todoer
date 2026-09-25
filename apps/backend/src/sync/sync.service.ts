import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyOp, type Op, type Row } from './apply-op.js';

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
  project: new Set(['name', 'rank']),
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
 * The row as returned to a client. `userId`/`createdAt`/`updatedAt` are
 * server bookkeeping a client's replica has no use for, and `seq` is dropped
 * because it is already the `Change`'s own top-level field — and because it
 * is a `bigint`, which has no `JSON.stringify` representation of its own and
 * would otherwise 500 every pull that returns a change.
 */
function toChangeRow(row: Record<string, unknown>): Record<string, unknown> {
  const { userId: _userId, createdAt: _createdAt, updatedAt: _updatedAt, seq: _seq, ...rest } = row;
  return rest;
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
      if (!TABLES.includes(op.table as TableName)) {
        results.push({ opId: op.opId, status: 'rejected', reason: 'unknown table' });
        continue;
      }
      const table = op.table as TableName;

      const badField = unpermittedField(table, op);
      if (badField !== null) {
        results.push({ opId: op.opId, status: 'rejected', reason: `unknown field: ${badField}` });
        continue;
      }

      results.push(await this.applyOne(userId, table, op, now));
    }

    const changes = await this.changesSince(userId, body.since);
    const cursor = changes.reduce((m, c) => Math.max(m, c.seq), body.since);

    return { cursor, results, changes };
  }

  private async applyOne(userId: string, table: TableName, op: Op, now: Date): Promise<OpResult> {
    try {
      // The whole operation is one transaction: recording the op id and
      // applying its effect must either both happen or neither, or a crash
      // between them turns a retry into a duplicate.
      return await this.prisma.$transaction(async (tx) => {
        const seen = await tx.appliedOp.findUnique({ where: { opId: op.opId } });
        if (seen !== null) return { opId: op.opId, status: 'duplicate' as const };

        const delegate = delegateFor(tx, table);
        const current = await delegate.findFirst({ where: { id: op.id, userId } });
        const outcome = applyOp(op, current, now);

        if (outcome.status === 'applied') {
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
        }

        await tx.appliedOp.create({ data: { opId: op.opId, userId } });

        if (outcome.status === 'applied') return { opId: op.opId, status: 'applied' as const };
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
      // A Prisma error here — a foreign key pointing at a row deleted from
      // under it, a value that violates a column constraint, a connection
      // blip — must reject only this operation, not the batch: the client's
      // outbox has no other way to make progress on the operations behind
      // it, and applyOp's own never-throws guarantee would otherwise be
      // undone from the persistence side. The transaction above has already
      // rolled back in full by the time this runs, so neither the row write
      // nor the appliedOp record exist. The database's own words for why
      // are logged, not returned — a 5xx never explains itself to the
      // caller in this codebase, and this is the same rule applied to a
      // per-operation rejection instead of a response status.
      this.logger.error(error);
      return { opId: op.opId, status: 'rejected', reason: 'could not be applied' };
    }
  }

  // Tombstoned rows are returned on purpose: they are how a client learns
  // about a deletion, and filtering them out is silent data corruption, not
  // a missing feature (see D15).
  private async changesSince(userId: string, since: number): Promise<Change[]> {
    const out: Change[] = [];
    for (const table of TABLES) {
      const delegate = delegateFor(this.prisma, table);
      const rows = await delegate.findMany({
        where: { userId, seq: { gt: BigInt(since) } },
        orderBy: { seq: 'asc' },
      });
      for (const row of rows) {
        out.push({ table, id: String(row.id), seq: Number(row.seq), row: toChangeRow(row) });
      }
    }
    return out.sort((a, b) => a.seq - b.seq);
  }
}
