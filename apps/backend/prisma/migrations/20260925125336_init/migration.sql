-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "projectId" UUID,
    "parentId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "scheduledOn" DATE,
    "dueOn" DATE,
    "rrule" TEXT,
    "dtstart" DATE,
    "rank" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fieldTs" JSONB NOT NULL DEFAULT '{}',
    "seq" BIGINT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedOp" (
    "opId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedOp_pkey" PRIMARY KEY ("opId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Task_userId_seq_idx" ON "Task"("userId", "seq");

-- CreateIndex
CREATE INDEX "Project_userId_seq_idx" ON "Project"("userId", "seq");

-- CreateIndex
CREATE INDEX "Tag_userId_seq_idx" ON "Tag"("userId", "seq");

-- CreateIndex
CREATE INDEX "TaskTag_userId_seq_idx" ON "TaskTag"("userId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTag_taskId_tagId_key" ON "TaskTag"("taskId", "tagId");

-- CreateIndex
CREATE INDEX "AppliedOp_userId_appliedAt_idx" ON "AppliedOp"("userId", "appliedAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence
--
-- WARNING: this default is invisible to prisma/schema.prisma. Prisma has no
-- declarative form for a default shared across tables, so this sequence and
-- the four ALTER TABLE statements below it were appended to the generated
-- migration by hand, after `prisma migrate dev --create-only` and before
-- applying it.
--
-- change_seq is shared by every synchronised table on purpose: one sequence
-- means one cursor can order changes across Task, Project, Tag and TaskTag
-- together. Do not split it into a per-table sequence or an identity column.
--
-- Any later migration that touches one of those four models will diff the
-- live database (which has this default) against schema.prisma (which does
-- not), and Prisma may generate SQL that drops it. Read that generated SQL
-- before applying it, and re-add the matching
-- `ALTER TABLE ... SET DEFAULT nextval('change_seq')` if it is missing — a
-- dropped default fails silently: seq starts coming back null, nothing
-- errors at migration or boot time, and the symptom only shows up later as a
-- sync cursor that never advances.
CREATE SEQUENCE change_seq AS bigint START 1;

ALTER TABLE "Task"    ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
ALTER TABLE "Project" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
ALTER TABLE "Tag"     ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
ALTER TABLE "TaskTag" ALTER COLUMN "seq" SET DEFAULT nextval('change_seq');
