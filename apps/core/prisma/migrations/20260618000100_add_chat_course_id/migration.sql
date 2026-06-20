-- §5a RBAC policy expansion: course-chat visibility. Tag chats with the course
-- they were created in so instructors/unit-admins can read course chats. Nullable
-- — pre-existing and general (non-course) chats stay NULL (no historical backfill).

-- AlterTable
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "courseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chats_courseId_idx" ON "chats"("courseId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
