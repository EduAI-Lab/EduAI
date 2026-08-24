-- Asynchronous duplicate detection for material uploads (#949).
-- Extraction moved off the upload request, so the content checksum is only
-- known after the 202 has been sent. A background pass that finds the content
-- already present on the course marks its provisional row FAILED and points it
-- here at the winner, replacing the old synchronous 409.
ALTER TABLE "course_materials" ADD COLUMN "duplicateOfId" TEXT;

ALTER TABLE "course_materials"
  ADD CONSTRAINT "course_materials_duplicateOfId_fkey"
  FOREIGN KEY ("duplicateOfId") REFERENCES "course_materials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "course_materials_duplicateOfId_idx"
  ON "course_materials"("duplicateOfId");
