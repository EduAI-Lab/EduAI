-- Collapse any duplicate RUNNING rows before adding the partial unique index
-- (keep the newest startedAt per jobName; mark older ones ERROR).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY "jobName" ORDER BY "startedAt" DESC) AS rn
  FROM cron_job_runs
  WHERE status = 'RUNNING'
)
UPDATE cron_job_runs AS c
SET
  status = 'ERROR'::"CronJobStatus",
  "finishedAt" = COALESCE(c."finishedAt", NOW()),
  message = COALESCE(c.message, 'Superseded duplicate RUNNING run before unique index'),
  "exitCode" = COALESCE(c."exitCode", 1)
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- One RUNNING cron run per jobName (atomic reclaim for concurrent triggers).
CREATE UNIQUE INDEX "cron_job_runs_one_running_per_jobName"
ON "cron_job_runs" ("jobName")
WHERE status = 'RUNNING';
