import { embed, embedMany, type EmbeddingModel } from "ai";
import { Prisma } from "@prisma/client";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import pLimit from "p-limit";
import { cmps01InternalAuthHeadersForUrl } from "~/lib/ai/cmps01-internal-auth.server";
import { parseEnvInt } from "~/lib/auth/rate-limit.server";
import prisma from "../prisma.server";
import { getCourseRagSettings } from "../courses/server";
import { randomUUID } from "crypto";
import { SEMANTIC_CHUNK_SEPARATOR } from "./file-processing";
import {
  type EffectiveEmbeddingSettings,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENROUTER_OPENAI_MODEL,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  resolveEffectiveEmbeddingSettings,
} from "./embedding-config";
import { formatPgVectorLiteral } from "./pgvector";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Provider hard limit (e.g. Google Gemini embedMany — "At most 100 requests per batch"). */
const CLOUD_EMBED_MANY_MAX_BATCH_SIZE = 100;

/** pgvector column dimension — must match LOCAL-EMBEDDINGS and `EMBEDDING_DIMENSION`. */
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

/** Cloud Gemini default (legacy 3072 path — only if EMBEDDING_DIMENSION=3072). */
const DEFAULT_OPENROUTER_GEMINI_MODEL = "google/gemini-embedding-001";

/** Max inputs per `embedMany` batch for cloud providers (env override, capped at provider limit). */
const CLOUD_EMBED_MANY_BATCH_SIZE = Math.min(
  CLOUD_EMBED_MANY_MAX_BATCH_SIZE,
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

/**
 * Default number of materials re-embedded concurrently in `reEmbedCourseMaterials`
 * (#945). Kept modest (rather than unbounded `Promise.all`) so a large re-embed run
 * doesn't exhaust the Postgres connection pool or burst past the embedding
 * provider's rate limit — each in-flight material holds a `prisma.$transaction`
 * connection plus an `embedMany` call for the duration of its chunking/embedding
 * work. Mirrors the same "small bounded pool, env-overridable" pattern as
 * `AI_MAX_INFLIGHT` in admission.server.ts. Override via `REINDEX_CONCURRENCY`.
 */
const DEFAULT_REINDEX_CONCURRENCY = 4;

function reindexConcurrency(): number {
  return Math.max(1, parseEnvInt(process.env.REINDEX_CONCURRENCY, DEFAULT_REINDEX_CONCURRENCY));
}

function isOllamaBadRequestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /bad request/i.test(message) || /\b400\b/.test(message);
}

function isOllamaContextLengthError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /context length/i.test(message) || /input length exceeds/i.test(message);
}

function isOllamaSplittableError(err: unknown): boolean {
  return isOllamaBadRequestError(err) || isOllamaContextLengthError(err);
}

/**
 * Local Ollama (mxbai-embed-large): call POST /api/embed directly; batch-split on HTTP 400.
 * Slide decks often have no `.`/`!`/`?` — sentence chunking used one oversized chunk and hit
 * "input length exceeds the context length"; use smaller char-based chunks (default 480).
 */
const DEFAULT_OLLAMA_CHUNK_CHARS = 480;

function resolveChunkParams(wantsLocal: boolean): { maxChunkSize: number; overlap: number } {
  if (!wantsLocal) {
    return { maxChunkSize: 800, overlap: 80 };
  }
  const maxChunkSize = Math.min(
    800,
    Math.max(128, Number(process.env.OLLAMA_EMBED_CHUNK_SIZE) || DEFAULT_OLLAMA_CHUNK_CHARS),
  );
  const overlap = Math.min(
    maxChunkSize - 1,
    Math.max(0, Number(process.env.OLLAMA_EMBED_CHUNK_OVERLAP) || 48),
  );
  return { maxChunkSize, overlap };
}

function chunkTextBySize(text: string, maxChunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChunkSize, text.length);
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function enforceMaxChunkSize(
  chunks: string[],
  maxChunkSize: number,
  overlap: number,
): string[] {
  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChunkSize) {
      out.push(chunk);
    } else {
      out.push(...chunkTextBySize(chunk, maxChunkSize, overlap));
    }
  }
  return out;
}

function ollamaEmbedEndpoint(): string {
  return `${resolveOllamaBaseUrl()}/embed`;
}

/** Native Ollama `/api/embed` (same contract as `curl`); avoids AI SDK provider batch quirks. */
async function fetchOllamaEmbeddings(
  modelId: string,
  values: string[],
): Promise<number[][]> {
  const res = await fetch(ollamaEmbedEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...cmps01InternalAuthHeadersForUrl(resolveOllamaBaseUrl()),
    },
    body: JSON.stringify({
      model: modelId,
      input: values.length === 1 ? values[0] : values,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  const embeddings = data.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== values.length) {
    throw new Error(
      `Ollama embed response invalid (expected ${values.length} vectors, got ${embeddings?.length ?? 0})`,
    );
  }
  return embeddings;
}

function sanitizeTextForOllamaEmbed(text: string): string {
  return text.replace(/\0/g, "");
}

/** Split batch on Ollama 400 until each chunk embeds or a single chunk fails. */
async function embedManyOllamaNative(modelId: string, values: string[]): Promise<number[][]> {
  if (values.length === 0) return [];
  const sanitized = values.map(sanitizeTextForOllamaEmbed);

  try {
    return await fetchOllamaEmbeddings(modelId, sanitized);
  } catch (err) {
    if (values.length <= 1 || !isOllamaSplittableError(err)) {
      throw err;
    }
    const mid = Math.floor(values.length / 2);
    const left = await embedManyOllamaNative(modelId, values.slice(0, mid));
    const right = await embedManyOllamaNative(modelId, values.slice(mid));
    return [...left, ...right];
  }
}

function wrapLocalEmbeddingError(modelId: string, err: unknown): Error {
  return new Error(
    `Local embedding provider failed (${modelId}). Index and query must use the same model space; fix Ollama or switch the course to cloud. ${err instanceof Error ? err.message : String(err)}`,
    { cause: err },
  );
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

/**
 * True when RAG_HYBRID_BM25=1 is set.
 * Exported so callers and tests can inspect the active strategy without
 * reading process.env directly.
 */
export function isHybridBm25Enabled(): boolean {
  return process.env.RAG_HYBRID_BM25 === "1";
}

/**
 * Vector weight (α) for hybrid BM25+vector scoring: score = α·vec + (1-α)·bm25.
 * Defaults to 0.7; override with RAG_HYBRID_BM25_ALPHA (0–1 exclusive).
 */
function getHybridAlpha(): number {
  const raw = process.env.RAG_HYBRID_BM25_ALPHA?.trim();
  if (!raw) return 0.7;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return 0.7;
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
  const trimmed = input.trim();
  if (!trimmed) return [];

  const parts = trimmed
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // Slide decks / bullet lists often have no sentence endings — one giant "sentence" otherwise.
  if (parts.length <= 1 && trimmed.length > maxChunkSize) {
    return chunkTextBySize(trimmed, maxChunkSize, overlap);
  }

  const sentences = parts.map((part) => (part.endsWith(".") ? part : `${part}.`));

  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());

      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return enforceMaxChunkSize(chunks, maxChunkSize, overlap);
}

function resolveOllamaBaseUrl(): string {
  let baseURL = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  if (!baseURL.endsWith("/api")) {
    baseURL = baseURL.replace(/\/$/, "") + "/api";
  }
  return baseURL;
}

function createOllamaEmbeddingClient() {
  return createOllama({
    baseURL: resolveOllamaBaseUrl(),
    headers: cmps01InternalAuthHeadersForUrl(resolveOllamaBaseUrl()),
  });
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

/** Resolve ingest chunks: preserve upload-path semantic chunks or fall back to sentence splitting. */
export function resolveMaterialChunks(
  content: string,
  maxChunkSize: number = 800,
  overlap: number = 80,
): string[] {
  if (content.includes(SEMANTIC_CHUNK_SEPARATOR)) {
    return content
      .split(SEMANTIC_CHUNK_SEPARATOR)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);
  }

  return generateChunks(content, maxChunkSize, overlap);
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
    const embeddings = settings.wantsLocal
      ? await embedManyOllamaNative(settings.model, batch).catch((err) => {
          throw wrapLocalEmbeddingError(settings.model, err);
        })
      : await embedWithConfiguredProvider(async (model) => {
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

  const embedding = settings.wantsLocal
    ? (
        await embedManyOllamaNative(settings.model, [query]).catch((err) => {
          throw wrapLocalEmbeddingError(settings.model, err);
        })
      )[0]
    : (
        await embedWithConfiguredProvider((model) => embed({ model, value: query }), courseId)
      ).embedding;

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
 *
 * Resolution order for each tunable:
 *   1. Course-level setting (`ragTopK` / `ragSimilarityThreshold` on the Course row) — wins when non-null.
 *   2. Caller-supplied `limit` / `similarityThreshold` arguments.
 *   3. Global env default (`RAG_SIMILARITY_THRESHOLD`, falls back to 0.5).
 *
 * This lets individual courses be tuned independently without touching global config.
 *
 * `restrictToStudentVisible` (#839): when true (student callers), materials that
 * are hidden from students or scheduled for a future reveal are excluded from
 * retrieval, so chat can't surface content the student isn't meant to see yet.
 * Staff callers pass false and get everything.
 */
export async function findRelevantContent(
  userQuery: string,
  courseId: string,
  limit: number = 6,
  similarityThreshold?: number,
  restrictToStudentVisible: boolean = false,
): Promise<Array<{ content: string; similarity: number; materialTitle: string }>> {
  // Fetch per-course RAG overrides; both fields are nullable — null means "use default".
  const courseSettings = await getCourseRagSettings(courseId);
  const effectiveLimit = courseSettings?.ragTopK ?? limit;
  const threshold =
    courseSettings?.ragSimilarityThreshold ?? similarityThreshold ?? getDefaultRagSimilarityThreshold();

  const queryEmbedding = formatPgVectorLiteral(await generateEmbedding(userQuery, courseId));

  // Canvas publish-aware gate (#777): always hide unpublished / selectively
  // excluded Canvas materials from RAG for every caller.
  const canvasPublishFilter = Prisma.sql`
    AND cm."unpublishedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM canvas_material_exclusions cme
      WHERE cme."courseId" = cm."courseId" AND cme."canvasFileId" = cm."externalId"
    )
  `;

  // §839 student-visibility gate, injected into both retrieval paths. Empty for
  // staff callers so their retrieval is unchanged.
  const visibilityFilter = restrictToStudentVisible
    ? Prisma.sql`AND cm."visibleToStudents" = true AND (cm."availableAt" IS NULL OR cm."availableAt" <= NOW())`
    : Prisma.empty;

  if (isHybridBm25Enabled()) {
    const alpha = getHybridAlpha();
    const bm25Weight = 1 - alpha;

    // Hybrid path: weighted sum of vector cosine similarity and BM25 (ts_rank).
    // Same vector similarity floor as the pure-vector path; combined score ranks survivors.
    // to_tsvector / plainto_tsquery are built-in PostgreSQL; no extra extension needed.
    const hybridResults = await prisma.$queryRaw<
      Array<{ content: string; score: number; material_title: string }>
    >`
      SELECT
        mc.content,
        cm.title AS material_title,
        (1 - (me.embedding <=> ${queryEmbedding}::vector)) * ${alpha} +
        COALESCE(
          ts_rank(
            to_tsvector('english', mc.content),
            plainto_tsquery('english', ${userQuery})
          ),
          0
        ) * ${bm25Weight} AS score
      FROM material_embeddings me
      JOIN material_chunks mc ON me."chunkId" = mc.id
      JOIN course_materials cm ON mc."materialId" = cm.id
      WHERE cm."courseId" = ${courseId}
        AND cm."deletedAt" IS NULL
        ${canvasPublishFilter}
        ${visibilityFilter}
        AND 1 - (me.embedding <=> ${queryEmbedding}::vector) > ${threshold}
      ORDER BY score DESC
      LIMIT ${Number(effectiveLimit)}
    `;

    return hybridResults.map((r) => ({
      content: r.content,
      similarity: Number(r.score),
      materialTitle: r.material_title,
    }));
  }

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
      AND cm."deletedAt" IS NULL
      ${canvasPublishFilter}
      ${visibilityFilter}
      AND 1 - (me.embedding <=> ${queryEmbedding}::vector) > ${threshold}
    ORDER BY similarity DESC
    LIMIT ${Number(effectiveLimit)}
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
    where: { courseId, deletedAt: null, rawText: { not: null } },
    select: { id: true, rawText: true, title: true },
  });

  const eligible = materials.filter((m) => m.rawText?.trim());
  const failed: string[] = [];
  let processed = 0;

  // Progress is reported after every state transition (started/finished), so
  // operators still see live counts even though completion order is no longer
  // strictly sequential under concurrency. `currentMaterialTitle` reflects the
  // most recently *started* material rather than a single in-flight item.
  const reportProgress = async (currentMaterialTitle?: string) => {
    await options?.onProgress?.({
      total: eligible.length,
      processed,
      failed: [...failed],
      currentMaterialTitle,
    });
  };

  await reportProgress();

  // Bounded concurrency (#945): each material is fully independent (its own
  // transaction, its own row), so materials run concurrently up to
  // `reindexConcurrency()` in-flight at a time. Each task is individually
  // try/caught so one material's failure never cancels or blocks its siblings —
  // same isolation semantics as the previous serial for-loop.
  const limit = pLimit(reindexConcurrency());

  await Promise.all(
    eligible.map((material) =>
      limit(async () => {
        const content = material.rawText!.trim();

        await prisma.courseMaterial.update({
          where: { id: material.id },
          data: { status: "PROCESSING" },
        });
        await reportProgress(material.title);

        try {
          await processMaterialEmbeddings(material.id, content, { replace: true });
          await prisma.courseMaterial.update({
            where: { id: material.id },
            data: { status: "READY", processedAt: new Date() },
          });
          processed += 1;
        } catch (err) {
          failed.push(material.id);
          await prisma.courseMaterial.update({
            where: { id: material.id },
            data: { status: "FAILED" },
          });
          console.error("[re-embed] material failed", {
            courseId,
            materialId: material.id,
            title: material.title,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        await reportProgress();
      }),
    ),
  );

  if (processed > 0 && failed.length === 0 && processed === eligible.length) {
    await markCourseEmbedded(courseId);
  }

  return { processed, failed, total: eligible.length };
}

export type ProcessMaterialEmbeddingsOptions = {
  /** Delete existing chunks only after new embeddings succeed, inside the same transaction. */
  replace?: boolean;
};

/**
 * Process and store embeddings for a course material (single transaction).
 */
export async function processMaterialEmbeddings(
  materialId: string,
  content: string,
  options?: ProcessMaterialEmbeddingsOptions,
): Promise<void> {
  const material = await prisma.courseMaterial.findUnique({
    where: { id: materialId },
    select: { courseId: true },
  });

  if (!material) {
    throw new Error(`Course material not found: ${materialId}`);
  }

  const settings = await loadEffectiveEmbeddingSettings(material.courseId);
  const { maxChunkSize, overlap } = resolveChunkParams(settings.wantsLocal);
  const chunks = resolveMaterialChunks(content, maxChunkSize, overlap);

  if (chunks.length === 0) {
    throw new Error("No content chunks generated");
  }

  const embeddings = await generateEmbeddings(chunks, material.courseId);

  await prisma.$transaction(async (tx) => {
    if (options?.replace) {
      await tx.materialChunk.deleteMany({ where: { materialId } });
    }

    const createdChunks = await tx.materialChunk.createManyAndReturn({
      data: chunks.map((chunkContent, i) => ({ materialId, index: i, content: chunkContent })),
    });

    const chunksByIndex = [...createdChunks].sort((a, b) => a.index - b.index);

    for (let i = 0; i < chunksByIndex.length; i++) {
      const vectorLiteral = formatPgVectorLiteral(embeddings[i].embedding);
      await tx.$executeRaw`
        INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt")
        VALUES (${randomUUID()}, ${chunksByIndex[i].id}, ${vectorLiteral}::vector, NOW())
      `;
    }
  });
}
