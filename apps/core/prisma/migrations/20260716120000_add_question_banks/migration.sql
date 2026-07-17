-- CreateTable
CREATE TABLE "question_banks" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "question_bank_memberships" (
    "id" TEXT NOT NULL,
    "questionBankId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_bank_memberships_pkey" PRIMARY KEY ("id")
);

-- Question origin columns (additive on existing questions table)
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'question-maker';
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;

CREATE INDEX "question_banks_courseId_isDefault_idx" ON "question_banks"("courseId", "isDefault");
CREATE INDEX "question_bank_memberships_questionId_idx" ON "question_bank_memberships"("questionId");
CREATE UNIQUE INDEX "question_bank_memberships_questionBankId_questionId_key" ON "question_bank_memberships"("questionBankId", "questionId");
CREATE INDEX "questions_source_idx" ON "questions"("source");
CREATE INDEX "questions_externalSource_externalId_idx" ON "questions"("externalSource", "externalId");

ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_bank_memberships" ADD CONSTRAINT "question_bank_memberships_questionBankId_fkey" FOREIGN KEY ("questionBankId") REFERENCES "question_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_bank_memberships" ADD CONSTRAINT "question_bank_memberships_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
