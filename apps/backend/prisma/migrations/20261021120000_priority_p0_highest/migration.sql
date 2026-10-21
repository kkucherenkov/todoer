-- ADR 0019: P0 is the highest priority. Stored priorities and the priority
-- leaves of view filters flip to 4 - n. Every statement but the column
-- default is its own inverse, so running the list again undoes it.

-- Every task, tombstones included: a new seq so clients pull the change.
UPDATE "Task"
   SET "priority" = 4 - "priority",
       "version" = "version" + 1,
       "seq" = nextval('change_seq'),
       "updatedAt" = CURRENT_TIMESTAMP;

-- Maps `{ "priority": [n, ...] }` leaves anywhere in an and/or/not tree.
CREATE FUNCTION pg_temp.flip_priority(f jsonb) RETURNS jsonb AS $$
BEGIN
  IF f ? 'priority' THEN
    RETURN jsonb_build_object('priority', (
      SELECT coalesce(jsonb_agg(4 - n::int ORDER BY i), '[]'::jsonb)
        FROM jsonb_array_elements_text(f -> 'priority') WITH ORDINALITY AS e(n, i)
    ));
  ELSIF f ? 'and' OR f ? 'or' THEN
    RETURN jsonb_build_object(
      CASE WHEN f ? 'and' THEN 'and' ELSE 'or' END,
      (SELECT coalesce(jsonb_agg(pg_temp.flip_priority(c) ORDER BY i), '[]'::jsonb)
         FROM jsonb_array_elements(f -> CASE WHEN f ? 'and' THEN 'and' ELSE 'or' END)
              WITH ORDINALITY AS e(c, i))
    );
  ELSIF f ? 'not' THEN
    RETURN jsonb_build_object('not', pg_temp.flip_priority(f -> 'not'));
  END IF;
  RETURN f;
END;
$$ LANGUAGE plpgsql;

-- Only views that hold a priority leaf; the rest keep their seq and version.
UPDATE "View"
   SET "filter" = pg_temp.flip_priority("filter"),
       "version" = "version" + 1,
       "seq" = nextval('change_seq'),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "filter"::text LIKE '%"priority"%'
   AND pg_temp.flip_priority("filter") <> "filter";

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "priority" SET DEFAULT 4;
