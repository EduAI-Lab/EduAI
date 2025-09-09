-- Update embedding column to support 3072 dimensions for Gemini embedding model
ALTER TABLE "material_embeddings" ALTER COLUMN "embedding" TYPE vector(3072);