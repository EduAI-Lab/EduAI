-- Drop foreign keys referencing template tables
ALTER TABLE "public"."Activity" DROP CONSTRAINT IF EXISTS "Activity_templateId_fkey";
ALTER TABLE "public"."Lesson" DROP CONSTRAINT IF EXISTS "Lesson_templateId_fkey";
ALTER TABLE "public"."Module" DROP CONSTRAINT IF EXISTS "Module_templateId_fkey";
ALTER TABLE "public"."CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_templateId_fkey";

-- Drop columns that reference template tables
ALTER TABLE "public"."Activity" DROP COLUMN IF EXISTS "templateId";
ALTER TABLE "public"."Lesson" DROP COLUMN IF EXISTS "templateId";
ALTER TABLE "public"."Module" DROP COLUMN IF EXISTS "templateId";
ALTER TABLE "public"."CourseOffering" DROP COLUMN IF EXISTS "templateId";

-- Remove template tables no longer used
DROP TABLE IF EXISTS "public"."ActivityTemplate" CASCADE;
DROP TABLE IF EXISTS "public"."LessonTemplate" CASCADE;
DROP TABLE IF EXISTS "public"."ModuleTemplate" CASCADE;
DROP TABLE IF EXISTS "public"."CourseTemplate" CASCADE;

-- Drop enum no longer referenced
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionType') THEN
    DROP TYPE "public"."QuestionType";
  END IF;
END $$;
