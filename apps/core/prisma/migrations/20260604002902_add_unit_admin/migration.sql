-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "UserRole" ADD VALUE 'UNIT_ADMIN';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "department" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "authorizedUnits" TEXT[];
