import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/courses/server", () => ({ getCourseRagSettings: vi.fn() }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import { generateEmbeddings } from "~/lib/ai/embedding";

describe("native Ollama embedding auth", () => {
  const originalEnv = process.env;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EMBEDDING_PROVIDER: "local",
      EMBEDDING_DIMENSION: "1024",
      OLLAMA_BASE_URL: "http://cmps01.ok.ubc.ca:8001/ollama",
      CMPS01_INTERNAL_KEY: "test-internal-key",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [new Array(1024).fill(0)] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sends the internal key through the direct /api/embed fetch", async () => {
    await generateEmbeddings(["define a bit"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://cmps01.ok.ubc.ca:8001/ollama/api/embed",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-EduAI-Internal-Key": "test-internal-key",
        }),
      }),
    );
  });
});
