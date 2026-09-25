import { BadRequestException, Injectable } from '@nestjs/common';
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

@Injectable()
export class SyncService {
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

      // The whole operation is one transaction: recording the op id and
      // applying its effect must either both happen or neither, or a crash
      // between them turns a retry into a duplicate.
      const result = await this.prisma.$transaction(async (tx) => {
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
            await delegate.update({ where: { id }, data });
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

      results.push(result);
    }

    const changes = await this.changesSince(userId, body.since);
    const cursor = changes.reduce((m, c) => Math.max(m, c.seq), body.since);

    return { cursor, results, changes };
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
        out.push({ table, id: String(row.id), seq: Number(row.seq), row });
      }
    }
    return out.sort((a, b) => a.seq - b.seq);
  }
}
