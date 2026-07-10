-- DropIndex
DROP INDEX "chats_courseId_idx";

-- AlterTable
ALTER TABLE "course_materials" ADD COLUMN     "unpublishedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "canvas_material_exclusions" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "canvasFileId" TEXT NOT NULL,
    "excludedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_material_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvas_material_exclusions_courseId_canvasFileId_key" ON "canvas_material_exclusions"("courseId", "canvasFileId");

-- AddForeignKey
ALTER TABLE "canvas_material_exclusions" ADD CONSTRAINT "canvas_material_exclusions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
