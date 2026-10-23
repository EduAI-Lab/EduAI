-- #1998: record how automatic matching filed a material under a topic, and the
-- model's confidence for an AI match, so the UI can label it until a person
-- confirms. Both columns are nullable; existing links stay unlabelled.

-- CreateEnum
CREATE TYPE "TopicMatchKind" AS ENUM ('NAME', 'AI');

-- AlterTable
ALTER TABLE "course_topic_sources" ADD COLUMN     "matchConfidence" INTEGER,
ADD COLUMN     "matchedBy" "TopicMatchKind";

