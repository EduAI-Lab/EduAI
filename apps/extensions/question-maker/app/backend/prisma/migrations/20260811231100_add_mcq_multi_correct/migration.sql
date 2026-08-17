-- AlterTable
ALTER TABLE "variants" ADD COLUMN "select_all_that_apply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "variants" ADD COLUMN "correct_answers" JSONB;
