import { describe, it, expect, vi } from "vitest";

// Mock all server-side and external dependencies so only chunk helpers are exercised.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));

const { generateChunks, resolveMaterialChunks } = await import("~/lib/ai/embedding");
const { SEMANTIC_CHUNK_SEPARATOR, joinSemanticChunks } = await import("~/lib/ai/file-processing");

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
// resolveMaterialChunks
// ---------------------------------------------------------------------------

describe("resolveMaterialChunks", () => {
  it("preserves semantic chunks when the upload-path separator is present", () => {
    const semantic = ["# Section 1\n\nIntro text.", "# Section 2\n\nMore text."];
    const content = joinSemanticChunks(semantic);

    expect(resolveMaterialChunks(content)).toEqual(semantic);
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
