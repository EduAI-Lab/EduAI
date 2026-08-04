// @vitest-environment node
/**
 * Unit tests for the course-level RAG settings path in findRelevantContent.
 *
 * Resolution order under test:
 *   1. courseSettings.ragTopK / ragSimilarityThreshold (highest priority)
 *   2. caller-supplied limit / similarityThreshold arguments
 *   3. global env default (RAG_SIMILARITY_THRESHOLD, falls back to 0.5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that pull in the modules
// ---------------------------------------------------------------------------

// Mock getCourseRagSettings directly — this keeps the embedding tests isolated
// from the cache layer and avoids cross-test state bleed through the module-level Map.
const getCourseRagSettingsMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/courses/server", () => ({
  getCourseRagSettings: getCourseRagSettingsMock,
}));

const queryRawMock = vi.hoisted(() => vi.fn());
const executeRawUnsafeMock = vi.hoisted(() => vi.fn());
const courseFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $queryRaw: queryRawMock,
    $executeRawUnsafe: executeRawUnsafeMock,
    // findRelevantContent (#940) wraps `SET LOCAL ivfflat.probes` + the query in
    // a transaction so both run on the same pooled connection. The real
    // PrismaClient accepts an array of pending raw-query promises; mimic that by
    // resolving each entry and returning the results array.
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    // loadEffectiveEmbeddingSettings inside generateEmbedding also hits prisma.course.findUnique
    // (for embeddingProvider / embeddingModel). Return null so it falls through to server defaults.
    course: { findUnique: courseFindUniqueMock },
  },
}));

// Mock the AI SDK so generateEmbedding never hits the network.
vi.mock("ai", () => ({
  embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
  embedMany: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    embedding: vi.fn(() => ({ provider: "google-mock", modelId: "gemini-embedding-001" })),
  })),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({ provider: "openai-mock", modelId: "text-embedding-3-small" })),
  })),
}));

// Provide a fake API key so getEmbeddingModel() takes the Google branch.
// EMBEDDING_DIMENSION=3 keeps the expected dimension in sync with our 3-value mock
// embedding and forces getCloudEmbeddingModel into the non-1024 branch that actually
// uses Google (the 1024 branch only accepts OpenRouter / OpenAI).
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
process.env.EMBEDDING_DIMENSION = "3";

import { findRelevantContent } from "~/lib/ai/embedding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the interpolated values out of a tagged-template mock call. */
function getQueryArgs(callIndex = 0): unknown[] {
  // When $queryRaw is called as a tagged template literal,
  // mock.calls[n][0] is the TemplateStringsArray, and [1..n] are the interpolations.
  return queryRawMock.mock.calls[callIndex].slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([]);
  // loadEffectiveEmbeddingSettings needs a course row; null = use server-level defaults.
  courseFindUniqueMock.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Course-level ragTopK
// ---------------------------------------------------------------------------

describe("findRelevantContent — ragTopK", () => {
  it("uses course ragTopK when set, ignoring the caller-supplied limit", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: 3,
      ragSimilarityThreshold: null,
    });

    await findRelevantContent("test query", "course-1", 6);

    const args = getQueryArgs();
    // Last interpolated arg is Number(effectiveLimit)
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(3);
  });

  it("falls back to the caller-supplied limit when course ragTopK is null", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });

    await findRelevantContent("test query", "course-1", 8);

    const args = getQueryArgs();
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(8);
  });

  it("falls back to the default limit (6) when course ragTopK is null and no limit passed", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(6);
  });

  it("falls back gracefully when the course row does not exist (null from DB)", async () => {
    getCourseRagSettingsMock.mockResolvedValue(null);

    await findRelevantContent("test query", "missing-course", 4);

    const args = getQueryArgs();
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Course-level ragSimilarityThreshold
// ---------------------------------------------------------------------------

describe("findRelevantContent — ragSimilarityThreshold", () => {
  it("uses course ragSimilarityThreshold when set", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: 0.7,
    });

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    // Interpolation order: queryEmbedding, courseId, queryEmbedding, threshold, limit
    // threshold is the second-to-last arg
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.7);
  });

  it("falls back to the caller-supplied threshold when course value is null", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });

    await findRelevantContent("test query", "course-1", 6, 0.8);

    const args = getQueryArgs();
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.8);
  });

  it("falls back to the global env default (0.5) when course value and caller arg are both absent", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });
    delete process.env.RAG_SIMILARITY_THRESHOLD;

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.5);
  });

  it("reads RAG_SIMILARITY_THRESHOLD env var when course and caller values are absent", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });
    process.env.RAG_SIMILARITY_THRESHOLD = "0.65";

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.65);

    delete process.env.RAG_SIMILARITY_THRESHOLD;
  });
});

// ---------------------------------------------------------------------------
// getCourseRagSettings is called with the correct courseId
// ---------------------------------------------------------------------------

describe("findRelevantContent — DB lookup", () => {
  it("calls prisma.course.findUnique with the correct courseId to fetch settings", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });

    await findRelevantContent("test query", "course-abc");

    // getCourseRagSettings is mocked at the module boundary; verify it was called
    // with the correct courseId — the cache + DB logic is tested separately.
    expect(getCourseRagSettingsMock).toHaveBeenCalledWith("course-abc");
  });

  it("maps DB results to { content, similarity, materialTitle }", async () => {
    getCourseRagSettingsMock.mockResolvedValue({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });
    queryRawMock.mockResolvedValue([
      { content: "hello world", similarity: 0.9, material_title: "Lecture 1" },
    ]);

    const results = await findRelevantContent("test query", "course-1");

    expect(results).toEqual([
      { content: "hello world", similarity: 0.9, materialTitle: "Lecture 1" },
    ]);
  });
});
