import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock, txDeleteMany, txFindMany, txExecuteRaw, embedMany } = vi.hoisted(() => {
  const txDeleteMany = vi.fn();
  const txFindMany = vi.fn();
  const txExecuteRaw = vi.fn();
  const embedMany = vi.fn();

  // The chunk rewrite runs inside one transaction; the mock hands the callback
  // this client so the per-model assertions below apply to it.
  const txClient = {
    materialChunk: {
      deleteMany: txDeleteMany,
      findMany: txFindMany,
    },
    $executeRaw: txExecuteRaw,
  };

  const prismaMock = {
    courseMaterial: {
      findUnique: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<void>) => {
      await fn(txClient);
    }),
  };

  return { prismaMock, txDeleteMany, txFindMany, txExecuteRaw, embedMany };
});

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({})),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

const { processMaterialEmbeddings, INDEXING_RETRY_BUDGET, REQUEST_RETRY_BUDGET } =
  await import("~/lib/ai/embedding");

const sampleEmbedding = Array.from({ length: 1024 }, () => 0);

describe("processMaterialEmbeddings", () => {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.courseMaterial.findUnique.mockResolvedValue({ courseId: "course-1" });
    prismaMock.course.findUnique.mockResolvedValue({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.OPENAI_API_KEY = "test-key";
    txExecuteRaw.mockResolvedValue(1);
    txFindMany.mockResolvedValue([{ id: "chunk-1", index: 0 }]);
    embedMany.mockResolvedValue({ embeddings: [sampleEmbedding] });
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = originalProvider;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it("does not clear existing chunks when embedding generation fails (replace mode)", async () => {
    embedMany.mockRejectedValue(new Error("Ollama timeout"));

    await expect(
      processMaterialEmbeddings("mat-1", "Hello world.", { replace: true }),
    ).rejects.toThrow("Ollama timeout");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txDeleteMany).not.toHaveBeenCalled();
  });

  it("clears existing chunks inside the transaction after embeddings succeed (replace mode)", async () => {
    await processMaterialEmbeddings("mat-1", "Hello world.", { replace: true });

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { materialId: "mat-1" } });
    expect(txExecuteRaw).toHaveBeenCalled();
    expect(txFindMany).toHaveBeenCalled();
  });

  it("does not delete existing chunks on first ingest (no replace option)", async () => {
    await processMaterialEmbeddings("mat-1", "Hello world.");

    expect(txDeleteMany).not.toHaveBeenCalled();
    expect(txExecuteRaw).toHaveBeenCalled();
    expect(txFindMany).toHaveBeenCalled();
  });

  it("throws when chunking yields zero segments (whitespace-only content) (#225 RAG-06)", async () => {
    await expect(processMaterialEmbeddings("mat-1", "   \n\t  ")).rejects.toThrow(
      "No content chunks generated",
    );

    expect(embedMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // ── #1791: indexing waits out a rate limit; a request path does not ─────────
  //
  // `retryTransientEmbeddingError` used to apply one budget everywhere: three
  // attempts, ~1.5s of backoff. That is the right call for a chat turn embedding
  // a query, and the wrong one for a background job holding a 15-minute
  // extraction lease — it turned an ordinary burst of provider 429s into a
  // terminally FAILED material the instructor then could not retry at all.
  //
  // The budget's *size* is asserted against the exported constants rather than by
  // burning through it: the waits are real, and exhausting eight attempts would
  // put a minute of sleeping into the unit suite.
  describe("transient-retry budget", () => {
    function rateLimited() {
      return Object.assign(new Error("rate limited"), { status: 429 });
    }

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("gives indexing a far longer budget than the request path", () => {
      expect(INDEXING_RETRY_BUDGET.maxAttempts).toBeGreaterThan(REQUEST_RETRY_BUDGET.maxAttempts);
      // Enough waiting to outlast a provider burst, and still a small fraction of
      // the 15-minute extraction lease the job holds.
      const worstCaseMs =
        INDEXING_RETRY_BUDGET.maxDelayMs * (INDEXING_RETRY_BUDGET.maxAttempts - 1);
      expect(worstCaseMs).toBeGreaterThan(30_000);
      expect(worstCaseMs).toBeLessThan(5 * 60_000);
    });

    // The backoff is real (1s + 2s + 4s here), so this one buys its own timeout
    // rather than pretending the waits are free.
    it("retries past the three attempts a request path would allow", async () => {
      // Three straight 429s: the old shared budget would already have failed
      // the material here, with nothing in the UI to say it was a rate limit.
      embedMany
        .mockRejectedValueOnce(rateLimited())
        .mockRejectedValueOnce(rateLimited())
        .mockRejectedValueOnce(rateLimited())
        .mockResolvedValue({ embeddings: [sampleEmbedding] });

      await processMaterialEmbeddings("mat-1", "Hello world.");

      expect(embedMany).toHaveBeenCalledTimes(4);
      expect(txExecuteRaw).toHaveBeenCalled();
    }, 20_000);

    it("does not retry a failure that retrying cannot fix", async () => {
      embedMany.mockReset();
      embedMany.mockRejectedValue(new Error("Embedding dimension mismatch"));

      await expect(processMaterialEmbeddings("mat-1", "Hello world.")).rejects.toThrow(
        /dimension mismatch/,
      );
      // A dimension mismatch is configuration, not load; retrying is pure delay.
      expect(embedMany).toHaveBeenCalledTimes(1);
    });
  });
});
