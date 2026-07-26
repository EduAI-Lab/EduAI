-- CreateEnum
CREATE TYPE "AiJobType" AS ENUM ('interactive', 'background');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" "AiJobType" NOT NULL,
    "source" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "bullJobId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_jobs_bullJobId_key" ON "ai_jobs"("bullJobId");

-- CreateIndex
CREATE INDEX "ai_jobs_userId_status_idx" ON "ai_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "ai_jobs_status_type_idx" ON "ai_jobs"("status", "type");
