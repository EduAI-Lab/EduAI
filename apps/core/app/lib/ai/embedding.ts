import { embed, embedMany, type EmbeddingModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import prisma from "../prisma.server";
import { randomUUID } from "crypto";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** pgvector column dimension — must match LOCAL-EMBEDDINGS and `EMBEDDING_DIMENSION`. */
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

/** Cloud Gemini default (legacy 3072 path — only if EMBEDDING_DIMENSION=3072). */
const DEFAULT_OPENROUTER_GEMINI_MODEL = "google/gemini-embedding-001";
/** Cloud OpenAI default for 1024-dim path (LOCAL-EMBEDDINGS). */
const DEFAULT_OPENROUTER_OPENAI_MODEL = "openai/text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";

/** Default Ollama embed model on cmps01 (LOCAL-EMBEDDINGS). */
const DEFAULT_OLLAMA_EMBEDDING_MODEL = "mxbai-embed-large";

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

export type EmbeddingProviderKind =
  | "ollama-local"
  | "openrouter"
  | "google"
  | "openai";

export function getExpectedEmbeddingDimension(): number {
  const raw = process.env.EMBEDDING_DIMENSION?.trim();
  if (!raw) return DEFAULT_EMBEDDING_DIMENSION;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EMBEDDING_DIMENSION;
  return Math.floor(n);
}

/** True when `EMBEDDING_PROVIDER` is `local` or `ollama`. */
export function wantsLocalEmbeddingProvider(): boolean {
  const provider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  return provider === "local" || provider === "ollama";
}

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

function logEmbeddingProvider(kind: EmbeddingProviderKind, detail?: string): void {
  console.log("[embedding]", {
    provider: kind,
    dimension: getExpectedEmbeddingDimension(),
    ...(detail ? { detail } : {}),
  });
}

function assertEmbeddingDimension(embedding: number[], context: string): void {
  const expected = getExpectedEmbeddingDimension();
  if (embedding.length !== expected) {
    throw new Error(
      `Embedding dimension mismatch in ${context}: got ${embedding.length}, expected ${expected}. ` +
        "Ensure EMBEDDING_PROVIDER, EMBEDDING_DIMENSION, and pgvector column match; re-embed materials after model changes.",
    );
  }
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

function resolveOllamaBaseUrl(): string {
  let baseURL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  if (!baseURL.endsWith("/api")) {
    baseURL = baseURL.replace(/\/$/, "") + "/api";
  }
  return baseURL;
}

function createOllamaEmbeddingClient() {
  return createOllama({ baseURL: resolveOllamaBaseUrl() });
}

function createOpenRouterEmbeddingClient() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;

  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    undefined;

  return createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      ...(referer ? { "HTTP-Referer": referer } : {}),
      "X-Title": process.env.OPENROUTER_APP_TITLE?.trim() || "EduAI",
    },
  });
}

function getOllamaEmbeddingModelId(): string {
  return process.env.OLLAMA_EMBEDDING_MODEL?.trim() || DEFAULT_OLLAMA_EMBEDDING_MODEL;
}

function getLocalEmbeddingModel(): { model: EmbeddingModel<string>; kind: EmbeddingProviderKind } {
  const ollama = createOllamaEmbeddingClient();
  const modelId = getOllamaEmbeddingModelId();
  logEmbeddingProvider("ollama-local", modelId);
  return { model: ollama.embedding(modelId), kind: "ollama-local" };
}

/**
 * Cloud embedding model for the configured dimension.
 * Resolution: OpenRouter → Google (3072 only) → OpenAI.
 */
function getCloudEmbeddingModel(): { model: EmbeddingModel<string>; kind: EmbeddingProviderKind } {
  const dimension = getExpectedEmbeddingDimension();

  if (dimension === 1024) {
    const openRouter = createOpenRouterEmbeddingClient();
    if (openRouter) {
      const modelId =
        process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_OPENROUTER_OPENAI_MODEL;
      logEmbeddingProvider("openrouter", modelId);
      return {
        model: openRouter.embedding(modelId, { dimensions: dimension }),
        kind: "openrouter",
      };
    }

    const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiApiKey) {
      logEmbeddingProvider("openai", DEFAULT_OPENAI_EMBEDDING_MODEL);
      return {
        model: createOpenAI({ apiKey: openaiApiKey }).embedding(
          DEFAULT_OPENAI_EMBEDDING_MODEL,
          { dimensions: dimension },
        ),
        kind: "openai",
      };
    }

    throw new Error(
      "No cloud embedding provider configured for 1024-dim vectors. Set OPENROUTER_API_KEY or OPENAI_API_KEY, or use EMBEDDING_PROVIDER=local with Ollama.",
    );
  }

  const openRouter = createOpenRouterEmbeddingClient();
  if (openRouter) {
    const modelId =
      process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_OPENROUTER_GEMINI_MODEL;
    logEmbeddingProvider("openrouter", modelId);
    return { model: openRouter.embedding(modelId), kind: "openrouter" };
  }

  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (googleApiKey) {
    logEmbeddingProvider("google", "gemini-embedding-001");
    return {
      model: createGoogleGenerativeAI({ apiKey: googleApiKey }).embedding("gemini-embedding-001"),
      kind: "google",
    };
  }

  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiApiKey) {
    logEmbeddingProvider("openai", DEFAULT_OPENAI_EMBEDDING_MODEL);
    return {
      model: createOpenAI({ apiKey: openaiApiKey }).embedding(DEFAULT_OPENAI_EMBEDDING_MODEL),
      kind: "openai",
    };
  }

  throw new Error(
    "No embedding provider configured. Set EMBEDDING_PROVIDER=local (Ollama), OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENAI_API_KEY in apps/core/.env.",
  );
}

/**
 * Resolve embedding model.
 * When EMBEDDING_PROVIDER=local|ollama: Ollama first; cloud chain on failure.
 * Otherwise: cloud chain only (OpenRouter → Google/OpenAI per dimension).
 */
async function resolveEmbeddingModel(): Promise<EmbeddingModel<string>> {
  if (wantsLocalEmbeddingProvider()) {
    try {
      return getLocalEmbeddingModel().model;
    } catch (err) {
      console.warn("[embedding] local provider setup failed, falling back to cloud", err);
    }

    try {
      return getCloudEmbeddingModel().model;
    } catch (cloudErr) {
      throw new Error(
        `Local embedding provider failed and cloud fallback is unavailable: ${cloudErr instanceof Error ? cloudErr.message : String(cloudErr)}`,
      );
    }
  }

  return getCloudEmbeddingModel().model;
}

async function embedWithProviderFallback<T>(
  run: (model: EmbeddingModel<string>) => Promise<T>,
): Promise<T> {
  if (!wantsLocalEmbeddingProvider()) {
    return run(await resolveEmbeddingModel());
  }

  try {
    const local = getLocalEmbeddingModel().model;
    return await run(local);
  } catch (localErr) {
    console.warn("[embedding] local embed failed, falling back to cloud", localErr);
    const cloud = getCloudEmbeddingModel().model;
    return run(cloud);
  }
}

/**
 * Generate embeddings for multiple chunks (batched for large materials).
 */
export async function generateEmbeddings(
  chunks: string[],
): Promise<Array<{ embedding: number[]; content: string }>> {
  if (chunks.length === 0) return [];

  const out: Array<{ embedding: number[]; content: string }> = [];

  for (let i = 0; i < chunks.length; i += EMBED_MANY_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_MANY_BATCH_SIZE);
    const { embeddings } = await embedWithProviderFallback((model) =>
      embedMany({ model, values: batch }),
    );
    for (let j = 0; j < embeddings.length; j++) {
      assertEmbeddingDimension(embeddings[j], "generateEmbeddings");
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

  const { embedding } = await embedWithProviderFallback((model) =>
    embed({ model, value: query }),
  );

  assertEmbeddingDimension(embedding, "generateEmbedding");

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
 * Delete all chunks (and embeddings) for a material so it can be re-indexed.
 */
export async function clearMaterialEmbeddings(materialId: string): Promise<void> {
  await prisma.materialChunk.deleteMany({ where: { materialId } });
}

/**
 * Re-embed all materials for a course that have stored raw text.
 */
export async function reEmbedCourseMaterials(courseId: string): Promise<{
  processed: number;
  failed: string[];
}> {
  const materials = await prisma.courseMaterial.findMany({
    where: { courseId, rawText: { not: null } },
    select: { id: true, rawText: true, title: true },
  });

  const failed: string[] = [];
  let processed = 0;

  for (const material of materials) {
    const content = material.rawText?.trim();
    if (!content) continue;

    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { status: "PROCESSING" },
    });

    try {
      await clearMaterialEmbeddings(material.id);
      await processMaterialEmbeddings(material.id, content);
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: "READY", processedAt: new Date() },
      });
      processed += 1;
      console.log("[embedding] re-embedded material", {
        courseId,
        materialId: material.id,
        title: material.title,
      });
    } catch (err) {
      failed.push(material.id);
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: "FAILED" },
      });
      console.error("[embedding] re-embed failed", {
        courseId,
        materialId: material.id,
        title: material.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, failed };
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
