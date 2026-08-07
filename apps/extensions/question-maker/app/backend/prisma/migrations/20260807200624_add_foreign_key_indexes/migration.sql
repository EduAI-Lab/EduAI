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
