-- AlterTable
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "instructorId" TEXT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "courses" ADD CONSTRAINT "courses_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
