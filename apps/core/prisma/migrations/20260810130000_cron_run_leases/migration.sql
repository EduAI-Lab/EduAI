-- A RUNNING cron row is a renewable execution lease. Existing RUNNING rows
-- belong to processes that predate owner fencing and therefore cannot be
-- safely trusted after deploy; preserve them as terminal audit history.
ALTER TABLE "cron_job_runs"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

UPDATE "cron_job_runs"
SET
  "status" = 'ERROR'::"CronJobStatus",
  "finishedAt" = COALESCE("finishedAt", NOW()),
  "message" = CASE
    WHEN "message" IS NULL OR BTRIM("message") = ''
      THEN 'Cron run was active during the lease migration and was safely expired'
    ELSE "message" || E'\nCron run was safely expired during the lease migration'
  END,
  "exitCode" = COALESCE("exitCode", 1)
WHERE "status" = 'RUNNING'::"CronJobStatus";

ALTER TABLE "cron_job_runs"
  ADD CONSTRAINT "cron_job_runs_running_requires_lease"
  CHECK (
    (
      "status" = 'RUNNING'::"CronJobStatus"
      AND "leaseOwner" IS NOT NULL
      AND "leaseHeartbeatAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
    )
    OR (
      "status" <> 'RUNNING'::"CronJobStatus"
      AND "leaseHeartbeatAt" IS NULL
      AND "leaseExpiresAt" IS NULL
    )
  );

CREATE INDEX "cron_job_runs_status_leaseExpiresAt_idx"
ON "cron_job_runs" ("status", "leaseExpiresAt");
