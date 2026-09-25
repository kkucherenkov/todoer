-- AlterTable
-- Prisma's diff engine does not know about change_seq's DEFAULT (it is
-- attached by raw SQL in the initial migration, invisible to schema.prisma
-- by design — see the comment on Task.seq). Left to its own devices it
-- generated statements here that dropped the DEFAULT and the sequence
-- itself on all four tables; those are deleted from this file. Read this
-- file's diff against `prisma migrate diff` output before ever regenerating
-- it, rather than trusting the tool.
--
-- AppliedOp has no rows worth preserving yet (pre-launch dev data only), so
-- the two new required-ish columns are added directly rather than via a
-- backfill-then-tighten dance.
DELETE FROM "AppliedOp";

ALTER TABLE "AppliedOp"
  ADD COLUMN "status" TEXT NOT NULL,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "currentVersion" INTEGER;
