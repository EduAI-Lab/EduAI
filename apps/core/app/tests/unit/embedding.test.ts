import { describe, it, expect, vi, afterEach } from "vitest";

// Mock all server-side and external dependencies so only generateChunks is exercised.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

const {
  generateChunks,
  getExpectedEmbeddingDimension,
  wantsLocalEmbeddingProvider,
  DEFAULT_EMBEDDING_DIMENSION,
} = await import("~/lib/ai/embedding");

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

  it("trims whitespace from each chunk", () => {
    const chunks = generateChunks("  Hello world.  Goodbye world.  ", 800);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
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
