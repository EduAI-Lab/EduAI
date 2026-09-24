import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all server-side and external dependencies so reEmbedCourseMaterials runs
// its real bounded-concurrency loop against a fully controllable "cloud" embed
// path (embedMany from "ai") and an in-memory prisma double.
vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findUnique: vi.fn(), update: vi.fn() },
    courseMaterial: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    materialChunk: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("ai", () => ({ embed: vi.fn(), embedMany: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn((modelId: string) => ({ modelId })),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

const { reEmbedCourseMaterials, clearCourseEmbeddingSettingsCache, ReEmbedInterruptedError } =
  await import("~/lib/ai/embedding");
const prisma = (await import("~/lib/prisma.server")).default as any;
const { embedMany } = await import("ai");

const embedManyMock = vi.mocked(embedMany);

const SAMPLE_EMBEDDING = Array.from({ length: 1024 }, () => 0.1);

type Material = { id: string; rawText: string | null; title: string };

function mockMaterials(materials: Material[]) {
  prisma.courseMaterial.findMany.mockResolvedValue(
    materials.map((m) => ({ id: m.id, rawText: m.rawText, title: m.title })),
  );
  prisma.courseMaterial.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(materials.some((m) => m.id === where.id) ? { courseId: "course-1" } : null),
  );
}

function setupTransactionMock() {
  prisma.$transaction.mockImplementation(async (fn: any) => {
    // #941: material_chunks.content_tsv is a generated column, so the real
    // code inserts chunks via a raw $executeRaw statement and reads them
    // back with materialChunk.findMany rather than createManyAndReturn.
    let insertedChunks: Array<{ id: string; index: number }> = [];
    const tx = {
      materialChunk: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockImplementation(() => Promise.resolve(insertedChunks)),
      },
      $executeRaw: vi.fn().mockImplementation((..._args: unknown[]) => {
        // Chunk count/materialId aren't inspectable from the tagged-template
        // call site here, so seed a single chunk per invocation — enough for
        // these tests, which only assert on processed/failed counts.
        insertedChunks = [{ id: `chunk-${insertedChunks.length}`, index: insertedChunks.length }];
        return Promise.resolve(undefined);
      }),
    };
    return fn(tx);
  });
}

describe("reEmbedCourseMaterials concurrency (#945)", () => {
  const originalConcurrency = process.env.REINDEX_CONCURRENCY;
  const originalEmbeddingDimension = process.env.EMBEDDING_DIMENSION;
  const originalEmbeddingProvider = process.env.EMBEDDING_PROVIDER;
  // #1792: Vitest loads apps/core/.env into process.env, and that file sets
  // OPENROUTER_API_KEY. getCloudEmbeddingModel resolves OpenRouter before
  // OpenAI, so a leaked key silently moved these tests onto the OpenRouter
  // branch — which passes the model id through provider-qualified instead of
  // stripping the `openai/` prefix, failing the snapshot test on any machine
  // with an .env while staying green in CI, which has none.
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const originalVllmEmbeddingBaseUrl = process.env.VLLM_EMBEDDING_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCourseEmbeddingSettingsCache();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.VLLM_EMBEDDING_BASE_URL;
    process.env.EMBEDDING_DIMENSION = "1024";
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.OPENAI_API_KEY = "test-key";
    prisma.course.findUnique.mockResolvedValue({
      embeddingProvider: "cloud",
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });
    prisma.courseMaterial.update.mockResolvedValue({});
    prisma.course.update.mockResolvedValue({});
    setupTransactionMock();
  });

  afterEach(() => {
    if (originalConcurrency === undefined) delete process.env.REINDEX_CONCURRENCY;
    else process.env.REINDEX_CONCURRENCY = originalConcurrency;
    if (originalEmbeddingDimension === undefined) delete process.env.EMBEDDING_DIMENSION;
    else process.env.EMBEDDING_DIMENSION = originalEmbeddingDimension;
    if (originalEmbeddingProvider === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = originalEmbeddingProvider;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleKey;
    if (originalVllmEmbeddingBaseUrl === undefined) delete process.env.VLLM_EMBEDDING_BASE_URL;
    else process.env.VLLM_EMBEDDING_BASE_URL = originalVllmEmbeddingBaseUrl;
    delete process.env.OPENAI_API_KEY;
  });

  it("never runs more than REINDEX_CONCURRENCY materials at once", async () => {
    process.env.REINDEX_CONCURRENCY = "3";

    const materials: Material[] = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i}`,
      rawText: `content ${i}`,
      title: `Material ${i}`,
    }));
    mockMaterials(materials);

    let inFlight = 0;
    let maxInFlight = 0;

    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    const result = await reEmbedCourseMaterials("course-1");

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // proves it's actually concurrent, not serial
    expect(result.processed).toBe(8);
    expect(result.failed).toEqual([]);
    expect(result.total).toBe(8);
  });

  it("defaults to a concurrency of 4 when REINDEX_CONCURRENCY is unset", async () => {
    delete process.env.REINDEX_CONCURRENCY;

    const materials: Material[] = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      rawText: `content ${i}`,
      title: `Material ${i}`,
    }));
    mockMaterials(materials);

    let inFlight = 0;
    let maxInFlight = 0;

    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    await reEmbedCourseMaterials("course-1");

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it.each(["2.5", "not-a-number", "0", "-2"])(
    "falls back to concurrency 4 for invalid REINDEX_CONCURRENCY=%s",
    async (configuredConcurrency) => {
      process.env.REINDEX_CONCURRENCY = configuredConcurrency;

      const materials: Material[] = Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`,
        rawText: `content ${i}`,
        title: `Material ${i}`,
      }));
      mockMaterials(materials);

      let inFlight = 0;
      let maxInFlight = 0;
      (embedManyMock as any).mockImplementation(async ({ values }: any) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
      });

      await reEmbedCourseMaterials("course-1");

      expect(maxInFlight).toBe(4);
    },
  );

  it("caps oversized REINDEX_CONCURRENCY values at 16", async () => {
    process.env.REINDEX_CONCURRENCY = "1000";

    const materials: Material[] = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      rawText: `content ${i}`,
      title: `Material ${i}`,
    }));
    mockMaterials(materials);

    let inFlight = 0;
    let maxInFlight = 0;
    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    await reEmbedCourseMaterials("course-1");

    expect(maxInFlight).toBe(16);
  });

  it("isolates per-material failures: one rejection does not stop siblings", async () => {
    process.env.REINDEX_CONCURRENCY = "3";

    const materials: Material[] = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      rawText: `content ${i}`,
      title: `Material ${i}`,
    }));
    mockMaterials(materials);

    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      // Fail deterministically for m2's batch by inspecting call order via values content.
      const content = values[0] as string;
      if (content.includes("content 2")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("simulated embedding provider failure");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    const result = await reEmbedCourseMaterials("course-1");

    expect(result.failed).toEqual(["m2"]);
    expect(result.processed).toBe(4);
    expect(result.total).toBe(5);

    // Failed material marked FAILED; succeeded materials marked READY.
    const statusUpdates = prisma.courseMaterial.update.mock.calls
      .map((call: any) => call[0])
      .filter((args: any) => args.data.status === "FAILED" || args.data.status === "READY");
    const failedUpdate = statusUpdates.find((u: any) => u.where.id === "m2");
    expect(failedUpdate?.data.status).toBe("FAILED");
    const readyIds = statusUpdates
      .filter((u: any) => u.data.status === "READY")
      .map((u: any) => u.where.id);
    expect(readyIds.sort()).toEqual(["m0", "m1", "m3", "m4"]);
  });

  it("reports aggregate progress (processed/failed/total) consistent with the final result", async () => {
    const materials: Material[] = Array.from({ length: 4 }, (_, i) => ({
      id: `m${i}`,
      rawText: `content ${i}`,
      title: `Material ${i}`,
    }));
    mockMaterials(materials);

    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      const content = values[0] as string;
      if (content.includes("content 1")) {
        throw new Error("boom");
      }
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    const progressSnapshots: Array<{ processed: number; failed: string[]; total: number }> = [];
    const result = await reEmbedCourseMaterials("course-1", {
      onProgress: (progress) => {
        progressSnapshots.push({
          processed: progress.processed,
          failed: [...progress.failed],
          total: progress.total,
        });
      },
    });

    expect(result.total).toBe(4);
    expect(result.processed).toBe(3);
    expect(result.failed).toEqual(["m1"]);

    // Final progress snapshot must match the returned aggregate result.
    const last = progressSnapshots.at(-1)!;
    expect(last.processed).toBe(result.processed);
    expect(last.failed.sort()).toEqual(result.failed.sort());
    expect(last.total).toBe(result.total);

    // Progress is monotonic: processed count never decreases across snapshots.
    for (let i = 1; i < progressSnapshots.length; i++) {
      expect(progressSnapshots[i].processed).toBeGreaterThanOrEqual(
        progressSnapshots[i - 1].processed,
      );
    }
  });

  it("uses one immutable settings snapshot even when course settings change mid-job", async () => {
    process.env.REINDEX_CONCURRENCY = "1";
    mockMaterials([
      { id: "m0", rawText: "content 0", title: "First" },
      { id: "m1", rawText: "content 1", title: "Second" },
    ]);

    const models: string[] = [];
    (embedManyMock as any).mockImplementation(async ({ model, values }: any) => {
      models.push(model.modelId);
      if (models.length === 1) {
        prisma.course.findUnique.mockResolvedValue({
          embeddingProvider: "cloud",
          embeddingModel: "model-b",
          embeddedWithProvider: null,
          embeddedWithModel: null,
          lastEmbeddedAt: null,
        });
      }
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    const settingsSnapshot = {
      provider: "cloud" as const,
      model: "openai/model-a",
      wantsLocal: false,
      source: { provider: "course" as const, model: "course" as const },
    };

    await expect(
      reEmbedCourseMaterials("course-1", { embeddingSettings: settingsSnapshot }),
    ).resolves.toEqual({ processed: 2, failed: [], total: 2 });

    expect(models).toEqual(["model-a", "model-a"]);
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: {
        embeddedWithProvider: "cloud",
        embeddedWithModel: "openai/model-a",
        lastEmbeddedAt: expect.any(Date),
      },
    });
  });

  it("fences queued and uncommitted materials after the durable lease is lost", async () => {
    process.env.REINDEX_CONCURRENCY = "1";
    mockMaterials([
      { id: "m0", rawText: "content 0", title: "First" },
      { id: "m1", rawText: "content 1", title: "Second" },
    ]);

    let ownsLease = true;
    (embedManyMock as any).mockImplementation(async ({ values }: any) => {
      ownsLease = false;
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    await expect(
      reEmbedCourseMaterials("course-1", {
        embeddingSettings: {
          provider: "cloud",
          model: "openai/text-embedding-3-small",
          wantsLocal: false,
          source: { provider: "course", model: "course" },
        },
        shouldContinue: () => ownsLease,
      }),
    ).rejects.toBeInstanceOf(ReEmbedInterruptedError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.courseMaterial.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
    expect(embedManyMock).toHaveBeenCalledTimes(1);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });

  it("serializes async progress writes so completed counts cannot regress", async () => {
    process.env.REINDEX_CONCURRENCY = "2";
    mockMaterials([
      { id: "m0", rawText: "content 0", title: "First" },
      { id: "m1", rawText: "content 1", title: "Second" },
    ]);
    (embedManyMock as any).mockResolvedValue({ embeddings: [[...SAMPLE_EMBEDDING]] });

    const seen: number[] = [];
    let releaseFirstCompletion: (() => void) | undefined;
    const firstCompletionWritten = new Promise<void>((resolve) => {
      releaseFirstCompletion = resolve;
    });

    const run = reEmbedCourseMaterials("course-1", {
      onProgress: async (progress) => {
        if (progress.processed === 1) await firstCompletionWritten;
        seen.push(progress.processed);
      },
    });

    await vi.waitFor(() => expect(releaseFirstCompletion).toBeTypeOf("function"));
    releaseFirstCompletion!();
    await run;

    expect(seen).toEqual([0, 1, 2]);
  });

  it("continues re-embedding when a progress write fails", async () => {
    mockMaterials([
      { id: "m0", rawText: "content 0", title: "First" },
      { id: "m1", rawText: "content 1", title: "Second" },
    ]);
    (embedManyMock as any).mockResolvedValue({ embeddings: [[...SAMPLE_EMBEDDING]] });
    const progressError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onProgress = vi.fn().mockRejectedValueOnce(new Error("pool timeout"));

    await expect(reEmbedCourseMaterials("course-1", { onProgress })).resolves.toEqual({
      processed: 2,
      failed: [],
      total: 2,
    });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(progressError).toHaveBeenCalledWith(
      "[re-embed] progress write failed",
      expect.objectContaining({ name: "Error", message: "pool timeout" }),
    );
  });

  it("isolates a material status-write failure without rejecting sibling workers", async () => {
    mockMaterials([
      { id: "m0", rawText: "content 0", title: "Missing row" },
      { id: "m1", rawText: "content 1", title: "Still processed" },
    ]);
    prisma.courseMaterial.update.mockImplementation(({ where, data }: any) => {
      if (where.id === "m0" && data.status === "PROCESSING") {
        return Promise.reject(new Error("row deleted"));
      }
      return Promise.resolve({});
    });
    (embedManyMock as any).mockResolvedValue({ embeddings: [[...SAMPLE_EMBEDDING]] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(reEmbedCourseMaterials("course-1")).resolves.toEqual({
      processed: 1,
      failed: ["m0"],
      total: 2,
    });
  });

  it("retries a transient embedding-provider failure", async () => {
    mockMaterials([{ id: "m0", rawText: "content", title: "Retry" }]);
    (embedManyMock as any)
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce({ embeddings: [[...SAMPLE_EMBEDDING]] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(reEmbedCourseMaterials("course-1")).resolves.toMatchObject({
      processed: 1,
      failed: [],
    });
    expect(embedManyMock).toHaveBeenCalledTimes(2);
  });

  it("uses an extended transaction budget for concurrent reindex writes", async () => {
    mockMaterials([{ id: "m0", rawText: "content", title: "Transaction" }]);
    (embedManyMock as any).mockResolvedValue({ embeddings: [[...SAMPLE_EMBEDDING]] });

    await reEmbedCourseMaterials("course-1");

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 60_000,
    });
  });

  it("skips materials with blank or missing rawText and reports them outside eligible/total", async () => {
    mockMaterials([
      { id: "m0", rawText: "real content", title: "Real" },
      { id: "m1", rawText: "   ", title: "Blank" },
      { id: "m2", rawText: null, title: "Null" },
    ]);

    (embedManyMock as any).mockResolvedValue({ embeddings: [[...SAMPLE_EMBEDDING]] });

    const result = await reEmbedCourseMaterials("course-1");

    expect(result.total).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.failed).toEqual([]);
  });
});

// #1792: the `openai/` prefix on a course's embedding model is handled
// differently per provider, and nothing pinned either side — the only reason
// the difference was ever noticed is that a leaked `OPENROUTER_API_KEY` from
// `apps/core/.env` silently flipped the branch under the suite above. These
// control every provider-selecting variable explicitly rather than inheriting
// whatever the ambient environment happens to hold.
describe("reEmbedCourseMaterials cloud model resolution (#1792)", () => {
  const SAVED_ENV = [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "VLLM_EMBEDDING_BASE_URL",
    "EMBEDDING_DIMENSION",
    "EMBEDDING_PROVIDER",
    "REINDEX_CONCURRENCY",
  ] as const;
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.clearAllMocks();
    clearCourseEmbeddingSettingsCache();
    for (const key of SAVED_ENV) {
      originals.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.EMBEDDING_DIMENSION = "1024";
    process.env.EMBEDDING_PROVIDER = "cloud";
    process.env.REINDEX_CONCURRENCY = "1";

    prisma.course.findUnique.mockResolvedValue({
      embeddingProvider: "cloud",
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });
    prisma.courseMaterial.update.mockResolvedValue({});
    prisma.course.update.mockResolvedValue({});
    setupTransactionMock();
    mockMaterials([{ id: "m0", rawText: "content 0", title: "First" }]);
    (embedManyMock as any).mockImplementation(async ({ values }: any) => ({
      embeddings: values.map(() => [...SAMPLE_EMBEDDING]),
    }));
  });

  afterEach(() => {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originals.clear();
  });

  /** Run one re-embed against a fixed settings snapshot and report the wire model id. */
  async function embedWithSnapshotModel(model: string): Promise<string> {
    let wireModelId = "";
    (embedManyMock as any).mockImplementation(async ({ model: resolved, values }: any) => {
      wireModelId = resolved.modelId;
      return { embeddings: values.map(() => [...SAMPLE_EMBEDDING]) };
    });

    await reEmbedCourseMaterials("course-1", {
      embeddingSettings: {
        provider: "cloud" as const,
        model,
        wantsLocal: false,
        source: { provider: "course" as const, model: "course" as const },
      },
    });
    return wireModelId;
  }

  it("sends the provider-qualified model id to OpenRouter, which addresses models that way", async () => {
    process.env.OPENROUTER_API_KEY = "router-key";

    expect(await embedWithSnapshotModel("openai/model-a")).toBe("openai/model-a");
  });

  it("strips the provider prefix when falling back to OpenAI direct, which does not", async () => {
    process.env.OPENAI_API_KEY = "openai-key";

    expect(await embedWithSnapshotModel("openai/model-a")).toBe("model-a");
  });

  it("stores the canonical provider-qualified id regardless of which client sent it", async () => {
    process.env.OPENAI_API_KEY = "openai-key";

    await embedWithSnapshotModel("openai/model-a");

    expect(prisma.course.update).toHaveBeenCalledWith({
      where: { id: "course-1" },
      data: {
        embeddedWithProvider: "cloud",
        embeddedWithModel: "openai/model-a",
        lastEmbeddedAt: expect.any(Date),
      },
    });
  });
});
