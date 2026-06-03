import { embed, embedMany, type EmbeddingModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import prisma from "../prisma.server";
import { randomUUID } from "crypto";
import {
  type EffectiveEmbeddingSettings,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_OPENAI_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  resolveEffectiveEmbeddingSettings,
} from "./embedding-config";
import { logReEmbedMaterialFailed, logReEmbedMaterialOk } from "./embedding-log.server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** pgvector column dimension — must match LOCAL-EMBEDDINGS and `EMBEDDING_DIMENSION`. */
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

/** Cloud Gemini default (legacy 3072 path — only if EMBEDDING_DIMENSION=3072). */
const DEFAULT_OPENROUTER_GEMINI_MODEL = "google/gemini-embedding-001";

/** Max inputs per `embedMany` batch for cloud providers. */
const CLOUD_EMBED_MANY_BATCH_SIZE = Math.min(
  128,
  Math.max(8, Number(process.env.EMBED_MANY_BATCH_SIZE) || 64),
);

/** Ollama often returns HTTP 400 if a batch is too large; start small (split retries on Bad Request). */
const LOCAL_EMBED_MANY_BATCH_SIZE = Math.min(
  32,
  Math.max(1, Number(process.env.OLLAMA_EMBED_MANY_BATCH_SIZE) || 8),
);

function resolveEmbedManyBatchSize(wantsLocal: boolean): number {
  return wantsLocal ? LOCAL_EMBED_MANY_BATCH_SIZE : CLOUD_EMBED_MANY_BATCH_SIZE;
}

function isOllamaBadRequestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /bad request/i.test(message);
}

/** Split batch on Ollama 400 until each chunk embeds or a single chunk fails. */
async function embedManyOllamaWithSplit(
  model: EmbeddingModel<string>,
  values: string[],
): Promise<number[][]> {
  if (values.length === 0) return [];

  try {
    const { embeddings } = await embedMany({ model, values });
    return embeddings;
  } catch (err) {
    if (values.length <= 1 || !isOllamaBadRequestError(err)) {
      throw err;
    }
    const mid = Math.floor(values.length / 2);
    const left = await embedManyOllamaWithSplit(model, values.slice(0, mid));
    const right = await embedManyOllamaWithSplit(model, values.slice(mid));
    return [...left, ...right];
  }
}

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

export {
  ALLOWED_CLOUD_EMBEDDING_MODELS,
  ALLOWED_LOCAL_EMBEDDING_MODELS,
  isEmbeddingIndexStale,
  parseEmbeddingSettingsUpdate,
  resolveEffectiveEmbeddingSettings,
  validateEmbeddingSettingsUpdate,
  type CourseEmbeddingFields,
  type EffectiveEmbeddingSettings,
} from "./embedding-config";

export function getExpectedEmbeddingDimension(): number {
  const raw = process.env.EMBEDDING_DIMENSION?.trim();
  if (!raw) return DEFAULT_EMBEDDING_DIMENSION;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EMBEDDING_DIMENSION;
  return Math.floor(n);
}

/** True when global `EMBEDDING_PROVIDER` is `local` or `ollama`. */
export function wantsLocalEmbeddingProvider(): boolean {
  const provider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  return provider === "local" || provider === "ollama";
}

function normalizeQueryForCache(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 12_000);
}

function queryCacheKey(
  courseId: string | undefined,
  settings: EffectiveEmbeddingSettings,
  query: string,
): string {
  return `${courseId ?? "global"}:${settings.provider}:${settings.model}:${normalizeQueryForCache(query)}`;
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

function logEmbeddingProvider(
  kind: EmbeddingProviderKind,
  settings: EffectiveEmbeddingSettings,
  detail?: string,
): void {
  console.log("[embedding]", {
    provider: kind,
    dimension: getExpectedEmbeddingDimension(),
    courseProvider: settings.provider,
    model: settings.model,
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

const courseSettingsCache = new Map<
  string,
  { settings: EffectiveEmbeddingSettings; expiresAt: number }
>();
const COURSE_SETTINGS_CACHE_TTL_MS = 30_000;

async function loadEffectiveEmbeddingSettings(
  courseId?: string,
): Promise<EffectiveEmbeddingSettings> {
  if (!courseId) {
    return resolveEffectiveEmbeddingSettings(null);
  }

  const now = Date.now();
  const cached = courseSettingsCache.get(courseId);
  if (cached && cached.expiresAt > now) {
    return cached.settings;
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      embeddingProvider: true,
      embeddingModel: true,
      embeddedWithProvider: true,
      embeddedWithModel: true,
      lastEmbeddedAt: true,
    },
  });

  const settings = resolveEffectiveEmbeddingSettings(course);
  courseSettingsCache.set(courseId, {
    settings,
    expiresAt: now + COURSE_SETTINGS_CACHE_TTL_MS,
  });
  return settings;
}

export function clearCourseEmbeddingSettingsCache(courseId?: string): void {
  if (courseId) {
    courseSettingsCache.delete(courseId);
    return;
  }
  courseSettingsCache.clear();
}

/**
 * Generate chunks from text content
 * Simple sentence-based chunking with overlap
 */
export function generateChunks(
  input: string,
  maxChunkSize: number = 800,
  overlap: number = 80,
): string[] {
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

function getLocalEmbeddingModel(
  settings: EffectiveEmbeddingSettings,
): { model: EmbeddingModel<string>; kind: EmbeddingProviderKind } {
  const ollama = createOllamaEmbeddingClient();
  const modelId = settings.model || DEFAULT_OLLAMA_EMBEDDING_MODEL;
  logEmbeddingProvider("ollama-local", settings, modelId);
  return { model: ollama.embedding(modelId), kind: "ollama-local" };
}

/**
 * Cloud embedding model for the configured dimension.
 * Resolution: OpenRouter → Google (3072 only) → OpenAI.
 */
function getCloudEmbeddingModel(
  settings: EffectiveEmbeddingSettings,
): { model: EmbeddingModel<string>; kind: EmbeddingProviderKind } {
  const dimension = getExpectedEmbeddingDimension();

  if (dimension === 1024) {
    const openRouter = createOpenRouterEmbeddingClient();
    const modelId = settings.model || DEFAULT_OPENROUTER_OPENAI_MODEL;

    if (openRouter && modelId.startsWith("openai/")) {
      logEmbeddingProvider("openrouter", settings, modelId);
      return {
        model: openRouter.embedding(modelId, { dimensions: dimension }),
        kind: "openrouter",
      };
    }

    const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
    const directModel =
      modelId === DEFAULT_OPENAI_EMBEDDING_MODEL || !modelId.startsWith("openai/")
        ? DEFAULT_OPENAI_EMBEDDING_MODEL
        : modelId.replace(/^openai\//, "");

    if (openaiApiKey) {
      logEmbeddingProvider("openai", settings, directModel);
      return {
        model: createOpenAI({ apiKey: openaiApiKey }).embedding(directModel, {
          dimensions: dimension,
        }),
        kind: "openai",
      };
    }

    if (openRouter) {
      logEmbeddingProvider("openrouter", settings, DEFAULT_OPENROUTER_OPENAI_MODEL);
      return {
        model: openRouter.embedding(DEFAULT_OPENROUTER_OPENAI_MODEL, { dimensions: dimension }),
        kind: "openrouter",
      };
    }

    throw new Error(
      "No cloud embedding provider configured for 1024-dim vectors. Set OPENROUTER_API_KEY or OPENAI_API_KEY, or use EMBEDDING_PROVIDER=local with Ollama.",
    );
  }

  const openRouter = createOpenRouterEmbeddingClient();
  if (openRouter) {
    const modelId =
      settings.model || process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || DEFAULT_OPENROUTER_GEMINI_MODEL;
    logEmbeddingProvider("openrouter", settings, modelId);
    return { model: openRouter.embedding(modelId), kind: "openrouter" };
  }

  const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (googleApiKey) {
    logEmbeddingProvider("google", settings, "gemini-embedding-001");
    return {
      model: createGoogleGenerativeAI({ apiKey: googleApiKey }).embedding("gemini-embedding-001"),
      kind: "google",
    };
  }

  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiApiKey) {
    logEmbeddingProvider("openai", settings, DEFAULT_OPENAI_EMBEDDING_MODEL);
    return {
      model: createOpenAI({ apiKey: openaiApiKey }).embedding(DEFAULT_OPENAI_EMBEDDING_MODEL),
      kind: "openai",
    };
  }

  throw new Error(
    "No embedding provider configured. Set EMBEDDING_PROVIDER=local (Ollama), OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or OPENAI_API_KEY in apps/core/.env.",
  );
}

async function embedWithConfiguredProvider<T>(
  run: (model: EmbeddingModel<string>) => Promise<T>,
  courseId?: string,
): Promise<T> {
  const settings = await loadEffectiveEmbeddingSettings(courseId);
  const model = settings.wantsLocal
    ? getLocalEmbeddingModel(settings).model
    : getCloudEmbeddingModel(settings).model;

  try {
    return await run(model);
  } catch (err) {
    if (settings.wantsLocal) {
      throw new Error(
        `Local embedding provider failed (${settings.model}). Index and query must use the same model space; fix Ollama or switch the course to cloud. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Generate embeddings for multiple chunks (batched for large materials).
 */
export async function generateEmbeddings(
  chunks: string[],
  courseId?: string,
): Promise<Array<{ embedding: number[]; content: string }>> {
  if (chunks.length === 0) return [];

  const settings = await loadEffectiveEmbeddingSettings(courseId);
  const batchSize = resolveEmbedManyBatchSize(settings.wantsLocal);
  const out: Array<{ embedding: number[]; content: string }> = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const embeddings = await embedWithConfiguredProvider(async (model) => {
      if (settings.wantsLocal) {
        return embedManyOllamaWithSplit(model, batch);
      }
      const result = await embedMany({ model, values: batch });
      return result.embeddings;
    }, courseId);

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
export async function generateEmbedding(query: string, courseId?: string): Promise<number[]> {
  const settings = await loadEffectiveEmbeddingSettings(courseId);
  const cacheKey = queryCacheKey(courseId, settings, query);
  const now = Date.now();
  pruneQueryEmbedCache();
  const hit = queryEmbedCache.get(cacheKey);
  if (hit && hit.expiresAt > now) {
    return hit.embedding;
  }

  const { embedding } = await embedWithConfiguredProvider(
    (model) => embed({ model, value: query }),
    courseId,
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
  const queryEmbedding = await generateEmbedding(userQuery, courseId);

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

async function markCourseEmbedded(courseId: string): Promise<void> {
  clearCourseEmbeddingSettingsCache(courseId);
  const settings = await loadEffectiveEmbeddingSettings(courseId);
  await prisma.course.update({
    where: { id: courseId },
    data: {
      embeddedWithProvider: settings.provider,
      embeddedWithModel: settings.model,
      lastEmbeddedAt: new Date(),
    },
  });
}

export type ReEmbedProgress = {
  total: number;
  processed: number;
  failed: string[];
  currentMaterialTitle?: string;
};

export type ReEmbedCourseMaterialsOptions = {
  onProgress?: (progress: ReEmbedProgress) => void | Promise<void>;
};

/**
 * Re-embed all materials for a course that have stored raw text.
 */
export async function reEmbedCourseMaterials(
  courseId: string,
  options?: ReEmbedCourseMaterialsOptions,
): Promise<{
  processed: number;
  failed: string[];
  total: number;
}> {
  const materials = await prisma.courseMaterial.findMany({
    where: { courseId, rawText: { not: null } },
    select: { id: true, rawText: true, title: true },
  });

  const eligible = materials.filter((m) => m.rawText?.trim());
  const failed: string[] = [];
  let processed = 0;

  const reportProgress = async (currentMaterialTitle?: string) => {
    await options?.onProgress?.({
      total: eligible.length,
      processed,
      failed: [...failed],
      currentMaterialTitle,
    });
  };

  await reportProgress();

  for (const material of eligible) {
    const content = material.rawText!.trim();

    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { status: "PROCESSING" },
    });
    await reportProgress(material.title);

    try {
      await clearMaterialEmbeddings(material.id);
      await processMaterialEmbeddings(material.id, content);
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { status: "READY", processedAt: new Date() },
      });
      processed += 1;
      await logReEmbedMaterialOk({
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
      await logReEmbedMaterialFailed({
        courseId,
        materialId: material.id,
        title: material.title,
        err,
      });
    }

    await reportProgress();
  }

  if (processed > 0 && failed.length === 0 && processed === eligible.length) {
    await markCourseEmbedded(courseId);
  }

  return { processed, failed, total: eligible.length };
}

/**
 * Process and store embeddings for a course material (single transaction).
 */
export async function processMaterialEmbeddings(materialId: string, content: string): Promise<void> {
  const material = await prisma.courseMaterial.findUnique({
    where: { id: materialId },
    select: { courseId: true },
  });

  if (!material) {
    throw new Error(`Course material not found: ${materialId}`);
  }

  const chunks = generateChunks(content);

  if (chunks.length === 0) {
    throw new Error("No content chunks generated");
  }

  const embeddings = await generateEmbeddings(chunks, material.courseId);

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
