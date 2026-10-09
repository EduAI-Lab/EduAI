-- Site-wide grounded help assistant, "Penny" (#1816).
--
-- 1. #1818: a user's provider row doubles as their assistant preference. `apiKey`
--    was already nullable, so a row may now exist purely to carry a model choice.
--    "Exactly one preferred row per user" is enforced by the single writer in a
--    transaction, not by an index: "at most one true, any number of false" needs a
--    partial index, which the spec deliberately avoids depending on.
-- 2. #1823: per-user model curation. NULL = never curated, '[]' = curated nothing.
-- 3. #1821: a course-level opt-out for the assistant's material half.
-- 4. #1819: the documentation corpus, in its own table so it can never mix with
--    course-material embeddings. Same dimension as material_embeddings because it
--    is embedded by the same configured provider.

ALTER TABLE "user_provider_settings"
  ADD COLUMN "model" TEXT,
  ADD COLUMN "preferred" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "enabledModels" JSONB;

ALTER TABLE "courses"
  ADD COLUMN "aiAssistantEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "help_doc_chunks" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "slice" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(1024),
  "corpusHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "help_doc_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "help_doc_chunks_pageId_chunkIndex_key" ON "help_doc_chunks"("pageId", "chunkIndex");
CREATE INDEX "help_doc_chunks_slice_idx" ON "help_doc_chunks"("slice");
