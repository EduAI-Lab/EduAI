// @vitest-environment node
/**
 * Unit tests for the hybrid BM25+vector retrieval path in findRelevantContent (#432).
 *
 * Covers:
 *  - isHybridBm25Enabled() reads RAG_HYBRID_BM25 correctly
 *  - RAG_HYBRID_BM25=1 → ANN vector candidates followed by hybrid reranking
 *  - RAG_HYBRID_BM25 unset → ANN vector candidates followed by thresholding
 *  - RAG_HYBRID_BM25_ALPHA env var adjusts the vector/BM25 weights
 *  - Return shape is identical ({content, similarity, materialTitle}) regardless of path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

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
    course: { findUnique: courseFindUniqueMock },
  },
}));

// embed returns 3 elements to match EMBEDDING_DIMENSION=3 set below.
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
    embedding: vi.fn(() => ({ provider: "openai-mock" })),
  })),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => ({ embedding: vi.fn(() => ({})) })),
}));

// Force cloud path (non-1024 branch → Google) so generateEmbedding goes through
// the AI SDK embed mock instead of Ollama's native fetch.
// Match EMBEDDING_DIMENSION to the 3-element embedding returned by the mock above.
process.env.EMBEDDING_PROVIDER = "cloud";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
process.env.EMBEDDING_DIMENSION = "3";
delete process.env.OLLAMA_BASE_URL;

// ── Module import (after mocks) ───────────────────────────────────────────────

const { findRelevantContent, isHybridBm25Enabled, resolveIvfflatProbes } =
  await import("~/lib/ai/embedding");

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Join the TemplateStringsArray from a $queryRaw tagged-template call so we can
 * assert that the correct SQL fragments are present.
 * calls[n][0] is the TemplateStringsArray; [1..] are interpolated values.
 */
function capturedSql(callIndex = 0): string {
  const [templateStrings] = queryRawMock.mock.calls[callIndex] as [string[]];
  return templateStrings.join("__param__");
}

/** Interpolated values passed to $queryRaw (everything after the template strings). */
function capturedParams(callIndex = 0): unknown[] {
  return (queryRawMock.mock.calls[callIndex] as unknown[]).slice(1);
}

const COURSE_ID = "course-test-1";
const QUERY = "What is assignment 4 about?";

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  getCourseRagSettingsMock.mockResolvedValue({ ragTopK: null, ragSimilarityThreshold: null });
  courseFindUniqueMock.mockResolvedValue(null);
  delete process.env.RAG_HYBRID_BM25;
  delete process.env.RAG_HYBRID_BM25_ALPHA;
});

afterEach(() => {
  delete process.env.RAG_HYBRID_BM25;
  delete process.env.RAG_HYBRID_BM25_ALPHA;
  delete process.env.RAG_IVFFLAT_PROBES;
});

describe("resolveIvfflatProbes()", () => {
  it("caps probes below the migration's 100 IVFFlat lists", () => {
    process.env.RAG_IVFFLAT_PROBES = "100";
    expect(resolveIvfflatProbes()).toBe(99);
  });
});

// ── isHybridBm25Enabled ───────────────────────────────────────────────────────

describe("isHybridBm25Enabled()", () => {
  it('returns true when RAG_HYBRID_BM25="1"', () => {
    process.env.RAG_HYBRID_BM25 = "1";
    expect(isHybridBm25Enabled()).toBe(true);
  });

  it("returns false when RAG_HYBRID_BM25 is not set", () => {
    expect(isHybridBm25Enabled()).toBe(false);
  });

  it('returns false for any value other than "1"', () => {
    process.env.RAG_HYBRID_BM25 = "true";
    expect(isHybridBm25Enabled()).toBe(false);
    process.env.RAG_HYBRID_BM25 = "0";
    expect(isHybridBm25Enabled()).toBe(false);
  });
});

// ── Hybrid BM25 path ─────────────────────────────────────────────────────────

describe("findRelevantContent — hybrid path (RAG_HYBRID_BM25=1)", () => {
  beforeEach(() => {
    process.env.RAG_HYBRID_BM25 = "1";
    queryRawMock.mockResolvedValue([
      { content: "Assignment 4 covers BFS and DFS.", score: 0.85, material_title: "Assignment 4" },
      { content: "Graph traversal algorithms.", score: 0.72, material_title: "Week 9 Lecture" },
    ]);
  });

  it("uses ts_rank and plainto_tsquery in the SQL", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).toContain("ts_rank");
    expect(sql).toContain("plainto_tsquery");
    expect(sql).toContain("to_tsvector");
  });

  it("uses an ANN-compatible vector candidate query before hybrid reranking", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).toContain("WITH vector_candidates AS MATERIALIZED");
    expect(sql).toMatch(
      /ORDER BY me\.embedding <=> __param__::vector ASC\s+LIMIT __param__/,
    );
    expect(sql.indexOf("ORDER BY me.embedding <=>")).toBeLessThan(
      sql.indexOf("ORDER BY score DESC"),
    );
    expect(sql).toContain("ORDER BY score DESC");
    expect(sql).toContain("WHERE 1 - distance >");
    expect(capturedParams()).toContain(16);
  });

  it("uses bounded iterative ANN scanning so course filters retain recall", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(executeRawUnsafeMock).toHaveBeenCalledWith(
      "SET LOCAL ivfflat.iterative_scan = relaxed_order",
    );
    expect(executeRawUnsafeMock).toHaveBeenCalledWith("SET LOCAL ivfflat.max_probes = 99");
  });

  // #315: soft-deleted materials must never leak into RAG context, including on
  // the hybrid path (the pure-vector path already filtered this).
  it('filters soft-deleted materials with cm."deletedAt" IS NULL', async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).toContain('cm."deletedAt" IS NULL');
  });

  it("passes the effective similarity threshold to the hybrid query", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4, 0.62);
    const params = capturedParams();
    expect(params).toContain(0.62);
  });

  it("maps the score column to the similarity field in the returned shape", async () => {
    const results = await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      content: "Assignment 4 covers BFS and DFS.",
      similarity: 0.85,
      materialTitle: "Assignment 4",
    });
    expect(results[1]).toEqual({
      content: "Graph traversal algorithms.",
      similarity: 0.72,
      materialTitle: "Week 9 Lecture",
    });
  });

  it("defaults to alpha=0.7 (vector) and bm25Weight=0.3", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const params = capturedParams();
    const queryParamIndex = params.indexOf(QUERY);
    expect(params[queryParamIndex - 1]).toBeCloseTo(0.7);
    expect(params[queryParamIndex + 1]).toBeCloseTo(0.3);
  });

  it("respects RAG_HYBRID_BM25_ALPHA for the vector/BM25 weight split", async () => {
    process.env.RAG_HYBRID_BM25_ALPHA = "0.5";
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const params = capturedParams();
    const queryParamIndex = params.indexOf(QUERY);
    expect(params[queryParamIndex - 1]).toBeCloseTo(0.5);
    expect(params[queryParamIndex + 1]).toBeCloseTo(0.5);
  });

  it("respects the caller-supplied limit", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 6);
    const params = capturedParams();
    expect(params[params.length - 1]).toBe(6);
  });

  it("respects per-course ragTopK override over the caller limit", async () => {
    getCourseRagSettingsMock.mockResolvedValue({ ragTopK: 2, ragSimilarityThreshold: null });
    await findRelevantContent(QUERY, COURSE_ID, 6);
    const params = capturedParams();
    expect(params[params.length - 1]).toBe(2);
  });

  it("excludes deleted and unpublished materials from the SQL filter", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).toContain('cm."deletedAt" IS NULL');
    expect(capturedFragmentSql()).toContain('cm."unpublishedAt" IS NULL');
  });

  it("excludes materials whose Canvas file is in CanvasMaterialExclusion (retroactive exclusion)", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const frag = capturedFragmentSql();
    expect(frag).toContain("NOT EXISTS");
    expect(frag).toContain("canvas_material_exclusions");
  });
});

// ── Pure-vector path (baseline) ───────────────────────────────────────────────

describe("findRelevantContent — pure-vector path (RAG_HYBRID_BM25 not set)", () => {
  beforeEach(() => {
    queryRawMock.mockResolvedValue([
      { content: "Dijkstra finds shortest paths.", similarity: 0.91, material_title: "Week 9 Lecture" },
    ]);
  });

  it("does not use ts_rank or plainto_tsquery", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).not.toContain("ts_rank");
    expect(sql).not.toContain("plainto_tsquery");
  });

  it("orders ANN candidates by cosine distance before applying the threshold", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const sql = capturedSql();
    expect(sql).toContain("WITH vector_candidates AS MATERIALIZED");
    expect(sql).toMatch(
      /ORDER BY me\.embedding <=> __param__::vector ASC\s+LIMIT __param__/,
    );
    expect(sql).toContain("WHERE 1 - distance >");
    expect(sql).toContain("ORDER BY distance ASC");
  });

  it("uses bounded iterative ANN scanning before applying the course filter", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(executeRawUnsafeMock).toHaveBeenCalledWith(
      "SET LOCAL ivfflat.iterative_scan = relaxed_order",
    );
    expect(executeRawUnsafeMock).toHaveBeenCalledWith("SET LOCAL ivfflat.max_probes = 99");
  });

  it("maps the similarity column correctly", async () => {
    const results = await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(results[0]).toEqual({
      content: "Dijkstra finds shortest paths.",
      similarity: 0.91,
      materialTitle: "Week 9 Lecture",
    });
  });

  it("excludes unpublished materials from the SQL filter", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(capturedFragmentSql()).toContain('cm."unpublishedAt" IS NULL');
  });

  it("excludes materials whose Canvas file is in CanvasMaterialExclusion (retroactive exclusion)", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    const frag = capturedFragmentSql();
    expect(frag).toContain("NOT EXISTS");
    expect(frag).toContain("canvas_material_exclusions");
  });
});

// ── Student-visibility gate (#839) ────────────────────────────────────────────

/**
 * Concatenate the SQL text of every Prisma.Sql fragment interpolated into the
 * query. Duck-typed on `.strings` (a Prisma.Sql fragment) rather than
 * `instanceof`, which isn't reliable across the generated client build.
 */
function capturedFragmentSql(callIndex = 0): string {
  return capturedParams(callIndex)
    .filter(
      (p): p is { strings: string[] } =>
        typeof p === "object" &&
        p !== null &&
        Array.isArray((p as { strings?: unknown }).strings),
    )
    .map((f) => f.strings.join(" "))
    .join(" ");
}

describe("findRelevantContent — student-visibility gate (#839)", () => {
  beforeEach(() => {
    queryRawMock.mockResolvedValue([]);
  });

  it("excludes hidden/scheduled materials when restrictToStudentVisible=true (pure-vector)", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4, undefined, true);
    const frag = capturedFragmentSql();
    expect(frag).toContain('"visibleToStudents"');
    expect(frag).toContain('"availableAt"');
    expect(frag).toContain("NOW()");
  });

  it("excludes hidden/scheduled materials when restrictToStudentVisible=true (hybrid)", async () => {
    process.env.RAG_HYBRID_BM25 = "1";
    await findRelevantContent(QUERY, COURSE_ID, 4, undefined, true);
    const frag = capturedFragmentSql();
    expect(frag).toContain('"visibleToStudents"');
    expect(frag).toContain('"availableAt"');
  });

  it("does not restrict visibility for staff callers (default)", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(capturedFragmentSql()).not.toContain("visibleToStudents");
  });

  it("always filters soft-deleted materials in BOTH paths", async () => {
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(capturedSql()).toContain('cm."deletedAt" IS NULL');

    vi.clearAllMocks();
    queryRawMock.mockResolvedValue([]);
    process.env.RAG_HYBRID_BM25 = "1";
    await findRelevantContent(QUERY, COURSE_ID, 4);
    expect(capturedSql()).toContain('cm."deletedAt" IS NULL');
  });
});
