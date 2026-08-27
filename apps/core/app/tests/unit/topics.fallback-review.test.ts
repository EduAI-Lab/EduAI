import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseTopic: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  question: { count: vi.fn(), updateMany: vi.fn() },
  questionSecondaryTopic: { deleteMany: vi.fn() },
  courseMaterial: { findMany: vi.fn() },
  course: { findUnique: vi.fn() },
  aiJob: { findFirst: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
const recordTopicAnalysisJob = vi.hoisted(() => vi.fn());
const runTopicAnalysisJob = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/topics/job.server", () => ({ recordTopicAnalysisJob, runTopicAnalysisJob }));

const { ensureCourseHasTopic, FALLBACK_TOPIC_NAME } = await import("~/lib/topics/fallback.server");
const {
  approveGeneratedTopic,
  dismissGeneratedTopic,
  mergeGeneratedTopic,
  latestTopicAnalysisForCourse,
  retryTopicAnalysis,
} = await import("~/lib/topics/review.server");

const SUGGESTION = { id: "topic-1", name: "Chapter 1 — Recursion" };

beforeEach(() => {
  vi.clearAllMocks();
  // The transaction callback is handed the same mock, so a merge's writes land
  // on the spies the assertions read.
  type TxClient = typeof prismaMock;
  prismaMock.$transaction.mockImplementation(async (fn: (tx: TxClient) => Promise<void>) =>
    fn(prismaMock),
  );
  // The retry path fires this without awaiting and attaches a .catch, so it has
  // to hand back a real promise.
  runTopicAnalysisJob.mockResolvedValue(undefined);
});

describe("ensureCourseHasTopic", () => {
  it("creates the fallback for a course with no topics at all", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockResolvedValue({ id: "t1" });

    expect(await ensureCourseHasTopic("course-1")).toBe(true);
    expect(prismaMock.courseTopic.create.mock.calls[0][0].data).toMatchObject({
      courseId: "course-1",
      name: FALLBACK_TOPIC_NAME,
      origin: "SYSTEM",
      reviewStatus: "ACCEPTED",
    });
  });

  it("does nothing when the course already has a live topic", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue({ id: "existing" });

    expect(await ensureCourseHasTopic("course-1")).toBe(false);
    expect(prismaMock.courseTopic.create).not.toHaveBeenCalled();
  });

  it("restores a soft-deleted fallback rather than leaving the course unauthorable", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" }),
    );
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 1 });

    expect(await ensureCourseHasTopic("course-1")).toBe(true);
    expect(prismaMock.courseTopic.updateMany.mock.calls[0][0]).toMatchObject({
      where: { courseId: "course-1", name: FALLBACK_TOPIC_NAME, deletedAt: { not: null } },
      data: { deletedAt: null, deletedBy: null },
    });
  });

  it("reports no work done when a concurrent caller won the race", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "P2002" }),
    );
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 0 });

    expect(await ensureCourseHasTopic("course-1")).toBe(false);
  });

  it("rethrows an error that is not a name conflict", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.create.mockRejectedValue(new Error("connection lost"));

    await expect(ensureCourseHasTopic("course-1")).rejects.toThrow("connection lost");
  });
});

describe("review actions only touch unreviewed suggestions", () => {
  it("approve promotes a suggestion to accepted", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(SUGGESTION);
    prismaMock.courseTopic.update.mockResolvedValue(SUGGESTION);

    const result = await approveGeneratedTopic("course-1", "topic-1");

    expect(result.status).toBe("200");
    expect(prismaMock.courseTopic.update.mock.calls[0][0].data).toEqual({
      reviewStatus: "ACCEPTED",
    });
  });

  it("refuses to act on a topic that is not a live suggestion", async () => {
    // The lookup filters reviewStatus: SUGGESTED, so a human-created topic is
    // simply not found — that is what keeps these endpoints off instructor rows.
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);

    expect(await approveGeneratedTopic("course-1", "human-topic")).toEqual({
      status: "404",
      error: "TOPIC_NOT_FOUND",
    });
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
  });

  it("scopes every lookup to a live suggestion on this course", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);

    await approveGeneratedTopic("course-1", "topic-1");

    expect(prismaMock.courseTopic.findFirst.mock.calls[0][0].where).toEqual({
      id: "topic-1",
      courseId: "course-1",
      deletedAt: null,
      reviewStatus: "SUGGESTED",
    });
  });
});

describe("dismissGeneratedTopic", () => {
  it("soft-deletes so the name is never re-proposed", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(SUGGESTION);
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.courseTopic.update.mockResolvedValue(SUGGESTION);

    const result = await dismissGeneratedTopic("course-1", "topic-1", "user-1");

    expect(result.status).toBe("200");
    const data = prismaMock.courseTopic.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.deletedBy).toBe("user-1");
  });

  it("refuses to orphan authored questions", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(SUGGESTION);
    prismaMock.question.count.mockResolvedValue(3);

    expect(await dismissGeneratedTopic("course-1", "topic-1", "user-1")).toEqual({
      status: "409",
      error: "TOPIC_HAS_QUESTIONS",
    });
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
  });
});

describe("mergeGeneratedTopic", () => {
  it("repoints questions onto the target and dismisses the source", async () => {
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce(SUGGESTION)
      .mockResolvedValueOnce({ id: "topic-2", name: "Recursion" });

    const result = await mergeGeneratedTopic("course-1", "topic-1", "topic-2", "user-1");

    expect(result).toMatchObject({ status: "200", topic: { id: "topic-2" } });
    expect(prismaMock.question.updateMany).toHaveBeenCalledWith({
      where: { topicId: "topic-1" },
      data: { topicId: "topic-2" },
    });
    expect(prismaMock.questionSecondaryTopic.deleteMany).toHaveBeenCalledWith({
      where: { topicId: "topic-1" },
    });
    expect(prismaMock.courseTopic.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it("404s when the merge target is not on this course", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValueOnce(SUGGESTION).mockResolvedValueOnce(null);

    expect(await mergeGeneratedTopic("course-1", "topic-1", "elsewhere", "user-1")).toEqual({
      status: "404",
      error: "TARGET_TOPIC_NOT_FOUND",
    });
    expect(prismaMock.question.updateMany).not.toHaveBeenCalled();
  });
});

describe("latestTopicAnalysisForCourse", () => {
  it("reports the most recent job and the outstanding suggestion count", async () => {
    const createdAt = new Date("2026-08-26T10:00:00.000Z");
    prismaMock.aiJob.findFirst.mockResolvedValue({
      id: "job-1",
      status: "COMPLETED",
      errorMessage: null,
      createdAt,
      completedAt: createdAt,
      result: { created: 4, usedSource: "canvas-modules" },
    });
    prismaMock.courseTopic.count.mockResolvedValue(4);

    expect(await latestTopicAnalysisForCourse("course-1")).toEqual({
      job: {
        id: "job-1",
        status: "COMPLETED",
        errorMessage: null,
        createdAt: createdAt.toISOString(),
        completedAt: createdAt.toISOString(),
        created: 4,
        usedSource: "canvas-modules",
      },
      pendingSuggestions: 4,
    });
  });

  it("reports a null job for a course that has never been analysed", async () => {
    prismaMock.aiJob.findFirst.mockResolvedValue(null);
    prismaMock.courseTopic.count.mockResolvedValue(0);

    expect(await latestTopicAnalysisForCourse("course-1")).toEqual({
      job: null,
      pendingSuggestions: 0,
    });
  });

  it("tolerates a job row whose result is missing or malformed", async () => {
    prismaMock.aiJob.findFirst.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
      errorMessage: "boom",
      createdAt: new Date(),
      completedAt: null,
      result: null,
    });
    prismaMock.courseTopic.count.mockResolvedValue(0);

    const status = await latestTopicAnalysisForCourse("course-1");
    expect(status.job).toMatchObject({ created: null, usedSource: null, errorMessage: "boom" });
  });
});

describe("retryTopicAnalysis", () => {
  it("clears the failed row and re-records over the course's ready materials", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    prismaMock.course.findUnique.mockResolvedValue({
      externalId: "77",
      externalSource: "canvas",
    });
    recordTopicAnalysisJob.mockResolvedValue({ jobId: "job-2", created: true });

    expect(await retryTopicAnalysis("course-1", "user-1")).toEqual({ jobId: "job-2" });

    expect(prismaMock.aiJob.deleteMany.mock.calls[0][0].where).toMatchObject({
      courseId: "course-1",
      kind: "topic-analysis",
      status: "FAILED",
    });
    expect(recordTopicAnalysisJob.mock.calls[0][0]).toMatchObject({
      materialIds: ["m1", "m2"],
      canvasCourseId: "77",
    });
  });

  it("passes no Canvas id for a course that was never Canvas linked", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }]);
    prismaMock.course.findUnique.mockResolvedValue({ externalId: null, externalSource: null });
    recordTopicAnalysisJob.mockResolvedValue({ jobId: "job-2", created: true });

    await retryTopicAnalysis("course-1", "user-1");

    expect(recordTopicAnalysisJob.mock.calls[0][0].canvasCourseId).toBeNull();
  });

  it("returns null when the course has nothing to analyse", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    expect(await retryTopicAnalysis("course-1", "user-1")).toBeNull();
    expect(recordTopicAnalysisJob).not.toHaveBeenCalled();
  });

  it("does not re-run a job that already exists for an unchanged corpus", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }]);
    prismaMock.course.findUnique.mockResolvedValue({ externalId: null, externalSource: null });
    recordTopicAnalysisJob.mockResolvedValue({ jobId: "job-1", created: false });

    expect(await retryTopicAnalysis("course-1", "user-1")).toEqual({ jobId: "job-1" });
    expect(runTopicAnalysisJob).not.toHaveBeenCalled();
  });
});
