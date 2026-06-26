-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_idempotencyKey_key" ON "enrollments"("idempotencyKey");
