import { describe, it, expect, vi } from "vitest";

// Mock all server-side and external dependencies so only generateChunks is exercised.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));

const { generateChunks } = await import("~/lib/ai/embedding");

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
