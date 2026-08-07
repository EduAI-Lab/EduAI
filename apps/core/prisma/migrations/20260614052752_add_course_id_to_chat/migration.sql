-- Adds chat.courseId (course-chat visibility, RBAC §5a). Made idempotent because
-- a parallel migration on the integrated branch (20260618000100_add_chat_course_id)
-- adds the same column/constraint; the merge carries both, so whichever applies
-- second must no-op instead of erroring ("column already exists").

-- AlterTable
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "courseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chats_courseId_updatedAt_idx" ON "chats"("courseId", "updatedAt");

-- AddForeignKey (guarded — may already exist from the parallel migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chats_courseId_fkey'
  ) THEN
    ALTER TABLE "chats" ADD CONSTRAINT "chats_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
