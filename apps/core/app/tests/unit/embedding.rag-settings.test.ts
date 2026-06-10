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

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn(), update: vi.fn() },
  $queryRaw: vi.fn(),
}));

const mockEmbedding = vi.hoisted(() => new Array(1024).fill(0.1));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

// Mock the AI SDK so generateEmbedding never hits the network.
vi.mock("ai", () => ({
  embed: vi.fn().mockResolvedValue({ embedding: mockEmbedding }),
  embedMany: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({ provider: "openai-mock", modelId: "text-embedding-3-small" })),
  })),
}));

// 1024-dim cloud path prefers OpenRouter/OpenAI over Google.
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
delete process.env.EMBEDDING_PROVIDER;

import { findRelevantContent } from "~/lib/ai/embedding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default course row returned by prisma — covers RAG + embedding settings lookups. */
function mockCourseRow(
  overrides: {
    ragTopK?: number | null;
    ragSimilarityThreshold?: number | null;
  } = {},
) {
  prismaMock.course.findUnique.mockResolvedValue({
    ragTopK: null,
    ragSimilarityThreshold: null,
    embeddingProvider: null,
    embeddingModel: null,
    embeddedWithProvider: null,
    embeddedWithModel: null,
    lastEmbeddedAt: null,
    ...overrides,
  });
}

/** Pull the interpolated values out of a tagged-template mock call. */
function getQueryArgs(callIndex = 0): unknown[] {
  // When $queryRaw is called as a tagged template literal,
  // mock.calls[n][0] is the TemplateStringsArray, and [1..n] are the interpolations.
  return prismaMock.$queryRaw.mock.calls[callIndex].slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Course-level ragTopK
// ---------------------------------------------------------------------------

describe("findRelevantContent — ragTopK", () => {
  it("uses course ragTopK when set, ignoring the caller-supplied limit", async () => {
    mockCourseRow({ ragTopK: 3, ragSimilarityThreshold: null });

    await findRelevantContent("test query", "course-1", 6);

    const args = getQueryArgs();
    // Last interpolated arg is Number(effectiveLimit)
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(3);
  });

  it("falls back to the caller-supplied limit when course ragTopK is null", async () => {
    mockCourseRow();

    await findRelevantContent("test query", "course-1", 8);

    const args = getQueryArgs();
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(8);
  });

  it("falls back to the default limit (6) when course ragTopK is null and no limit passed", async () => {
    mockCourseRow();

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    const limitArg = args[args.length - 1];
    expect(limitArg).toBe(6);
  });

  it("falls back gracefully when the course row does not exist (null from DB)", async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

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
    mockCourseRow({ ragSimilarityThreshold: 0.7 });

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    // Interpolation order: queryEmbedding, courseId, queryEmbedding, threshold, limit
    // threshold is the second-to-last arg
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.7);
  });

  it("falls back to the caller-supplied threshold when course value is null", async () => {
    mockCourseRow();

    await findRelevantContent("test query", "course-1", 6, 0.8);

    const args = getQueryArgs();
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.8);
  });

  it("falls back to the global env default (0.5) when course value and caller arg are both absent", async () => {
    mockCourseRow();
    delete process.env.RAG_SIMILARITY_THRESHOLD;

    await findRelevantContent("test query", "course-1");

    const args = getQueryArgs();
    const thresholdArg = args[args.length - 2];
    expect(thresholdArg).toBe(0.5);
  });

  it("reads RAG_SIMILARITY_THRESHOLD env var when course and caller values are absent", async () => {
    mockCourseRow();
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
    mockCourseRow();

    await findRelevantContent("test query", "course-abc");

    expect(prismaMock.course.findUnique).toHaveBeenCalledWith({
      where: { id: "course-abc" },
      select: { ragTopK: true, ragSimilarityThreshold: true },
    });
  });

  it("maps DB results to { content, similarity, materialTitle }", async () => {
    mockCourseRow();
    prismaMock.$queryRaw.mockResolvedValue([
      { content: "hello world", similarity: 0.9, material_title: "Lecture 1" },
    ]);

    const results = await findRelevantContent("test query", "course-1");

    expect(results).toEqual([
      { content: "hello world", similarity: 0.9, materialTitle: "Lecture 1" },
    ]);
  });
});
