-- A live subtask under a tombstoned parent: the server never cascaded
-- deletes (#391). Tombstone it the way a delete would — a new seq, so
-- clients pull the tombstone, and a version bump.
UPDATE "Task" AS child
   SET "deletedAt" = parent."deletedAt",
       "version" = child."version" + 1,
       "seq" = nextval('change_seq'),
       "updatedAt" = CURRENT_TIMESTAMP
  FROM "Task" AS parent
 WHERE child."parentId" = parent."id"
   AND child."deletedAt" IS NULL
   AND parent."deletedAt" IS NOT NULL;
