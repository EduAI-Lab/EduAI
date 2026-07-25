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

-- assessments.type, question_metadata.type, variants.difficulty, and
-- variants.reasoning_level were declared via bare `DataTypes.ENUM(...)`
-- under Sequelize (src/schema/Assessments.js, Question_Metadata.js,
-- Variants.js, pre-migration), which auto-names the backing Postgres enum
-- type `enum_<table>_<column>` (Sequelize's default convention) rather than
-- the PascalCase type 20260723215902_init's `CREATE TYPE` statements
-- declare (`AssessmentType`, `QuestionType`, `VariantDifficulty`,
-- `VariantReasoningLevel`). Every generated Prisma query casts literals to
-- those PascalCase types, so a database baselined from the Sequelize schema
-- fails every write through these columns until the type is renamed.
--
-- Renaming (rather than creating the Prisma type fresh and casting the
-- column over) is required, not just simpler: baselineExistingDatabase.js
-- resolves 20260723215902_init as applied WITHOUT running its DDL (Sequelize
-- already created the tables), so on a baselined database the PascalCase
-- types from init's `CREATE TYPE` statements were never created at all —
-- there is nothing to cast to. The label sets are identical between the old
-- and new names, so a rename changes nothing about the data, and — since
-- it's the same type OID, not a new type — existing column defaults
-- (variants.difficulty/reasoning_level) keep working with no ALTER COLUMN
-- needed. Guarded on the column's current `udt_name` so each rename is a
-- no-op once already on the Prisma name (fresh databases, where init's own
-- `CREATE TYPE` already used it, or a second run of this migration).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'assessments' AND column_name = 'type' AND udt_name = 'enum_assessments_type'
  ) THEN
    ALTER TYPE "enum_assessments_type" RENAME TO "AssessmentType";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'question_metadata' AND column_name = 'type' AND udt_name = 'enum_question_metadata_type'
  ) THEN
    ALTER TYPE "enum_question_metadata_type" RENAME TO "QuestionType";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'variants' AND column_name = 'difficulty' AND udt_name = 'enum_variants_difficulty'
  ) THEN
    ALTER TYPE "enum_variants_difficulty" RENAME TO "VariantDifficulty";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'variants' AND column_name = 'reasoning_level' AND udt_name = 'enum_variants_reasoning_level'
  ) THEN
    ALTER TYPE "enum_variants_reasoning_level" RENAME TO "VariantReasoningLevel";
  END IF;
END $$;
