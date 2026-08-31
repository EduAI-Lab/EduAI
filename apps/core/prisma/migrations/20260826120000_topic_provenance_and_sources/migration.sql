-- #1624: provenance for automatically provisioned course topics.
--
-- Every column added here defaults to the human-authored reading, so this
-- migration is a no-op for existing rows: they stay origin HUMAN / reviewStatus
-- ACCEPTED, which is exactly what keeps the provisioning job from ever treating
-- an instructor's topic as something it may rename, merge, or delete.
--
-- Written by hand rather than via `prisma migrate diff`: the datamodel does not
-- represent the raw-SQL objects earlier migrations created (the
-- material_embeddings ivfflat index, the material_chunks content_tsv generated
-- column), so a generated diff wants to drop them.

-- CreateEnum
CREATE TYPE "TopicOrigin" AS ENUM ('HUMAN', 'SYSTEM', 'CANVAS_MODULE', 'MATERIAL_HEADING', 'AI');

-- CreateEnum
CREATE TYPE "TopicReviewStatus" AS ENUM ('ACCEPTED', 'SUGGESTED');

-- AlterTable
ALTER TABLE "course_topics"
  ADD COLUMN "origin" "TopicOrigin" NOT NULL DEFAULT 'HUMAN',
  ADD COLUMN "reviewStatus" "TopicReviewStatus" NOT NULL DEFAULT 'ACCEPTED',
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "generatedByJobId" TEXT;

-- CreateIndex
CREATE INDEX "course_topics_courseId_reviewStatus_idx" ON "course_topics"("courseId", "reviewStatus");

-- CreateTable
CREATE TABLE "course_topic_sources" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_topic_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_topic_sources_materialId_idx" ON "course_topic_sources"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "course_topic_sources_topicId_materialId_key" ON "course_topic_sources"("topicId", "materialId");

-- AddForeignKey
ALTER TABLE "course_topic_sources" ADD CONSTRAINT "course_topic_sources_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "course_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_topic_sources" ADD CONSTRAINT "course_topic_sources_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "course_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
