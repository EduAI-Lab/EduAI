-- Per-course switch for generating topics from course material (#1966).
--
-- New courses start with it off, so their topics are instructor-made unless the
-- instructor opts in. Every course that already exists keeps generating topics
-- exactly as it did before this migration.

ALTER TABLE "courses"
  ADD COLUMN "topicGenerationEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "courses" SET "topicGenerationEnabled" = true;
