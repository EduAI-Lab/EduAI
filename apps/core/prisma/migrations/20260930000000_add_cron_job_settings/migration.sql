-- CreateTable
CREATE TABLE "cron_job_settings" (
    "jobName"   TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "value"     TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "cron_job_settings_pkey" PRIMARY KEY ("jobName", "key")
);
