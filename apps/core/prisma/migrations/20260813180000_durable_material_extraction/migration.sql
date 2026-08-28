-- Durable material extraction (#949 review).
--
-- Extraction runs off the upload request, so two things have to survive a
-- restart: the uploaded bytes (otherwise there is nothing to retry from) and
-- enough bookkeeping to tell a live worker from a dead one. The lease columns
-- make a PROCESSING row self-describing — a lease in the past means the worker
-- that held it is gone — and the blob table keeps the raw upload until the row
-- reaches a terminal state.

ALTER TABLE "course_materials"
  ADD COLUMN "extractionAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extractionLeaseUntil" TIMESTAMP(3);

-- Drives the sweeper's "PROCESSING with an expired lease" scan.
CREATE INDEX "course_materials_status_extractionLeaseUntil_idx"
  ON "course_materials"("status", "extractionLeaseUntil");

CREATE TABLE "material_upload_blobs" (
  "id" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "material_upload_blobs_pkey" PRIMARY KEY ("id")
);

-- One in-flight upload per material; the row is deleted once extraction settles.
CREATE UNIQUE INDEX "material_upload_blobs_materialId_key"
  ON "material_upload_blobs"("materialId");

ALTER TABLE "material_upload_blobs"
  ADD CONSTRAINT "material_upload_blobs_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "course_materials"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Rows already PROCESSING when this migration lands predate the blob table, so
-- they have no bytes to resume from. Leave them alone rather than inventing a
-- lease for them: the sweeper skips any row without a blob and marks it FAILED
-- with MATERIAL_EXTRACT_ABANDONED rather than looping on something unrecoverable.
