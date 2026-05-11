-- Add external course reference fields to CourseOffering
ALTER TABLE "CourseOffering"
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalSource" TEXT,
  ADD COLUMN "externalMetadata" JSONB;

CREATE INDEX "CourseOffering_externalId_idx" ON "CourseOffering"("externalId");
