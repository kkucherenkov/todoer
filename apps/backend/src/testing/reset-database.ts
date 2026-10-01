import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Empties every table the DB-backed specs touch, children before the rows
 * they reference. One list, so a new table is added once instead of in every
 * spec's `beforeEach` (five copies had drifted apart before this existed).
 * vitest.setup.ts guarantees the database name ends in `_test`.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.appliedOp.deleteMany({});
  await prisma.taskOccurrence.deleteMany({});
  await prisma.taskTag.deleteMany({});
  await prisma.task.deleteMany({});
  await prisma.status.deleteMany({});
  await prisma.view.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.invitation.deleteMany({});
  await prisma.resetCode.deleteMany({});
  await prisma.user.deleteMany({});
}
