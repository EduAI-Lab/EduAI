-- #1659: instructor's course-scoped ops assistant for their own published course.
-- Hand-authored (not `prisma migrate dev`'s auto-diff) — this repo currently has
-- unrelated schema drift (cron_job_runs.triggerSource/triggeredByUserId, an
-- ivfflat index, material_chunks.content_tsv nullability) that the auto-diff
-- picked up alongside this change; none of that belongs in a #1659 migration.
-- AlterEnum
ALTER TYPE "ChatbotType" ADD VALUE 'INSTRUCTOR';
