-- Retry-safe CourseReEmbedJob starts (#1112).
-- Scoped to course so the same client key cannot cross course authorization boundaries.
ALTER TABLE "course_re_embed_jobs" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "course_re_embed_jobs_courseId_idempotencyKey_key"
  ON "course_re_embed_jobs"("courseId", "idempotencyKey");
