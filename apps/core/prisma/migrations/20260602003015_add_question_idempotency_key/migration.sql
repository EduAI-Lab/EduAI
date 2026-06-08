-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "questions_idempotencyKey_key" ON "questions"("idempotencyKey");
