import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { lockUserWrites } from './user-lock.js';

/**
 * How long a tombstone lives: the longest a client may stay offline and still
 * catch up incrementally (ADR 0013). A contract with offline clients, which is
 * why it is a constant and not a setting.
 */
export const RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two calls each pruning step makes, on whichever table it prunes. */
type Prunable = {
  aggregate(args: unknown): Promise<{ _max: { seq: bigint | null } }>;
  deleteMany(args: unknown): Promise<{ count: number }>;
};

/**
 * Deletes tombstones older than the retention window and raises each user's
 * prune watermark, so that a cursor which missed them is answered 410.
 *
 * Runs once at startup and once a day after that, in-process: a self-hosted
 * instance whose operator never set up an external cron would otherwise never
 * prune, and 410 would never fire. There is no instance-wide lock: each user
 * is pruned under the per-user write lock and the watermark only moves up, so
 * two instances pruning at once serialise per user and the second finds
 * nothing to delete.
 *
 * Only the four synchronised tables, named one by one. Completions are never
 * pruned (ADR 0013); a loop over "every table with deletedAt" would one day
 * reach them.
 */
@Injectable()
export class PruneService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PruneService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const run = (): void => {
      this.prune(new Date()).catch((error: unknown) => {
        this.logger.error(error);
      });
    };
    run();
    // unref: a pending prune is no reason to keep a stopping process alive.
    this.timer = setInterval(run, DAY_MS).unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Prunes every user; returns how many rows were deleted. */
  async prune(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    // ponytail: every user, every run. Fine for a personal instance; filter to
    // users with an old tombstone if the user count ever grows large.
    const users = await this.prisma.user.findMany({ select: { id: true } });
    let deleted = 0;
    for (const { id } of users) {
      // One user's failure must not cost every later user their run, every
      // day, forever — logged and skipped, not rethrown.
      try {
        deleted += await this.pruneUser(id, cutoff);
      } catch (error) {
        this.logger.error(id, error);
      }
    }
    return deleted;
  }

  /**
   * One user, one transaction, under the same lock as that user's writes: no
   * write can add a reference to a tombstone between the steps below, and the
   * watermark lands together with the deletions it describes.
   *
   * Referencing rows go before the rows they reference. A tombstone that
   * something still points at (a live task in a deleted project, a live
   * TaskTag on a deleted tag) is kept and retried on the next run.
   */
  private pruneUser(userId: string, cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserWrites(tx, userId);

      const old = { userId, deletedAt: { lt: cutoff } };
      const steps: Array<[Prunable, object]> = [
        [tx.taskTag as unknown as Prunable, old],
        // Subtasks first: their parent can go only once they are gone.
        [
          tx.task as unknown as Prunable,
          { ...old, parentId: { not: null }, tags: { none: {} } },
        ],
        [
          tx.task as unknown as Prunable,
          { ...old, children: { none: {} }, tags: { none: {} } },
        ],
        [tx.tag as unknown as Prunable, { ...old, tasks: { none: {} } }],
        [tx.project as unknown as Prunable, { ...old, tasks: { none: {} } }],
      ];

      let deleted = 0;
      let highest = 0n;
      for (const [table, where] of steps) {
        const { _max } = await table.aggregate({ where, _max: { seq: true } });
        const { count } = await table.deleteMany({ where });
        deleted += count;
        if (_max.seq !== null && _max.seq > highest) highest = _max.seq;
      }

      // GREATEST, not a plain write: a tombstone kept on an earlier run
      // because something referenced it can be pruned later with a lower seq
      // than the watermark already holds.
      if (deleted > 0) {
        await tx.$executeRaw`
          UPDATE "User"
             SET "prunedThroughSeq" = GREATEST("prunedThroughSeq", ${highest})
           WHERE "id" = ${userId}::uuid
        `;
      }
      return deleted;
    });
  }
}
