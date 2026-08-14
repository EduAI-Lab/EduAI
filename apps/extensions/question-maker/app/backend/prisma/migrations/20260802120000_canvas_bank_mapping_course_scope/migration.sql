-- Scope Canvas bank mappings to the local QM course so the same remote bank
-- can sync into multiple courses without re-pointing / orphaning the first link.
ALTER TABLE "canvas_bank_mappings" ADD COLUMN "local_course_id" INTEGER;

-- Feature not yet in production; drop any pre-release rows that cannot be keyed.
DELETE FROM "canvas_bank_mappings" WHERE "local_course_id" IS NULL;

ALTER TABLE "canvas_bank_mappings" ALTER COLUMN "local_course_id" SET NOT NULL;

DROP INDEX IF EXISTS "canvas_bank_mappings_user_id_canvas_bank_id_key";

CREATE UNIQUE INDEX "canvas_bank_mappings_user_id_canvas_bank_id_local_course_id_key"
  ON "canvas_bank_mappings"("user_id", "canvas_bank_id", "local_course_id");
