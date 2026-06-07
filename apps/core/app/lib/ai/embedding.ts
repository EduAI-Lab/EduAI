import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import prisma from "../prisma.server";
import { randomUUID } from "crypto";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** Matches pgvector column vector(3072) — do not switch to 1536-dim models without a migration. */
const DEFAULT_OPENROUTER_EMBEDDING_MODEL = "google/gemini-embedding-001";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

/** Max inputs per `embedMany` batch (provider limits vary; stay conservative). */
const EMBED_MANY_BATCH_SIZE = Math.min(
  128,
  Math.max(8, Number(process.env.EMBED_MANY_BATCH_SIZE) || 64),
);

const queryEmbedCache = new Map<string, { embedding: number[]; expiresAt: number }>();
const QUERY_EMBED_CACHE_TTL_MS = Math.min(
  600_000,
  Math.max(5_000, Number(process.env.QUERY_EMBED_CACHE_TTL_MS) || 90_000),
);
const QUERY_EMBED_CACHE_MAX = Math.min(
  2000,
  Math.max(50, Number(process.env.QUERY_EMBED_CACHE_MAX) || 300),
);

function normalizeQueryForCache(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 12_000);
}

/** Prunes expired entries from the query embedding cache. */
function pruneQueryEmbedCache(): void {
  const now = Date.now();
  for (const [k, v] of queryEmbedCache) {
    if (v.expiresAt <= now) queryEmbedCache.delete(k);
  }
  while (queryEmbedCache.size > QUERY_EMBED_CACHE_MAX) {
    const first = queryEmbedCache.keys().next().value;
    if (first === undefined) break;
    queryEmbedCache.delete(first);
  }
}

/** Default similarity threshold for RAG (0–1). */
function getDefaultRagSimilarityThreshold(): number {
  const raw = process.env.RAG_SIMILARITY_THRESHOLD;
  if (raw === undefined || raw === "") return 0.5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return 0.5;
  return n;
}

/**
 * Generate chunks from text content
 * Simple sentence-based chunking with overlap
 */
export function generateChunks(input: string, maxChunkSize: number = 800, overlap: number = 80): string[] {
  const sentences = input
    .trim()
    .split(/[.!?]+/)
    .filter((sentence) => sentence.trim().length > 0)
    .map((sentence) => sentence.trim() + ".");

  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += " " + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Resolve embedding model. Priority: OpenRouter → Google Gemini → OpenAI.
 * DB expects 3072-dim vectors (gemini-embedding-001); OpenAI small embeddings are 1536-dim.
 */
function getEmbeddingModel() {
  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (googleApiKey) {
    return createGoogleGenerativeAI({
      apiKey: googleApiKey,
    }).embedding("gemini-embedding-001");
  }

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    return createOpenAI({
      apiKey: openaiApiKey,
    }).embedding(DEFAULT_EMBEDDING_MODEL);
  }

  throw new Error(
    "No embedding provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY (RAG and material indexing require embeddings).",
  );
}

/**
 * Generate embeddings for multiple chunks (batched for large materials).
 */
export async function generateEmbeddings(
  chunks: string[],
): Promise<Array<{ embedding: number[]; content: string }>> {
  if (chunks.length === 0) return [];

  const embeddingModel = getEmbeddingModel();
  const out: Array<{ embedding: number[]; content: string }> = [];

  for (let i = 0; i < chunks.length; i += EMBED_MANY_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_MANY_BATCH_SIZE);
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: batch,
    });
    for (let j = 0; j < embeddings.length; j++) {
      out.push({ embedding: embeddings[j], content: batch[j] });
    }
  }

  return out;
}

/**
 * Generate a single embedding for a query (LRU-ish in-memory cache by normalized text).
 */
export async function generateEmbedding(query: string): Promise<number[]> {
  const cacheKey = normalizeQueryForCache(query);
  const now = Date.now();
  pruneQueryEmbedCache();
  const hit = queryEmbedCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.embedding;
  }

  const embeddingModel = getEmbeddingModel();

  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
  });

  queryEmbedCache.set(cacheKey, {
    embedding,
    expiresAt: now + QUERY_EMBED_CACHE_TTL_MS,
  });
  pruneQueryEmbedCache();

  return embedding;
}

/**
 * Find relevant content using cosine similarity search.
 * `similarityThreshold` defaults from env `RAG_SIMILARITY_THRESHOLD` (0–1) when omitted.
 */
export async function findRelevantContent(
  userQuery: string,
  courseId: string,
  limit: number = 6,
  similarityThreshold?: number,
): Promise<Array<{ content: string; similarity: number; materialTitle: string }>> {
  const threshold = similarityThreshold ?? getDefaultRagSimilarityThreshold();
  const queryEmbedding = await generateEmbedding(userQuery);

  const results = await prisma.$queryRaw<
    Array<{
      content: string;
      similarity: number;
      material_title: string;
    }>
  >`
    SELECT
      mc.content,
      1 - (me.embedding <=> ${queryEmbedding}::vector) AS similarity,
      cm.title as material_title
    FROM material_embeddings me
    JOIN material_chunks mc ON me."chunkId" = mc.id
    JOIN course_materials cm ON mc."materialId" = cm.id
    WHERE cm."courseId" = ${courseId}
      AND 1 - (me.embedding <=> ${queryEmbedding}::vector) > ${threshold}
    ORDER BY similarity DESC
    LIMIT ${Number(limit)}
  `;

  return results.map((result) => ({
    content: result.content,
    similarity: result.similarity,
    materialTitle: result.material_title,
  }));
}

/**
 * Process and store embeddings for a course material (single transaction).
 */
export async function processMaterialEmbeddings(materialId: string, content: string): Promise<void> {
  const chunks = generateChunks(content);

  if (chunks.length === 0) {
    throw new Error("No content chunks generated");
  }

  const embeddings = await generateEmbeddings(chunks);

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      const createdChunk = await tx.materialChunk.create({
        data: {
          materialId,
          index: i,
          content: chunks[i],
        },
      });
      await tx.$executeRaw`
        INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt")
        VALUES (${randomUUID()}, ${createdChunk.id}, ${embeddings[i].embedding}::vector, NOW())
      `;
    }
  });
}
