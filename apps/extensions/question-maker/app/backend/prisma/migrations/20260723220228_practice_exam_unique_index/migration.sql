-- Hand-authored: Prisma's schema.prisma has no DSL for partial (WHERE-clause)
-- indexes, so this can't be expressed in schema.prisma itself. It backstops
-- importTaughtCoursesService.js's advisory-lock-guarded "at most one Practice
-- Exam per course" invariant at the DB level (ported from the old
-- scripts/migrate1072AnchorCleanup.js).
--
-- NOTE: because this index has no schema.prisma representation, a future
-- `prisma migrate dev` run may propose DROPping it as "drift". Do not accept
-- that drop — keep this index.
CREATE UNIQUE INDEX IF NOT EXISTS assessments_practice_exam_unique
  ON assessments (course_id) WHERE name = 'Practice Exam';