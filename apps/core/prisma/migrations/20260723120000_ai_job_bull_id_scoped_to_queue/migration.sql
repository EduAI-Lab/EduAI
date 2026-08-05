-- BullMQ auto-generated job ids are per-queue counters, so `bullJobId` is only
-- unique within a queue: `ai-jobs-chat` and `ai-jobs-heavy` both hand out "1".
-- Scope the uniqueness to the queue the job was pushed onto.

-- AlterTable
ALTER TABLE "ai_jobs" ADD COLUMN "queueName" TEXT;

-- DropIndex
DROP INDEX "ai_jobs_bullJobId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_queueName_bullJobId_key" ON "ai_jobs"("queueName", "bullJobId");
