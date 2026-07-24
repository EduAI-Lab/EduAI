-- Reconciles two schema differences that only matter for databases baselined
-- from the pre-Prisma Sequelize schema (see scripts/baselineExistingDatabase.js
-- and the README's "Adopting an existing deployment" section). On a fresh
-- database created by `prisma migrate deploy` from init onward, both steps
-- below are no-ops — everything already matches.

-- CanvasCourseMapping used to be unique only per (user_id, local_course_id)
-- (src/schema/CanvasCourseMapping.js, pre-migration) — nothing stopped two
-- different users from each mapping the same local_course_id. The new schema
-- is a true 1:1 CanvasCourseMapping<->Course (`localCourseId Int @unique`),
-- so baselined data must be reconciled before that unique index can be
-- created. Keep the mapping owned by the course's actual owner
-- (courses.user_id); if none match (or on a tie), keep the lowest id.
-- A mapping is just an export pointer with no dependent rows, so the losers
-- are deleted outright rather than renamed/archived.
DELETE FROM "canvas_course_mappings" m
 WHERE m.id NOT IN (
   SELECT DISTINCT ON (m2.local_course_id) m2.id
     FROM "canvas_course_mappings" m2
     JOIN "courses" c ON c.id = m2.local_course_id
    ORDER BY m2.local_course_id, (m2.user_id = c.user_id) DESC, m2.id ASC
 );

CREATE UNIQUE INDEX IF NOT EXISTS "canvas_course_mappings_local_course_id_key" ON "canvas_course_mappings"("local_course_id");

-- question_metadata.question_order was `DataTypes.JSON` under Sequelize
-- (src/schema/Question_Metadata.js, pre-migration) — the only JSON-ish column
-- in that schema that wasn't JSONB. schema.prisma's `Json` type defaults to
-- jsonb on PostgreSQL (matching every other JSON column here), so a baselined
-- database's column needs an explicit upgrade to match what init.sql creates
-- fresh. Guarded on the current type so it's a no-op once already jsonb.
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
     WHERE table_name = 'question_metadata' AND column_name = 'question_order'
  ) = 'json' THEN
    ALTER TABLE "question_metadata" ALTER COLUMN "question_order" TYPE JSONB USING "question_order"::jsonb;
  END IF;
END $$;
