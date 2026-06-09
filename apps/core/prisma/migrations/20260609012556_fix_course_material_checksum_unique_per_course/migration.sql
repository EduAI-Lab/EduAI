/*
  Warnings:

  - A unique constraint covering the columns `[courseId,checksum]` on the table `course_materials` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX IF EXISTS "course_materials_checksum_key";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "course_materials_courseId_checksum_key" ON "course_materials"("courseId", "checksum");
