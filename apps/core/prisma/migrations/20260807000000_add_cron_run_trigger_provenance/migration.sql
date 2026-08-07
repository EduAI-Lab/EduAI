CREATE TYPE "CronJobTriggerSource" AS ENUM ('SCHEDULE', 'ADMIN_UI', 'ADMIN_CHAT', 'UNKNOWN');

ALTER TABLE "cron_job_runs"
  ADD COLUMN "triggerSource" "CronJobTriggerSource" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "triggeredByUserId" TEXT;
