-- local embedding dimension (#369): migrate material_embeddings from vector(3072) to vector(1024).
-- Existing Gemini 3072-d vectors are incompatible with local mxbai-embed-large (1024).
-- Re-embed course materials after applying this migration (see apps/core/scripts/re-embed-course.ts).

DELETE FROM "material_embeddings";

ALTER TABLE "material_embeddings" ALTER COLUMN "embedding" TYPE vector(1024);
