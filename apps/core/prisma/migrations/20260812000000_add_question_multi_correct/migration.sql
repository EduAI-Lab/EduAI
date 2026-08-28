-- AlterTable
ALTER TABLE "questions" ADD COLUMN "selectAllThatApply" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "questions" ADD COLUMN "correctAnswers" JSONB;
