import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// Mock all server-side and external dependencies so only chunk helpers are exercised.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({})),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

const {
  generateChunks,
  resolveMaterialChunks,
  getExpectedEmbeddingDimension,
  wantsLocalEmbeddingProvider,
  resolveIvfflatProbes,
  DEFAULT_EMBEDDING_DIMENSION,
  classifyRagRetrievalError,
} = await import("~/lib/ai/embedding");
const { SEMANTIC_CHUNK_SEPARATOR, joinSemanticChunks, applyChunkOverlap } = await import("~/lib/ai/file-processing");

const sampleEmbedding = new Array(1024).fill(0);

function mockIndexedEmbeddings(values: string[]) {
  return values.map((value) => {
    const embedding = [...sampleEmbedding];
    const index = Number(String(value).replace("chunk-", ""));
    embedding[0] = Number.isFinite(index) ? index : 0;
    return embedding;
  });
}

// ---------------------------------------------------------------------------
// generateChunks
// ---------------------------------------------------------------------------

describe("generateChunks", () => {
  it("returns an empty array for an empty string", () => {
    expect(generateChunks("")).toEqual([]);
  });

  it("returns a single chunk when content is shorter than maxChunkSize", () => {
    const chunks = generateChunks("Short sentence.", 800);
    expect(chunks).toHaveLength(1);
  });

  it("no chunk in the output exceeds maxChunkSize characters", () => {
    const longText = "This is a sentence. ".repeat(200);
    const chunks = generateChunks(longText, 200);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200 + 50); // small margin for overlap words
    }
  });

  it("applies overlap: the start of chunk N+1 shares words with the end of chunk N", () => {
    const longText = "This is a sentence. ".repeat(100);
    const chunks = generateChunks(longText, 100, 40);
    if (chunks.length > 1) {
      const endWords = chunks[0].split(" ").slice(-3).join(" ");
      expect(chunks[1]).toContain(endWords.split(" ")[0]);
    }
  });

  it("handles content with no sentence-ending punctuation without throwing", () => {
    expect(() => generateChunks("no punctuation here at all", 800)).not.toThrow();
  });

  it("splits slide-deck text without punctuation into bounded chunks", () => {
    const slides = "Topic line without periods\n".repeat(400);
    const chunks = generateChunks(slides, 200, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("trims whitespace from each chunk", () => {
    const chunks = generateChunks("  Hello world.  Goodbye world.  ", 800);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });
});

// ---------------------------------------------------------------------------
// generateEmbeddings
// ---------------------------------------------------------------------------

describe("generateEmbeddings", () => {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const originalBatchSize = process.env.EMBED_MANY_BATCH_SIZE;

  let generateEmbeddings: typeof import("~/lib/ai/embedding").generateEmbeddings;
  let embedManyMock: Mock;

  async function reloadEmbeddingModule() {
    vi.resetModules();
    const aiMod = await import("ai");
    const embeddingMod = await import("~/lib/ai/embedding");
    embedManyMock = vi.mocked(aiMod.embedMany);
    generateEmbeddings = embeddingMod.generateEmbeddings;
    embedManyMock.mockImplementation(async ({ values }) => ({
      embeddings: mockIndexedEmbeddings(values as string[]),
    }));
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.EMBED_MANY_BATCH_SIZE;
    await reloadEmbeddingModule();
  });

  afterEach(() => {
    vi.resetModules();
    if (originalProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = originalProvider;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleKey;
    if (originalBatchSize === undefined) delete process.env.EMBED_MANY_BATCH_SIZE;
    else process.env.EMBED_MANY_BATCH_SIZE = originalBatchSize;
  });

  it("returns an empty array for no chunks", async () => {
    await expect(generateEmbeddings([])).resolves.toEqual([]);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it("never sends more than 100 chunks in a single embedMany call (provider limit)", async () => {
    const chunks = Array.from({ length: 250 }, (_, i) => `chunk-${i}`);

    const result = await generateEmbeddings(chunks);

    expect(embedManyMock).toHaveBeenCalled();
    for (const call of embedManyMock.mock.calls) {
      expect(call[0].values.length).toBeLessThanOrEqual(100);
    }
    expect(embedManyMock.mock.calls.some((call) => call[0].values.length === 250)).toBe(false);
    expect(result).toHaveLength(250);
  });

  it("splits 101 chunks using the default cloud batch size (64)", async () => {
    const chunks = Array.from({ length: 101 }, (_, i) => `chunk-${i}`);

    await generateEmbeddings(chunks);

    expect(embedManyMock).toHaveBeenCalledTimes(2);
    expect(embedManyMock.mock.calls[0][0].values).toHaveLength(64);
    expect(embedManyMock.mock.calls[1][0].values).toHaveLength(37);
  });

  it("splits 101 chunks at the provider cap boundary (100 + 1)", async () => {
    process.env.EMBED_MANY_BATCH_SIZE = "100";
    await reloadEmbeddingModule();

    const chunks = Array.from({ length: 101 }, (_, i) => `chunk-${i}`);

    await generateEmbeddings(chunks);

    expect(embedManyMock).toHaveBeenCalledTimes(2);
    expect(embedManyMock.mock.calls[0][0].values).toHaveLength(100);
    expect(embedManyMock.mock.calls[1][0].values).toHaveLength(1);
  });

  it("preserves chunk order across batches", async () => {
    const chunks = Array.from({ length: 150 }, (_, i) => `chunk-${i}`);

    const result = await generateEmbeddings(chunks);

    expect(result[0]).toEqual({ embedding: mockIndexedEmbeddings(["chunk-0"])[0], content: "chunk-0" });
    expect(result[64]).toEqual({
      embedding: mockIndexedEmbeddings(["chunk-64"])[0],
      content: "chunk-64",
    });
    expect(result[149]).toEqual({
      embedding: mockIndexedEmbeddings(["chunk-149"])[0],
      content: "chunk-149",
    });
  });

  it("caps EMBED_MANY_BATCH_SIZE env override at the provider limit of 100", async () => {
    process.env.EMBED_MANY_BATCH_SIZE = "128";
    await reloadEmbeddingModule();

    const chunks = Array.from({ length: 150 }, (_, i) => `chunk-${i}`);

    await generateEmbeddings(chunks);

    expect(embedManyMock).toHaveBeenCalledTimes(2);
    expect(embedManyMock.mock.calls[0][0].values).toHaveLength(100);
    expect(embedManyMock.mock.calls[1][0].values).toHaveLength(50);
    for (const call of embedManyMock.mock.calls) {
      expect(call[0].values.length).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveMaterialChunks
// ---------------------------------------------------------------------------

describe("resolveMaterialChunks", () => {
  it("preserves semantic chunks when the upload-path separator is present", () => {
    const semantic = ["# Section 1\n\nIntro text.", "# Section 2\n\nMore text."];
    const overlapped = applyChunkOverlap(semantic);
    const content = joinSemanticChunks(overlapped);

    expect(resolveMaterialChunks(content)).toEqual(overlapped);
  });

  it("round-trips overlapped upload chunks without breaking the separator", () => {
    const semantic = [
      "First chunk with enough words to produce meaningful overlap at the boundary.",
      "Second chunk starts fresh but should receive overlap from the first chunk.",
    ];
    const overlapped = applyChunkOverlap(semantic, 80);
    const content = joinSemanticChunks(overlapped);
    const resolved = resolveMaterialChunks(content);

    expect(resolved).toEqual(overlapped);
    expect(resolved).toHaveLength(2);
    if (resolved.length > 1) {
      const endWord = semantic[0].split(" ").at(-1)!;
      expect(resolved[1]).toContain(endWord);
    }
  });

  it("falls back to generateChunks when no separator is present", () => {
    const content = "Short sentence.";
    expect(resolveMaterialChunks(content)).toEqual(generateChunks(content));
  });

  it("returns an empty array when content is only separators and whitespace", () => {
    const content = joinSemanticChunks(["", "   "]);
    expect(resolveMaterialChunks(content)).toEqual([]);
  });

  it("uses the shared separator constant from file-processing", () => {
    expect(SEMANTIC_CHUNK_SEPARATOR).toBe("--- CHUNK SEPARATOR ---");
  });
});

// ---------------------------------------------------------------------------
// embedding provider config helpers
// ---------------------------------------------------------------------------

describe("getExpectedEmbeddingDimension", () => {
  const original = process.env.EMBEDDING_DIMENSION;

  afterEach(() => {
    if (original === undefined) delete process.env.EMBEDDING_DIMENSION;
    else process.env.EMBEDDING_DIMENSION = original;
  });

  it("defaults to 1024 (local embedding dimension)", () => {
    delete process.env.EMBEDDING_DIMENSION;
    expect(getExpectedEmbeddingDimension()).toBe(DEFAULT_EMBEDDING_DIMENSION);
    expect(DEFAULT_EMBEDDING_DIMENSION).toBe(1024);
  });

  it("reads EMBEDDING_DIMENSION from env", () => {
    process.env.EMBEDDING_DIMENSION = "768";
    expect(getExpectedEmbeddingDimension()).toBe(768);
  });

  it("falls back when env is invalid", () => {
    process.env.EMBEDDING_DIMENSION = "not-a-number";
    expect(getExpectedEmbeddingDimension()).toBe(1024);
  });
});

describe("wantsLocalEmbeddingProvider", () => {
  const original = process.env.EMBEDDING_PROVIDER;

  afterEach(() => {
    if (original === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = original;
  });

  it("returns true for local and ollama", () => {
    process.env.EMBEDDING_PROVIDER = "local";
    expect(wantsLocalEmbeddingProvider()).toBe(true);
    process.env.EMBEDDING_PROVIDER = "ollama";
    expect(wantsLocalEmbeddingProvider()).toBe(true);
  });

  it("returns false for cloud or unset", () => {
    process.env.EMBEDDING_PROVIDER = "cloud";
    expect(wantsLocalEmbeddingProvider()).toBe(false);
    delete process.env.EMBEDDING_PROVIDER;
    expect(wantsLocalEmbeddingProvider()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveIvfflatProbes (#940)
// ---------------------------------------------------------------------------

describe("resolveIvfflatProbes", () => {
  const original = process.env.RAG_IVFFLAT_PROBES;

  afterEach(() => {
    if (original === undefined) delete process.env.RAG_IVFFLAT_PROBES;
    else process.env.RAG_IVFFLAT_PROBES = original;
  });

  it("returns the default of 10 when unset", () => {
    delete process.env.RAG_IVFFLAT_PROBES;
    expect(resolveIvfflatProbes()).toBe(10);
  });

  it("returns the default when the value is not a finite number", () => {
    process.env.RAG_IVFFLAT_PROBES = "not-a-number";
    expect(resolveIvfflatProbes()).toBe(10);
  });

  it("returns the default when the value is zero or negative", () => {
    process.env.RAG_IVFFLAT_PROBES = "0";
    expect(resolveIvfflatProbes()).toBe(10);
    process.env.RAG_IVFFLAT_PROBES = "-5";
    expect(resolveIvfflatProbes()).toBe(10);
  });

  it("honors a valid override within range", () => {
    process.env.RAG_IVFFLAT_PROBES = "25";
    expect(resolveIvfflatProbes()).toBe(25);
  });

  it("rounds fractional overrides", () => {
    process.env.RAG_IVFFLAT_PROBES = "12.6";
    expect(resolveIvfflatProbes()).toBe(13);
  });

  it("clamps overrides above the max to 100", () => {
    process.env.RAG_IVFFLAT_PROBES = "9999";
    expect(resolveIvfflatProbes()).toBe(100);
  });

  it("clamps overrides below the min to 1", () => {
    process.env.RAG_IVFFLAT_PROBES = "0.4";
    expect(resolveIvfflatProbes()).toBe(1);
  });
});

// classifyRagRetrievalError (#225 RAG-01/RAG-02)
// ---------------------------------------------------------------------------

describe("classifyRagRetrievalError", () => {
  it("classifies assertEmbeddingDimension's message as RAG_DIMENSION_MISMATCH", () => {
    const err = new Error(
      "Embedding dimension mismatch in generateEmbedding: got 768, expected 1024.",
    );
    expect(classifyRagRetrievalError(err)).toBe("RAG_DIMENSION_MISMATCH");
  });

  it("classifies a pgvector dimension error as RAG_DIMENSION_MISMATCH", () => {
    const err = new Error('different vector dimensions 1024 and 768');
    expect(classifyRagRetrievalError(err)).toBe("RAG_DIMENSION_MISMATCH");
  });

  it("classifies a provider-down failure as RAG_RETRIEVAL_FAILED", () => {
    const err = new Error("Local embedding provider failed (mxbai-embed-large). fetch failed");
    expect(classifyRagRetrievalError(err)).toBe("RAG_RETRIEVAL_FAILED");
  });

  it("classifies a non-Error throw as RAG_RETRIEVAL_FAILED", () => {
    expect(classifyRagRetrievalError("network down")).toBe("RAG_RETRIEVAL_FAILED");
  });
});
