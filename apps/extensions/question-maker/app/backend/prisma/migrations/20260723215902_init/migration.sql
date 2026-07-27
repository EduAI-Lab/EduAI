-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'SA', 'LA');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('Assignment', 'Lab', 'Quiz', 'Midterm', 'Final');

-- CreateEnum
CREATE TYPE "VariantDifficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "VariantReasoningLevel" AS ENUM ('factual', 'analytical', 'application');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "courses_seeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "core_course_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "course_id" INTEGER NOT NULL,
    "core_topic_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_metadata" (
    "id" SERIAL NOT NULL,
    "description" TEXT,
    "type" "QuestionType" NOT NULL,
    "course_id" INTEGER NOT NULL,
    "primary_topic_id" TEXT NOT NULL,
    "question_order" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER,
    "type" "AssessmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blueprint_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" SERIAL NOT NULL,
    "question_text" TEXT NOT NULL,
    "difficulty" "VariantDifficulty" NOT NULL DEFAULT 'medium',
    "reasoning_level" "VariantReasoningLevel" NOT NULL DEFAULT 'factual',
    "question_metadata_id" INTEGER NOT NULL,
    "assessment_id" INTEGER,
    "secondary_topics_id" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reference_id" INTEGER,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "is_draft" BOOLEAN NOT NULL DEFAULT true,
    "answer" TEXT,
    "choices" JSONB,
    "core_question_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sections" (
    "id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "section_type" TEXT,
    "difficulty_settings" JSONB,
    "topic_filters" JSONB,
    "metadata" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_variants" (
    "id" SERIAL NOT NULL,
    "section_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "section_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_integrations" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "canvas_url" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "is_test_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_course_mappings" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_course_id" INTEGER NOT NULL,
    "canvas_course_id" INTEGER NOT NULL,
    "canvas_course_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_course_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_selection_cursors" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER NOT NULL,
    "question_metadata_id" INTEGER NOT NULL,
    "next_offset" INTEGER NOT NULL DEFAULT 0,
    "last_variant_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_selection_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "courses_core_course_id_key" ON "courses"("core_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_core_topic_id_key" ON "topics"("core_topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "topics_course_id_name_key" ON "topics"("course_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "variants_core_question_id_key" ON "variants"("core_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_variants_section_id_variant_id_key" ON "section_variants"("section_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_integrations_user_id_key" ON "canvas_integrations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_course_mappings_local_course_id_key" ON "canvas_course_mappings"("local_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_course_mappings_user_id_local_course_id_key" ON "canvas_course_mappings"("user_id", "local_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "variant_selection_cursors_course_id_question_metadata_id_key" ON "variant_selection_cursors"("course_id", "question_metadata_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_metadata" ADD CONSTRAINT "question_metadata_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_metadata" ADD CONSTRAINT "question_metadata_primary_topic_id_fkey" FOREIGN KEY ("primary_topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_metadata" ADD CONSTRAINT "question_metadata_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_question_metadata_id_fkey" FOREIGN KEY ("question_metadata_id") REFERENCES "question_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sections" ADD CONSTRAINT "assessment_sections_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_variants" ADD CONSTRAINT "section_variants_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "assessment_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_variants" ADD CONSTRAINT "section_variants_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_integrations" ADD CONSTRAINT "canvas_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_course_mappings" ADD CONSTRAINT "canvas_course_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_course_mappings" ADD CONSTRAINT "canvas_course_mappings_local_course_id_fkey" FOREIGN KEY ("local_course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_selection_cursors" ADD CONSTRAINT "variant_selection_cursors_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_selection_cursors" ADD CONSTRAINT "variant_selection_cursors_question_metadata_id_fkey" FOREIGN KEY ("question_metadata_id") REFERENCES "question_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_selection_cursors" ADD CONSTRAINT "variant_selection_cursors_last_variant_id_fkey" FOREIGN KEY ("last_variant_id") REFERENCES "variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
