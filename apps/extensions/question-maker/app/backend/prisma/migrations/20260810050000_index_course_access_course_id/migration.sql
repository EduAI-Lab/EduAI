-- `course_access` landed from development after 20260807200624 indexed the other
-- foreign keys, and its own three indexes all lead with `user_id`, so
-- `course_access.course_id` was the one FK left on a seq scan (#1368). It matters
-- more than most: the relation is `onDelete: Cascade`, so every course deletion
-- scans the whole table to find the rows to remove.
--
-- See 20260807200624 for why this is not CONCURRENTLY and why the name matters.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "course_access_course_id_idx" ON "course_access"("course_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'course_id' AND NOT a.attisdropped
    WHERE i.indexrelid = to_regclass('public.course_access_course_id_idx')
      AND i.indrelid = to_regclass('public.course_access')
      AND i.indnatts = 1
      AND i.indkey[0] = a.attnum
      AND i.indpred IS NULL
      AND i.indisvalid
      AND am.amname = 'btree'
  ) THEN
    RAISE EXCEPTION 'Existing index does not match the definition this migration expects: course_access_course_id_idx on course_access(course_id). Drop it and re-run.';
  END IF;
END $$;
