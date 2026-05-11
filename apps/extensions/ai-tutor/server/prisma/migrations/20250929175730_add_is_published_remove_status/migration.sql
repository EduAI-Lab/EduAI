-- Migration: Add isPublished and remove status enum
-- Step 1: Add isPublished columns with default false
ALTER TABLE "CourseOffering" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Module" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Migrate existing data (ACTIVE courses become published)
UPDATE "CourseOffering" SET "isPublished" = true WHERE "status" = 'ACTIVE';

-- Step 3: Drop the status column
ALTER TABLE "CourseOffering" DROP COLUMN "status";

-- Step 4: Drop the enum type (if no other tables use it)
DROP TYPE "CourseOfferingStatus";