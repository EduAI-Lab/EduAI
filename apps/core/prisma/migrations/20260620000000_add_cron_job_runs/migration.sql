-- CreateEnum
CREATE TYPE "CronJobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- CreateTable
CREATE TABLE "cron_job_runs" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "CronJobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "message" TEXT,
    "exitCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cron_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cron_job_runs_jobName_startedAt_idx" ON "cron_job_runs"("jobName", "startedAt");
