-- #294: creator-FK columns for TA own-only RBAC restrictions (rbac-matrix.md §7/§8).
-- Nullable, no backfill — existing rows keep NULL owner, which routes treat as
-- "no owner: TA delete not permitted, INSTRUCTOR-and-up only".

-- AlterTable
ALTER TABLE "course_materials" ADD COLUMN     "uploadedBy" TEXT;

-- AlterTable
ALTER TABLE "course_topics" ADD COLUMN     "createdBy" TEXT;

-- CreateIndex
CREATE INDEX "course_materials_uploadedBy_idx" ON "course_materials"("uploadedBy");

-- CreateIndex
CREATE INDEX "course_topics_createdBy_idx" ON "course_topics"("createdBy");

-- AddForeignKey
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_topics" ADD CONSTRAINT "course_topics_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
