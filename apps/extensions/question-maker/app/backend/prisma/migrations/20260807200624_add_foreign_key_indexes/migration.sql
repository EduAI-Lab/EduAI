-- Index every foreign key that is not already the leading column of an existing
-- unique index (#1368). Postgres does not auto-index FK child columns and Prisma
-- only emits indexes for @id / @unique / @@unique, so these were all seq scans.
--
-- Deliberately NOT `CREATE INDEX CONCURRENTLY`: Prisma wraps each migration file
-- in a single transaction, and CONCURRENTLY cannot run inside a transaction block
-- (it errors outright, it does not degrade to a normal build). At current row
-- counts the SHARE lock these take is short. If this ever needs to run against a
-- large production table without blocking writes, it has to be applied by hand
-- outside `prisma migrate deploy`.
--
-- `IF NOT EXISTS` so a database that was hand-indexed during the measurement work
-- still applies cleanly. Index names match Prisma's own `<table>_<column>_idx`
-- convention so a later `migrate dev` does not see drift and recreate them.
--
-- `IF NOT EXISTS` matches on NAME only: an index already carrying one of these
-- names but built over different columns (a composite from the measurement work,
-- say) makes Postgres skip the CREATE and report success, and the migration is
-- then recorded as applied and never re-runs. The DO block at the bottom asserts
-- the resulting definitions, so that case aborts the migration instead of leaving
-- the database permanently diverged from schema.prisma with no drift signal.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assessment_sections_assessment_id_idx" ON "assessment_sections"("assessment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "assessments_course_id_idx" ON "assessments"("course_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "courses_user_id_idx" ON "courses"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "question_metadata_course_id_idx" ON "question_metadata"("course_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "question_metadata_primary_topic_id_idx" ON "question_metadata"("primary_topic_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "question_metadata_created_by_idx" ON "question_metadata"("created_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "section_variants_variant_id_idx" ON "section_variants"("variant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variant_selection_cursors_question_metadata_id_idx" ON "variant_selection_cursors"("question_metadata_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variant_selection_cursors_last_variant_id_idx" ON "variant_selection_cursors"("last_variant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variants_question_metadata_id_idx" ON "variants"("question_metadata_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variants_assessment_id_idx" ON "variants"("assessment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variants_reference_id_idx" ON "variants"("reference_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "variants_created_by_idx" ON "variants"("created_by");

-- Verify that every index above is the single-column, non-partial, valid btree it
-- claims to be. Catches a same-named index that `IF NOT EXISTS` silently accepted.
DO $$
DECLARE
  mismatched text;
BEGIN
  SELECT string_agg(format('%s on %s(%s)', spec.index_name, spec.table_name, spec.column_name), ', ')
  INTO mismatched
  FROM (VALUES
    ('assessment_sections', 'assessment_id', 'assessment_sections_assessment_id_idx'),
    ('assessments', 'course_id', 'assessments_course_id_idx'),
    ('courses', 'user_id', 'courses_user_id_idx'),
    ('question_metadata', 'course_id', 'question_metadata_course_id_idx'),
    ('question_metadata', 'primary_topic_id', 'question_metadata_primary_topic_id_idx'),
    ('question_metadata', 'created_by', 'question_metadata_created_by_idx'),
    ('section_variants', 'variant_id', 'section_variants_variant_id_idx'),
    ('variant_selection_cursors', 'question_metadata_id', 'variant_selection_cursors_question_metadata_id_idx'),
    ('variant_selection_cursors', 'last_variant_id', 'variant_selection_cursors_last_variant_id_idx'),
    ('variants', 'question_metadata_id', 'variants_question_metadata_id_idx'),
    ('variants', 'assessment_id', 'variants_assessment_id_idx'),
    ('variants', 'reference_id', 'variants_reference_id_idx'),
    ('variants', 'created_by', 'variants_created_by_idx')
  ) AS spec(table_name, column_name, index_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = spec.column_name AND NOT a.attisdropped
    WHERE i.indexrelid = to_regclass('public.' || spec.index_name)
      AND i.indrelid = to_regclass('public.' || spec.table_name)
      AND i.indnatts = 1
      AND i.indkey[0] = a.attnum
      AND i.indpred IS NULL
      AND i.indisvalid
      AND am.amname = 'btree'
  );

  IF mismatched IS NOT NULL THEN
    RAISE EXCEPTION 'Existing index does not match the definition this migration expects: %. Drop it and re-run.', mismatched;
  END IF;
END $$;
