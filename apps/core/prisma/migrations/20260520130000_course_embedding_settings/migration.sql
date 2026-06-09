-- Per-course embedding provider/model overrides (see LOCAL-EMBEDDINGS.md).
ALTER TABLE "courses"
  ADD COLUMN "embeddingProvider" TEXT,
  ADD COLUMN "embeddingModel" TEXT,
  ADD COLUMN "lastEmbeddedAt" TIMESTAMP(3),
  ADD COLUMN "embeddedWithProvider" TEXT,
  ADD COLUMN "embeddedWithModel" TEXT;
