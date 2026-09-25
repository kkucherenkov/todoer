-- Operation ids are minted by clients, so the same id can reach the server
-- from two different accounts. With "opId" as the whole primary key, the
-- second account's operation deduplicates against the first account's row:
-- its write silently never happens, the response says success, and the
-- replayed outcome carries the *other* account's reason and currentVersion.
-- The tenant leads the key because every lookup supplies both columns, and a
-- tenant-first key is the useful prefix for anything that ever scans it.
--
-- No backfill: the pair is unique wherever "opId" alone already was, so
-- every existing row satisfies the new key as it stands.
--
-- This migration touches only "AppliedOp", so none of the four synchronised
-- tables' `DEFAULT nextval('change_seq')` is in its blast radius — see the
-- initial migration for why that default has to be checked whenever one of
-- them is.
ALTER TABLE "AppliedOp" DROP CONSTRAINT "AppliedOp_pkey";

ALTER TABLE "AppliedOp" ADD CONSTRAINT "AppliedOp_pkey" PRIMARY KEY ("userId", "opId");
