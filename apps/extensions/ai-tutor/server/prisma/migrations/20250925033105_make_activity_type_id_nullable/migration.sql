-- DropForeignKey
ALTER TABLE "public"."Activity" DROP CONSTRAINT "Activity_activityTypeId_fkey";

-- AlterTable
ALTER TABLE "public"."Activity" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "activityTypeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."ActivityType" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."CourseOffering" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Lesson" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."Module" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."PromptTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "activityTypeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "public"."ActivityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
