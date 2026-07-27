-- Hand-authored: Prisma's schema.prisma has no DSL for partial (WHERE-clause)
-- indexes, so this can't be expressed in schema.prisma itself. It backstops
-- importTaughtCoursesService.js's advisory-lock-guarded "at most one Practice
-- Exam per course" invariant at the DB level (ported from the old
-- scripts/migrate1072AnchorCleanup.js).
--
-- NOTE: because this index has no schema.prisma representation, a future
-- `prisma migrate dev` run may propose DROPping it as "drift". Do not accept
-- that drop — keep this index.

-- Existing databases may already hold duplicate 'Practice Exam' rows per
-- course — the old check-then-create race (fixed in 7caad975, before the
-- advisory lock landed) could let two co-instructors each create one before
-- either uniqueness guard existed. Dedupe by RENAME, not delete: a duplicate
-- may have accumulated variants/sections, and renaming preserves everything
-- while freeing the name for the unique index below (ported from
-- scripts/migrate1072AnchorCleanup.js's ensurePracticeExamUniqueness).
-- Idempotent: re-running renames nothing once no duplicates remain.
--
-- Only rows with a non-null course_id are deduplicated: the partial unique
-- index below (like a standard SQL unique index) already permits any number
-- of NULL course_id rows, so course-less 'Practice Exam' assessments are
-- left untouched rather than treated as duplicates of one another.
UPDATE assessments a
   SET name = a.name || ' (duplicate #' || a.id || ')'
 WHERE a.name = 'Practice Exam'
   AND a.course_id IS NOT NULL
   AND a.id <> (
     SELECT min(b.id) FROM assessments b
      WHERE b.course_id = a.course_id
        AND b.name = 'Practice Exam'
   );

CREATE UNIQUE INDEX IF NOT EXISTS assessments_practice_exam_unique
  ON assessments (course_id) WHERE name = 'Practice Exam';