-- Durable, single-owner execution for course re-embed jobs.
--
-- Deliberately refuse to guess which active duplicate should survive. Operators
-- must inspect and resolve duplicates before retrying `prisma migrate deploy`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "course_re_embed_jobs"
    WHERE "status" IN ('PENDING', 'RUNNING')
    GROUP BY "courseId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Cannot enforce one active re-embed job per course: duplicate PENDING/RUNNING rows exist',
      HINT = 'Run: SELECT "courseId", array_agg(id ORDER BY "createdAt") AS job_ids FROM "course_re_embed_jobs" WHERE "status" IN (''PENDING'', ''RUNNING'') GROUP BY "courseId" HAVING COUNT(*) > 1; then resolve each duplicate group and retry the migration.';
  END IF;
END $$;

ALTER TABLE "course_re_embed_jobs"
  ADD COLUMN "embeddingProviderSnapshot" TEXT,
  ADD COLUMN "embeddingModelSnapshot" TEXT,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

-- Historical rows predate immutable snapshots. Use the course's explicit
-- settings first, then its last successful stamp, then the application defaults.
-- New rows always persist fully resolved settings at creation time.
UPDATE "course_re_embed_jobs" AS job
SET
  "embeddingProviderSnapshot" = CASE
    WHEN LOWER(COALESCE(course."embeddingProvider", course."embeddedWithProvider", 'cloud'))
      IN ('local', 'ollama') THEN 'local'
    ELSE 'cloud'
  END,
  "embeddingModelSnapshot" = COALESCE(
    NULLIF(course."embeddingModel", ''),
    NULLIF(course."embeddedWithModel", ''),
    CASE
      WHEN LOWER(COALESCE(course."embeddingProvider", course."embeddedWithProvider", 'cloud'))
        IN ('local', 'ollama') THEN 'mxbai-embed-large'
      ELSE 'openai/text-embedding-3-small'
    END
  )
FROM "courses" AS course
WHERE course.id = job."courseId";

ALTER TABLE "course_re_embed_jobs"
  ALTER COLUMN "embeddingProviderSnapshot" SET NOT NULL,
  ALTER COLUMN "embeddingModelSnapshot" SET NOT NULL;

CREATE INDEX "course_re_embed_jobs_status_leaseExpiresAt_idx"
ON "course_re_embed_jobs" ("status", "leaseExpiresAt");

CREATE UNIQUE INDEX "course_re_embed_jobs_one_active_per_course"
ON "course_re_embed_jobs" ("courseId")
WHERE "status" IN ('PENDING', 'RUNNING');
