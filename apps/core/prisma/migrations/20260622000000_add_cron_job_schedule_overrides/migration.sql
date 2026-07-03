-- CreateTable
CREATE TABLE "cron_job_schedule_overrides" (
    "jobName"       TEXT NOT NULL,
    "schedule"      TEXT NOT NULL,
    "scheduleLabel" TEXT NOT NULL,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_job_schedule_overrides_pkey" PRIMARY KEY ("jobName")
);
