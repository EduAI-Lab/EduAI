-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "enableTeachMode" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "enableGuideMode" BOOLEAN NOT NULL DEFAULT true;
