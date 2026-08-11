import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockReEmbedInterruptedError extends Error {
    constructor() {
      super("Re-embed job lease is no longer owned by this worker");
      this.name = "ReEmbedInterruptedError";
    }
  }

  return {
    reEmbedCourseMaterials: vi.fn(),
    MockReEmbedInterruptedError,
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  };
});

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseReEmbedJob: {
      updateMany: mocks.updateMany,
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  reEmbedCourseMaterials: mocks.reEmbedCourseMaterials,
  ReEmbedInterruptedError: mocks.MockReEmbedInterruptedError,
}));

const { resumeReEmbedJob } = await import("~/lib/ai/re-embed-job.server");

const job = {
  id: "job-1",
  courseId: "course-1",
  status: "PENDING" as const,
  embeddingProviderSnapshot: "cloud",
  embeddingModelSnapshot: "openai/text-embedding-3-small",
  totalMaterials: 1,
  processedCount: 0,
  failedMaterialIds: [] as string[],
  currentMaterialTitle: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  leaseOwner: null,
  leaseHeartbeatAt: null,
  leaseExpiresAt: null,
  attemptCount: 0,
};

describe("re-embed lease heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.RE_EMBED_JOB_LEASE_MS;
  });

  it("aborts provider work and does not terminalize after heartbeat renewal is rejected", async () => {
    vi.useFakeTimers();
    process.env.RE_EMBED_JOB_LEASE_MS = "15000";

    mocks.findUnique.mockResolvedValue(job);
    mocks.findUniqueOrThrow.mockResolvedValue({ ...job, status: "RUNNING" });
    mocks.updateMany.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      if (data.status === "RUNNING") return Promise.resolve({ count: 1 });
      if (data.status === "FAILED") return Promise.resolve({ count: 1 });
      if ("leaseHeartbeatAt" in data) return Promise.reject(new Error("database unavailable"));
      return Promise.resolve({ count: 1 });
    });

    let rejectProvider!: (error: unknown) => void;
    let providerSignal!: AbortSignal;
    mocks.reEmbedCourseMaterials.mockImplementation(
      async (_courseId: string, options: { signal: AbortSignal }) => {
        providerSignal = options.signal;
        return new Promise((_resolve, reject) => {
          rejectProvider = reject;
          options.signal.addEventListener(
            "abort",
            () => reject(options.signal.reason),
            { once: true },
          );
        });
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const run = resumeReEmbedJob(job.id);
    await vi.waitFor(() => expect(providerSignal).toBeInstanceOf(AbortSignal));
    await vi.advanceTimersByTimeAsync(5_000);
    if (!providerSignal.aborted) rejectProvider(new mocks.MockReEmbedInterruptedError());
    await expect(run).resolves.toBe(true);

    expect(providerSignal.aborted).toBe(true);
    expect(
      mocks.updateMany.mock.calls.some(
        (call) => (call[0] as any)?.data?.status === "FAILED",
      ),
    ).toBe(false);
  });

  it("keeps an in-flight worker alive when the heartbeat renews normally", async () => {
    vi.useFakeTimers();
    process.env.RE_EMBED_JOB_LEASE_MS = "15000";

    mocks.findUnique.mockResolvedValue(job);
    mocks.findUniqueOrThrow.mockResolvedValue({ ...job, status: "RUNNING" });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    let resolveWorker!: (result: { processed: number; failed: string[]; total: number }) => void;
    let providerSignal!: AbortSignal;
    mocks.reEmbedCourseMaterials.mockImplementation(
      async (_courseId: string, options: { signal: AbortSignal }) => {
        providerSignal = options.signal;
        return new Promise((resolve) => {
          resolveWorker = resolve;
        });
      },
    );

    const run = resumeReEmbedJob(job.id);
    await vi.waitFor(() => expect(providerSignal).toBeInstanceOf(AbortSignal));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(providerSignal.aborted).toBe(false);
    expect(
      mocks.updateMany.mock.calls.some(
        (call) => {
          const data = (call[0] as any)?.data ?? {};
          return data.status === undefined && "leaseHeartbeatAt" in data;
        },
      ),
    ).toBe(true);

    resolveWorker({ processed: 1, failed: [], total: 1 });
    await expect(run).resolves.toBe(true);
    expect(
      mocks.updateMany.mock.calls.some(
        (call) => (call[0] as any)?.data?.status === "COMPLETED",
      ),
    ).toBe(true);
  });

  it("persists a stable failure when the provider rejects with a secret-bearing error", async () => {
    mocks.findUnique.mockResolvedValue(job);
    mocks.findUniqueOrThrow.mockResolvedValue({ ...job, status: "RUNNING" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    const providerSecret = "provider-secret-canary";
    mocks.reEmbedCourseMaterials.mockRejectedValue(
      new Error(`Embedding request failed: https://provider.test/v1?api_key=${providerSecret}`),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(resumeReEmbedJob(job.id)).resolves.toBe(true);

    const failedWrite = mocks.updateMany.mock.calls.find(
      (call) => (call[0] as any)?.data?.status === "FAILED",
    );
    expect(failedWrite?.[0]?.data?.errorMessage).toBe(
      "Embedding provider failed. Please try again.",
    );
    expect(JSON.stringify(failedWrite)).not.toContain(providerSecret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(providerSecret);
  });
});
