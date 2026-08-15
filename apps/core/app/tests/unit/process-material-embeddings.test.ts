import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { prismaMock, txDeleteMany, txFindMany, txExecuteRaw, embedMany } = vi.hoisted(() => {
  const txDeleteMany = vi.fn();
  const txFindMany = vi.fn();
  const txExecuteRaw = vi.fn();
  const embedMany = vi.fn();

  const prismaMock = {
    courseMaterial: {
      findUnique: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        materialChunk: {
          deleteMany: txDeleteMany,
          findMany: txFindMany,
        },
        $executeRaw: txExecuteRaw,
      });
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

const { processMaterialEmbeddings } = await import("~/lib/ai/embedding");

const sampleEmbedding = new Array(1024).fill(0);

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
});
