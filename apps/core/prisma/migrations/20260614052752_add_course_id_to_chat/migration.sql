-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "courseId" TEXT;

-- CreateIndex
CREATE INDEX "chats_courseId_updatedAt_idx" ON "chats"("courseId", "updatedAt");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
