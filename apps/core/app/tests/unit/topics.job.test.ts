import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseMaterial: { findMany: vi.fn() },
  courseTopic: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  aiJob: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
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

const {
  topicAnalysisIdempotencyKey,
  recordTopicAnalysisJob,
  runTopicAnalysisJob,
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

describe("recordTopicAnalysisJob", () => {
  it("records one job for a batch of processed materials", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      { id: "m1", checksum: "sum-1" },
      { id: "m2", checksum: "sum-2" },
    ]);
    prismaMock.aiJob.create.mockResolvedValue({ id: "job-1" });

    const result = await recordTopicAnalysisJob({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1", "m2"],
    });

    expect(result).toEqual({ jobId: "job-1", created: true });
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
    prismaMock.aiJob.findUnique.mockResolvedValue({ id: "job-existing" });

    const result = await recordTopicAnalysisJob({
      courseId: "course-1",
      userId: "user-1",
      materialIds: ["m1"],
    });

    expect(result).toEqual({ jobId: "job-existing", created: false });
  });

  it("records nothing when no material in the batch is processed yet", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    expect(
      await recordTopicAnalysisJob({
        courseId: "course-1",
        userId: "user-1",
        materialIds: ["m1"],
      }),
    ).toBeNull();
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
  });

  it("only considers materials that finished processing", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    await recordTopicAnalysisJob({ courseId: "course-1", userId: "user-1", materialIds: ["m1"] });

    expect(prismaMock.courseMaterial.findMany.mock.calls[0][0].where).toMatchObject({
      status: "READY",
      deletedAt: null,
    });
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
