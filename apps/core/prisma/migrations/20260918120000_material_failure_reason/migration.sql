-- Material failure reasons and duplicate-receipt resolution (#1791).
--
-- Extraction and embedding run off the upload request, so the CourseMaterial row
-- is the only thing a client can observe about how an upload ended. Until now it
-- carried a single bit — FAILED — which collapsed a rate-limited embedding
-- provider, an over-capacity PDF worker and an unreadable file into one
-- "processing failed" sentence, and left `duplicateOfId` unable to say whether a
-- receipt's upload had *done* anything.

CREATE TYPE "MaterialFailureCode" AS ENUM (
  'MATERIAL_EXTRACT_FAILED',
  'MATERIAL_EXTRACT_BUSY',
  'MATERIAL_EXTRACT_ABANDONED',
  'MATERIAL_EMBED_FAILED',
  'MATERIAL_EMBED_RATE_LIMITED'
);

CREATE TYPE "MaterialDuplicateResolution" AS ENUM ('EXISTING', 'RESTORED');

ALTER TABLE "course_materials"
  ADD COLUMN "failureCode" "MaterialFailureCode",
  ADD COLUMN "duplicateResolution" "MaterialDuplicateResolution";

-- Rows that failed before this migration have no recorded reason, and none can
-- be reconstructed: the cause only ever reached `system_errors`, which does not
-- carry the material id. They stay NULL, and the UI renders the same generic
-- message for a null code that it rendered for every failure before today.

-- Existing receipts predate the distinction but are all EXISTING in effect: the
-- restore path is the only producer of RESTORED, and it did not report restores
-- distinctly until now.
UPDATE "course_materials"
  SET "duplicateResolution" = 'EXISTING'
  WHERE "duplicateOfId" IS NOT NULL;
