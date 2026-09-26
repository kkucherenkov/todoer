-- DropForeignKey
ALTER TABLE "TaskTag" DROP CONSTRAINT "TaskTag_tagId_fkey";

-- DropForeignKey
ALTER TABLE "TaskTag" DROP CONSTRAINT "TaskTag_taskId_fkey";

-- DropIndex
DROP INDEX "TaskTag_taskId_tagId_key";

-- AlterTable
ALTER TABLE "TaskTag" ADD COLUMN     "attached" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "occurrence" DATE,
    "state" TEXT NOT NULL DEFAULT 'open',
    "completedAt" TIMESTAMP(3),
    "value" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskOccurrence_userId_seq_idx" ON "TaskOccurrence"("userId", "seq");

-- CreateIndex
CREATE INDEX "TaskOccurrence_taskId_idx" ON "TaskOccurrence"("taskId");

-- CreateIndex
CREATE INDEX "TaskTag_taskId_idx" ON "TaskTag"("taskId");

-- CreateIndex
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written, like the init migration's: Prisma does not model a default
-- shared across tables. Without it inserts into TaskOccurrence fail on a
-- null seq only when the service stops assigning seq itself — which is
-- exactly when nobody would notice.
ALTER TABLE "TaskOccurrence" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
