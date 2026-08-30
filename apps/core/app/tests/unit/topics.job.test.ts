import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseMaterial: { findMany: vi.fn() },
  courseTopic: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  aiJob: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const provisionCourseTopics = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/topics/provision.server", () => ({ provisionCourseTopics }));
vi.mock("~/lib/topics/completion.server", () => ({ runTopicAnalysisCompletion: vi.fn() }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

const { logSystemError } = await import("~/lib/logging.server");

const {
  topicAnalysisIdempotencyKey,
  recordTopicAnalysisJobs,
  resumeStaleTopicAnalysisJobs,
  runTopicAnalysisJob,
  startTopicAnalysis,
  MAX_MATERIALS_PER_JOB,
  TOPIC_ANALYSIS_LEASE_MS,
  TOPIC_ANALYSIS_QUEUE_NAME,
} = await import("~/lib/topics/job.server");

function payload(overrides: Partial<{ userId: string; courseId: string }> = {}) {
  return {
    kind: "topic-analysis",
    type: "background",
    source: "core:topic-analysis",
    userId: "user-1",
    courseId: "course-1",
    input: {
      kind: "topic-analysis",
      courseId: "course-1",
      materialIds: ["m1"],
      canvasCourseId: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.courseTopic.findFirst.mockResolvedValue({ id: "existing-topic" });
  prismaMock.aiJob.update.mockResolvedValue({});
  provisionCourseTopics.mockResolvedValue({
    created: 2,
    createdNames: ["Chapter 1", "Chapter 2"],
    usedSource: "material-headings",
    duplicatesSkipped: 0,
  });
});

describe("topicAnalysisIdempotencyKey", () => {
  it("is stable regardless of the order checksums arrive in", () => {
    expect(topicAnalysisIdempotencyKey("c1", ["a", "b"])).toBe(
      topicAnalysisIdempotencyKey("c1", ["b", "a"]),
    );
  });

  it("changes when a material's content changes", () => {
    expect(topicAnalysisIdempotencyKey("c1", ["a", "b"])).not.toBe(
      topicAnalysisIdempotencyKey("c1", ["a", "b-modified"]),
    );
  });

  it("separates the same corpus on different courses", () => {
    expect(topicAnalysisIdempotencyKey("c1", ["a"])).not.toBe(
      topicAnalysisIdempotencyKey("c2", ["a"]),
    );
  });
});

describe("recordTopicAnalysisJobs", () => {
  it("records one job for a batch of processed materials", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      { id: "m1", checksum: "sum-1" },
      { id: "m2", checksum: "sum-2" },
    ]);
    prismaMock.aiJob.create.mockResolvedValue({ id: "job-1" });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1", "m2"],
    });

    expect(result).toEqual([{ jobId: "job-1", created: true, resumable: false }]);
    const data = prismaMock.aiJob.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      kind: "topic-analysis",
      status: "PENDING",
      queueName: TOPIC_ANALYSIS_QUEUE_NAME,
      courseId: "course-1",
    });
    expect(data.bullJobId).toBe(topicAnalysisIdempotencyKey("course-1", ["sum-1", "sum-2"]));
  });

  it("adopts the existing job when the same batch is retried", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1", checksum: "sum-1" }]);
    prismaMock.aiJob.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    prismaMock.aiJob.findUnique.mockResolvedValue({
      id: "job-existing",
      status: "RUNNING",
      startedAt: new Date(),
    });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1"],
    });

    // Still leased by a live runner: adopted for reporting, but not resumable.
    expect(result).toEqual([{ jobId: "job-existing", created: false, resumable: false }]);
  });

  it("records nothing when no material in the batch is processed yet", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    expect(
      await recordTopicAnalysisJobs({
        courseId: "course-1",
        userId: "user-1",
        materialIds: ["m1"],
      }),
    ).toEqual([]);
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
  });

  it("only considers materials that finished processing", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    await recordTopicAnalysisJobs({ courseId: "course-1", userId: "user-1", materialIds: ["m1"] });

    expect(prismaMock.courseMaterial.findMany.mock.calls[0][0].where).toMatchObject({
      status: "READY",
      deletedAt: null,
    });
  });

  it("splits a batch larger than one job's material bound instead of throwing", async () => {
    const materials = Array.from({ length: MAX_MATERIALS_PER_JOB + 1 }, (_, index) => ({
      id: `m${index}`,
      checksum: `sum-${index}`,
    }));
    prismaMock.courseMaterial.findMany.mockResolvedValue(materials);
    prismaMock.aiJob.create
      .mockResolvedValueOnce({ id: "job-a" })
      .mockResolvedValueOnce({ id: "job-b" });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: materials.map((m) => m.id),
    });

    expect(result.map((job) => job.jobId)).toEqual(["job-a", "job-b"]);
    // Every material lands in exactly one job, and no job exceeds the bound.
    const chunks = prismaMock.aiJob.create.mock.calls.map(
      (call) => call[0].data.payload.input.materialIds as string[],
    );
    expect(chunks[0]).toHaveLength(MAX_MATERIALS_PER_JOB);
    expect(chunks[1]).toHaveLength(1);
    expect([...chunks[0], ...chunks[1]]).toEqual(materials.map((m) => m.id));

    // Both chunks carry one shared batch key, derived from the whole corpus —
    // that is what lets the status read report a failed chunk instead of only
    // the newest row.
    const keys = prismaMock.aiJob.create.mock.calls.map(
      (call) => call[0].data.payload.input.batchKey as string,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(
      topicAnalysisIdempotencyKey(
        "course-1",
        materials.map((m) => m.checksum),
      ),
    );
    // …and it is not the same as either chunk's own idempotency key.
    expect(keys[0]).not.toBe(prismaMock.aiJob.create.mock.calls[0][0].data.bullJobId);
  });

  it("marks an abandoned RUNNING row resumable once its lease lapses", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1", checksum: "sum-1" }]);
    prismaMock.aiJob.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    prismaMock.aiJob.findUnique.mockResolvedValue({
      id: "job-stale",
      status: "RUNNING",
      startedAt: new Date(Date.now() - TOPIC_ANALYSIS_LEASE_MS - 1000),
    });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1"],
    });

    expect(result).toEqual([{ jobId: "job-stale", created: false, resumable: true }]);
  });

  it("marks a PENDING row nothing ever picked up resumable", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1", checksum: "sum-1" }]);
    prismaMock.aiJob.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    prismaMock.aiJob.findUnique.mockResolvedValue({
      id: "job-pending",
      status: "PENDING",
      startedAt: null,
    });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1"],
    });

    expect(result[0]).toMatchObject({ jobId: "job-pending", resumable: true });
  });

  /**
   * WhiteKnight follow-up on #1699: a changed resync reuses an unchanged chunk's
   * FAILED row (same checksum key) but used to leave its old batchKey and skip
   * the run. A sibling chunk completing under the new batchKey then hid the
   * failure and reported success with no retry.
   */
  it("recycles a reused FAILED chunk into the current batch and marks it resumable", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1", checksum: "sum-a" }]);
    prismaMock.aiJob.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    prismaMock.aiJob.findUnique.mockResolvedValue({
      id: "job-failed-a",
      status: "FAILED",
      startedAt: null,
    });
    prismaMock.aiJob.update.mockResolvedValue({ id: "job-failed-a" });

    const result = await recordTopicAnalysisJobs({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1"],
    });

    expect(result).toEqual([{ jobId: "job-failed-a", created: false, resumable: true }]);

    const update = prismaMock.aiJob.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "job-failed-a" });
    expect(update.data).toMatchObject({
      status: "PENDING",
      errorMessage: null,
      completedAt: null,
      startedAt: null,
    });
    expect(update.data.payload.input.batchKey).toBe(
      topicAnalysisIdempotencyKey("course-1", ["sum-a"]),
    );
  });

  it("re-runs a recycled FAILED chunk when the wider corpus changed", async () => {
    // Two chunks: unchanged A (prior FAILED) and new B (fresh PENDING).
    const materials = Array.from({ length: MAX_MATERIALS_PER_JOB + 1 }, (_, index) => ({
      id: `m${index}`,
      // Chunk 0 keeps its prior checksums; the extra material makes chunk 1 new.
      checksum: index < MAX_MATERIALS_PER_JOB ? `sum-${index}` : "sum-extra-changed",
    }));
    prismaMock.courseMaterial.findMany.mockResolvedValue(materials);
    prismaMock.aiJob.create
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }))
      .mockResolvedValueOnce({ id: "job-b-new" });
    prismaMock.aiJob.findUnique
      .mockResolvedValueOnce({
        id: "job-a-failed",
        status: "FAILED",
        startedAt: null,
      })
      // runTopicAnalysisJob reads payload after claim for each run.
      .mockResolvedValue({ payload: payload(), userId: "user-1" });
    prismaMock.aiJob.update.mockResolvedValue({});
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });

    startTopicAnalysis({
      courseId: "course-1",
      userId: "user-1",
      materialIds: materials.map((m) => m.id),
    });

    await vi.waitFor(() => expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(2));
    // Failed chunk A was recycled (PENDING + new batchKey) before either run.
    await vi.waitFor(() =>
      expect(
        prismaMock.aiJob.update.mock.calls.some(
          (call) => call[0].where?.id === "job-a-failed" && call[0].data?.status === "PENDING",
        ),
      ).toBe(true),
    );
    // Both the recycled failure and the new chunk were claimed and run.
    await vi.waitFor(() => expect(prismaMock.aiJob.updateMany).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        prismaMock.aiJob.update.mock.calls.filter((call) => call[0].data?.status === "COMPLETED")
          .length,
      ).toBe(2),
    );
  });
});

describe("startTopicAnalysis", () => {
  /**
   * The defect this covers: a Canvas sync may hand over an arbitrary selection —
   * "all files" is one click — and the job schema caps `materialIds` at 500. The
   * payload parse used to reject the oversized batch inside a fire-and-forget
   * async block, so the sync still reported success while the instructor got no
   * job, no banner, and no topics.
   */
  it("starts every chunk of an oversized batch instead of rejecting it", async () => {
    const materials = Array.from({ length: MAX_MATERIALS_PER_JOB + 1 }, (_, index) => ({
      id: `m${index}`,
      checksum: `sum-${index}`,
    }));
    prismaMock.courseMaterial.findMany.mockResolvedValue(materials);
    prismaMock.aiJob.create
      .mockResolvedValueOnce({ id: "job-a" })
      .mockResolvedValueOnce({ id: "job-b" });
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });

    startTopicAnalysis({
      courseId: "course-1",
      userId: "user-1",
      materialIds: materials.map((m) => m.id),
    });

    await vi.waitFor(() => expect(prismaMock.aiJob.create).toHaveBeenCalledTimes(2));
    // Both rows were claimed and run — nothing was silently dropped.
    await vi.waitFor(() =>
      expect(
        prismaMock.aiJob.update.mock.calls.filter((call) => call[0].data.status === "COMPLETED")
          .length,
      ).toBe(2),
    );
    expect(logSystemError).not.toHaveBeenCalled();
  });
});

describe("resumeStaleTopicAnalysisJobs", () => {
  it("re-runs rows no runner still holds", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([{ id: "job-stale" }]);
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });

    expect(await resumeStaleTopicAnalysisJobs("course-1")).toEqual(["job-stale"]);

    const where = prismaMock.aiJob.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ courseId: "course-1", kind: "topic-analysis" });
    // Only unheld rows: PENDING, or RUNNING past the lease.
    expect(where.OR).toEqual([
      { status: "PENDING" },
      { status: "RUNNING", startedAt: null },
      { status: "RUNNING", startedAt: { lt: expect.any(Date) } },
    ]);
  });

  it("resumes nothing when every row is terminal or still leased", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([]);

    expect(await resumeStaleTopicAnalysisJobs("course-1")).toEqual([]);
    expect(prismaMock.aiJob.updateMany).not.toHaveBeenCalled();
  });
});

describe("runTopicAnalysisJob", () => {
  it("claims, provisions, and completes with a readable result", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });

    await runTopicAnalysisJob("job-1", vi.fn());

    const completion = prismaMock.aiJob.update.mock.calls.at(-1)?.[0].data;
    expect(completion).toMatchObject({ status: "COMPLETED" });
    expect(completion.result).toMatchObject({
      created: 2,
      usedSource: "material-headings",
      createdNames: ["Chapter 1", "Chapter 2"],
    });
  });

  it("does nothing when another runner already claimed the job", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 0 });

    await runTopicAnalysisJob("job-1", vi.fn());

    expect(provisionCourseTopics).not.toHaveBeenCalled();
    expect(prismaMock.aiJob.update).not.toHaveBeenCalled();
  });

  it("claims a lapsed lease through the same atomic statement as a fresh row", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });

    await runTopicAnalysisJob("job-1", vi.fn());

    // One conditional updateMany decides the winner — a RUNNING row is only
    // reclaimable past the lease, so a healthy run is never taken away.
    const where = prismaMock.aiJob.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe("job-1");
    expect(where.OR).toEqual([
      { status: "PENDING" },
      { status: "RUNNING", startedAt: null },
      { status: "RUNNING", startedAt: { lt: expect.any(Date) } },
    ]);
    const cutoff = where.OR[2].status === "RUNNING" ? where.OR[2].startedAt.lt : null;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(TOPIC_ANALYSIS_LEASE_MS);
  });

  it("records a failure on the row rather than throwing", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });
    provisionCourseTopics.mockRejectedValue(new Error("model unreachable"));

    await expect(runTopicAnalysisJob("job-1", vi.fn())).resolves.toBeUndefined();

    expect(prismaMock.aiJob.update.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "FAILED",
      errorMessage: "model unreachable",
    });
  });

  it("still guarantees an authorable topic after a failure", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockResolvedValue({ id: "fallback" });
    provisionCourseTopics.mockRejectedValue(new Error("boom"));

    await runTopicAnalysisJob("job-1", vi.fn());

    expect(prismaMock.courseTopic.create.mock.calls[0][0].data).toMatchObject({
      name: "Uncategorized",
      origin: "SYSTEM",
    });
  });

  it("guarantees an authorable topic when analysis found nothing", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: payload(), userId: "user-1" });
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockResolvedValue({ id: "fallback" });
    provisionCourseTopics.mockResolvedValue({
      created: 0,
      createdNames: [],
      usedSource: "none",
      duplicatesSkipped: 0,
    });

    await runTopicAnalysisJob("job-1", vi.fn());

    expect(prismaMock.courseTopic.create).toHaveBeenCalled();
    expect(prismaMock.aiJob.update.mock.calls.at(-1)?.[0].data.status).toBe("COMPLETED");
  });

  it("fails a row whose payload is not a topic-analysis payload", async () => {
    prismaMock.aiJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.aiJob.findUnique.mockResolvedValue({ payload: { nonsense: true }, userId: "u" });

    await runTopicAnalysisJob("job-1", vi.fn());

    expect(prismaMock.aiJob.update.mock.calls.at(-1)?.[0].data.status).toBe("FAILED");
    expect(provisionCourseTopics).not.toHaveBeenCalled();
  });
});
