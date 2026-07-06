-- AlterTable
ALTER TABLE "course_materials"
  ADD COLUMN "visibleToStudents" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "availableAt" TIMESTAMP(3);
