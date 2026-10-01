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
 * Only the synchronised tables with tombstones (task, tag, project, status,
 * view and the TaskTag rows), named one by one. Task occurrences are never
 * pruned on their own (ADR 0013); they go with their task, by cascade, when
 * its tombstone is pruned. A loop over every table with `deletedAt` would
 * reach them directly.
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
        this.logger.error(
          `pruning user ${id} failed`,
          error instanceof Error ? error.stack : String(error),
        );
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
   * subtask under a deleted parent) is kept and retried on the next run.
   *
   * ponytail: each deleted tombstone fires its FK action (`SET NULL` on
   * Task.projectId/parentId/statusId, `CASCADE` on TaskTag and
   * TaskOccurrence), all inside Prisma's default 5s interactive-transaction
   * timeout. TaskTag and TaskOccurrence scan their own indexed
   * `taskId`/`tagId` columns; Task.statusId is indexed too; only
   * Task.projectId and Task.parentId are still unindexed, so a user with a
   * very large backlog (first run after deploy) could hit P2028 there.
   * Upgrade path: indexes on Task.projectId, Task.parentId and/or a
   * `{ timeout }` on this transaction.
   */
  private pruneUser(userId: string, cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await lockUserWrites(tx, userId);

      const old = { userId, deletedAt: { lt: cutoff } };
      const steps: Array<[Prunable, object]> = [
        // Tombstoned TaskTag rows exist only from before TaskTag became a
        // toggle (plan C2); nothing creates new ones.
        [tx.taskTag as unknown as Prunable, old],
        // Subtasks first: their parent can go only once they are gone. A
        // task's TaskTag rows and task occurrences go with it by ON DELETE
        // CASCADE — they are never tombstoned, so waiting for them would keep
        // the task forever.
        [tx.task as unknown as Prunable, { ...old, parentId: { not: null } }],
        [tx.task as unknown as Prunable, { ...old, children: { none: {} } }],
        // A tag's TaskTag rows cascade the same way.
        [tx.tag as unknown as Prunable, old],
        [tx.project as unknown as Prunable, { ...old, tasks: { none: {} } }],
        // A status a task still points at waits, like a project: the task
        // steps above have already removed the tasks that aged out.
        [tx.status as unknown as Prunable, { ...old, tasks: { none: {} } }],
        [tx.view as unknown as Prunable, old],
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
