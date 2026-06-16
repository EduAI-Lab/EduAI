-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "motionReduced" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_preferences" ADD COLUMN "density" TEXT NOT NULL DEFAULT 'comfortable';
ALTER TABLE "user_preferences" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
