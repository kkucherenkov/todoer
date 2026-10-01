-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "originOccurrence" DATE,
ADD COLUMN     "originTaskId" UUID,
ADD COLUMN     "statusId" UUID;

-- CreateTable
CREATE TABLE "Status" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "color" TEXT,
    "completing" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "View" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "sort" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Status_userId_seq_idx" ON "Status"("userId", "seq");

-- CreateIndex
CREATE INDEX "View_userId_seq_idx" ON "View"("userId", "seq");

-- CreateIndex
CREATE INDEX "Task_statusId_idx" ON "Task"("statusId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "Status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Status" ADD CONSTRAINT "Status_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written, like the earlier migrations': Prisma does not model a
-- default shared across tables (trap 6).
ALTER TABLE "Status" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
ALTER TABLE "View" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
