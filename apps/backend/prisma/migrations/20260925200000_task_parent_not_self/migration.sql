-- A task may not be its own parent.
--
-- The design allows exactly two levels (project -> task -> subtask) and says
-- the server enforces the depth. `create` was already safe by accident: the
-- parent row does not exist when the create runs, so SyncService's ownership
-- check rejects the reference. `set parentId` was not — the row exists, it is
-- owned by the caller, and the write went through.
--
-- A CHECK constraint rather than a rule in apply-op.ts because it holds for
-- every write path there will ever be, including the ones that do not exist
-- yet, and it costs nothing per row. Prisma's schema language cannot express
-- a CHECK constraint, so this migration is the only place it is written down;
-- the migration engine does not model check constraints either, so it neither
-- drops nor regenerates this one.
--
-- What this does NOT close: a two-node cycle (A.parent = B, B.parent = A) and
-- a chain deeper than two levels. Both need the parent's own parent, which is
-- a second row, which a CHECK constraint cannot read.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_parentId_not_self"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
