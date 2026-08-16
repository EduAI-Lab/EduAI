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

-- CreateTable
CREATE TABLE "question_bank_memberships" (
    "id" TEXT NOT NULL,
    "questionBankId" TEXT NOT NULL,
    "externalQuestionId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'question-maker',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_bank_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_banks_courseId_isDefault_idx" ON "question_banks"("courseId", "isDefault");

-- CreateIndex
CREATE INDEX "question_bank_memberships_source_externalQuestionId_idx" ON "question_bank_memberships"("source", "externalQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "question_bank_memberships_questionBankId_source_externalQue_key" ON "question_bank_memberships"("questionBankId", "source", "externalQuestionId");

-- AddForeignKey
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank_memberships" ADD CONSTRAINT "question_bank_memberships_questionBankId_fkey" FOREIGN KEY ("questionBankId") REFERENCES "question_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
