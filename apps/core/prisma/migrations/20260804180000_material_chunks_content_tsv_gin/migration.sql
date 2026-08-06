-- #941: Hybrid RAG's `ts_rank(to_tsvector('english', mc.content), plainto_tsquery(...))`
-- (app/lib/ai/embedding.ts) re-tokenized every chunk's `content` on every hybrid query
-- because `to_tsvector` was computed inline with no stored representation to index.
-- WARNING: adding the generated column rewrites material_chunks under an
-- ACCESS EXCLUSIVE lock, and the GIN build blocks writes while it runs.
-- Schedule this migration during a low-write window (or split it into an
-- online/concurrent rollout before applying it to a large production corpus).
--
-- Add a STORED generated column so Postgres computes the tsvector once at write
-- time instead of on every read, then index it with GIN so `@@` lookups and
-- `ts_rank` don't need a full-table tokenization pass.
--
-- `GENERATED ALWAYS AS (...) STORED` columns are backfilled automatically by
-- Postgres when the column is added (the ALTER TABLE rewrites the table and
-- computes the expression for every existing row) — no separate backfill
-- UPDATE is required, and no application code / trigger needs to keep it in
-- sync afterward since it's recomputed on every write to `content`.
--
-- 'english' matches the config used by the inline query it replaces.

-- AlterTable
ALTER TABLE "material_chunks"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "material_chunks_content_tsv_idx" ON "material_chunks" USING GIN ("content_tsv");
