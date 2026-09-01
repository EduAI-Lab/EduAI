-- Enforce one Canvas bank → one local course per instructor, and scope
-- question mappings by local course so re-sync cannot overwrite another course.

-- Bank mappings: collapse multi-course duplicates (keep oldest), restore
-- user+canvasBank unique (without localCourseId).
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "user_id", "canvas_bank_id"
           ORDER BY "created_at" ASC, id ASC
         ) AS rn
  FROM "canvas_bank_mappings"
)
DELETE FROM "canvas_bank_mappings"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS "canvas_bank_mappings_user_id_canvas_bank_id_local_course_id_key";

CREATE UNIQUE INDEX "canvas_bank_mappings_user_id_canvas_bank_id_key"
  ON "canvas_bank_mappings"("user_id", "canvas_bank_id");

CREATE INDEX IF NOT EXISTS "canvas_bank_mappings_local_course_id_idx"
  ON "canvas_bank_mappings"("local_course_id");

-- Question mappings: add local_course_id (backfill from question_metadata),
-- then unique on (user, canvas question, local course).
ALTER TABLE "canvas_bank_question_mappings"
  ADD COLUMN IF NOT EXISTS "local_course_id" INTEGER;

UPDATE "canvas_bank_question_mappings" AS m
SET "local_course_id" = qm."course_id"
FROM "question_metadata" AS qm
WHERE m."local_question_metadata_id" = qm."id"
  AND m."local_course_id" IS NULL;

-- Orphan mappings without resolvable course cannot be kept under the new invariant.
DELETE FROM "canvas_bank_question_mappings" WHERE "local_course_id" IS NULL;

ALTER TABLE "canvas_bank_question_mappings"
  ALTER COLUMN "local_course_id" SET NOT NULL;

DROP INDEX IF EXISTS "canvas_bank_question_mappings_user_id_canvas_assessment_que_key";

CREATE UNIQUE INDEX "canvas_bank_question_mappings_user_id_canvas_assessment_question_id_local_course_id_key"
  ON "canvas_bank_question_mappings"("user_id", "canvas_assessment_question_id", "local_course_id");

CREATE INDEX IF NOT EXISTS "canvas_bank_question_mappings_local_course_id_idx"
  ON "canvas_bank_question_mappings"("local_course_id");
