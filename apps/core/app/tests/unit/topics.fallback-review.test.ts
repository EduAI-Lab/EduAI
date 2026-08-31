import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  courseTopic: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  question: { count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  questionSecondaryTopic: {
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  courseMaterial: { findMany: vi.fn() },
  course: { findUnique: vi.fn() },
  aiJob: { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));
const recordTopicAnalysisJobs = vi.hoisted(() => vi.fn());
const runTopicAnalysisJob = vi.hoisted(() => vi.fn());
const resumeStaleTopicAnalysisJobs = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/topics/job.server", () => ({
  recordTopicAnalysisJobs,
  runTopicAnalysisJob,
  resumeStaleTopicAnalysisJobs,
}));

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
  resumeStaleTopicAnalysisJobs.mockResolvedValue([]);
  // Default: no secondary tags anywhere, so only the tests that care set them.
  prismaMock.questionSecondaryTopic.count.mockResolvedValue(0);
  prismaMock.questionSecondaryTopic.findMany.mockResolvedValue([]);
  prismaMock.question.findMany.mockResolvedValue([]);
  // Dismiss re-checks the fallback invariant; a live topic means nothing to do.
  prismaMock.courseTopic.findFirst.mockResolvedValue({ id: "some-topic" });
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
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
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
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
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

  it("refuses when the only references are secondary tags", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(SUGGESTION);
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.questionSecondaryTopic.count.mockResolvedValue(2);

    expect(await dismissGeneratedTopic("course-1", "topic-1", "user-1")).toEqual({
      status: "409",
      error: "TOPIC_HAS_QUESTIONS",
    });
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
  });

  it("ignores secondary tags belonging to deleted questions", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(SUGGESTION);
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.courseTopic.update.mockResolvedValue(SUGGESTION);

    await dismissGeneratedTopic("course-1", "topic-1", "user-1");

    expect(prismaMock.questionSecondaryTopic.count.mock.calls[0][0].where).toMatchObject({
      topicId: "topic-1",
      question: { deletedAt: null },
    });
  });

  it("restores the fallback when the dismissed topic was the course's last", async () => {
    prismaMock.courseTopic.findFirst
      // findSuggestion, then ensureCourseHasTopic's "any live topic?" read.
      .mockResolvedValueOnce(SUGGESTION)
      .mockResolvedValueOnce(null);
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.courseTopic.update.mockResolvedValue(SUGGESTION);
    prismaMock.courseTopic.create.mockResolvedValue({ id: "fallback" });

    await dismissGeneratedTopic("course-1", "topic-1", "user-1");

    expect(prismaMock.courseTopic.create.mock.calls[0][0].data).toMatchObject({
      name: FALLBACK_TOPIC_NAME,
      origin: "SYSTEM",
    });
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
    expect(prismaMock.courseTopic.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it("carries a secondary tag across to the target instead of discarding it", async () => {
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce(SUGGESTION)
      .mockResolvedValueOnce({ id: "topic-2", name: "Recursion" });
    // One question tags the source and neither already tags nor sits on the target.
    prismaMock.questionSecondaryTopic.findMany
      .mockResolvedValueOnce([{ questionId: "q1" }])
      .mockResolvedValueOnce([]);
    prismaMock.question.findMany.mockResolvedValue([]);

    await mergeGeneratedTopic("course-1", "topic-1", "topic-2", "user-1");

    expect(prismaMock.questionSecondaryTopic.updateMany).toHaveBeenCalledWith({
      where: { topicId: "topic-1" },
      data: { topicId: "topic-2" },
    });
    expect(prismaMock.questionSecondaryTopic.deleteMany).not.toHaveBeenCalled();
  });

  it("drops only the tags that would collide on the target", async () => {
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce(SUGGESTION)
      .mockResolvedValueOnce({ id: "topic-2", name: "Recursion" });
    prismaMock.questionSecondaryTopic.findMany
      // q1, q2 and q3 all tag the source…
      .mockResolvedValueOnce([{ questionId: "q1" }, { questionId: "q2" }, { questionId: "q3" }])
      // …q1 already tags the target, so repointing it would collide.
      .mockResolvedValueOnce([{ questionId: "q1" }]);
    // …and q2's primary topic is now the target, making the tag a self-reference.
    prismaMock.question.findMany.mockResolvedValue([{ id: "q2" }]);

    await mergeGeneratedTopic("course-1", "topic-1", "topic-2", "user-1");

    const deleted = prismaMock.questionSecondaryTopic.deleteMany.mock.calls[0][0];
    expect(deleted.where.topicId).toBe("topic-1");
    expect([...deleted.where.questionId.in].sort()).toEqual(["q1", "q2"]);
    // q3 survives the merge, repointed onto the target.
    expect(prismaMock.questionSecondaryTopic.updateMany).toHaveBeenCalledWith({
      where: { topicId: "topic-1" },
      data: { topicId: "topic-2" },
    });
  });

  it("touches no secondary rows when the source carries none", async () => {
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce(SUGGESTION)
      .mockResolvedValueOnce({ id: "topic-2", name: "Recursion" });
    prismaMock.questionSecondaryTopic.findMany.mockResolvedValue([]);

    await mergeGeneratedTopic("course-1", "topic-1", "topic-2", "user-1");

    expect(prismaMock.questionSecondaryTopic.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.questionSecondaryTopic.updateMany).not.toHaveBeenCalled();
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
  /** A chunk row as the status read selects it. `batchKey` groups a split sync. */
  function jobRow(
    overrides: Partial<{
      id: string;
      status: string;
      errorMessage: string | null;
      createdAt: Date;
      completedAt: Date | null;
      result: unknown;
      batchKey: string | null;
    }> = {},
  ) {
    const { batchKey = "batch-1", ...rest } = overrides;
    return {
      id: "job-1",
      status: "COMPLETED",
      errorMessage: null,
      createdAt: new Date("2026-08-26T10:00:00.000Z"),
      completedAt: new Date("2026-08-26T10:00:00.000Z"),
      result: { created: 4, usedSource: "canvas-modules" },
      payload:
        batchKey === null
          ? { input: { kind: "topic-analysis" } }
          : { input: { kind: "topic-analysis", batchKey } },
      ...rest,
    };
  }

  it("reports the most recent job and the outstanding suggestion count", async () => {
    const createdAt = new Date("2026-08-26T10:00:00.000Z");
    prismaMock.aiJob.findMany.mockResolvedValue([jobRow()]);
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
    prismaMock.aiJob.findMany.mockResolvedValue([]);
    prismaMock.courseTopic.count.mockResolvedValue(0);

    expect(await latestTopicAnalysisForCourse("course-1")).toEqual({
      job: null,
      pendingSuggestions: 0,
    });
  });

  it("tolerates a job row whose result is missing or malformed", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ status: "FAILED", errorMessage: "boom", completedAt: null, result: null }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(0);

    const status = await latestTopicAnalysisForCourse("course-1");
    expect(status.job).toMatchObject({ created: null, usedSource: null, errorMessage: "boom" });
  });

  /**
   * An oversized sync becomes several rows. Reporting only the newest would let
   * a completed chunk hide a failed or still-running sibling — the instructor
   * would read "Suggested N topics" over a batch that half failed.
   */
  it("reports FAILED when an earlier chunk failed and the newest completed", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "chunk-b", status: "COMPLETED", result: { created: 3, usedSource: "ai" } }),
      jobRow({
        id: "chunk-a",
        status: "FAILED",
        errorMessage: "provider unreachable",
        createdAt: new Date("2026-08-26T09:00:00.000Z"),
        completedAt: null,
        result: null,
      }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(3);

    const status = await latestTopicAnalysisForCourse("course-1");
    expect(status.job).toMatchObject({
      id: "chunk-b",
      status: "FAILED",
      errorMessage: "provider unreachable",
      // The batch started when its first chunk was written.
      createdAt: new Date("2026-08-26T09:00:00.000Z").toISOString(),
      // Settled — a failed batch has finished, it just finished badly.
      completedAt: new Date("2026-08-26T10:00:00.000Z").toISOString(),
    });
  });

  it("stays in flight until every chunk settles", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "chunk-b", status: "COMPLETED" }),
      jobRow({ id: "chunk-a", status: "RUNNING", completedAt: null, result: null }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(0);

    const status = await latestTopicAnalysisForCourse("course-1");
    expect(status.job).toMatchObject({ status: "RUNNING", completedAt: null });
  });

  it("sums created counts across a completed batch", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "chunk-b", result: { created: 3, usedSource: "material-headings" } }),
      jobRow({ id: "chunk-a", result: { created: 4, usedSource: "material-headings" } }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(7);

    const status = await latestTopicAnalysisForCourse("course-1");
    expect(status.job).toMatchObject({ status: "COMPLETED", created: 7 });
  });

  it("labels the batch with the source that actually produced topics", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "chunk-b", result: { created: 0, usedSource: "none" } }),
      jobRow({ id: "chunk-a", result: { created: 5, usedSource: "canvas-modules" } }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(5);

    expect((await latestTopicAnalysisForCourse("course-1")).job).toMatchObject({
      usedSource: "canvas-modules",
    });
  });

  it("does not fold in rows from a different batch", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "current", batchKey: "batch-2" }),
      // An older, unrelated sync that failed — must not poison the new batch.
      jobRow({ id: "old", batchKey: "batch-1", status: "FAILED", errorMessage: "stale" }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(4);

    expect((await latestTopicAnalysisForCourse("course-1")).job).toMatchObject({
      id: "current",
      status: "COMPLETED",
      errorMessage: null,
    });
  });

  /**
   * After recordChunk recycles a reused FAILED row into the current batchKey
   * (#1699 follow-up), the status reader must still surface that failure even
   * when a later changed chunk completed under the same key.
   */
  it("reports FAILED when a recycled prior-failure chunk shares the current batchKey", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({
        id: "chunk-changed",
        batchKey: "batch-resync",
        result: { created: 3, usedSource: "material-headings" },
      }),
      jobRow({
        id: "chunk-unchanged-failed",
        batchKey: "batch-resync",
        status: "FAILED",
        errorMessage: "model unreachable",
        completedAt: null,
        result: null,
      }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(3);

    expect((await latestTopicAnalysisForCourse("course-1")).job).toMatchObject({
      id: "chunk-changed",
      status: "FAILED",
      errorMessage: "model unreachable",
    });
  });

  it("reads a pre-chunking row on its own", async () => {
    prismaMock.aiJob.findMany.mockResolvedValue([
      jobRow({ id: "legacy", batchKey: null }),
      jobRow({ id: "older", batchKey: null, status: "FAILED", errorMessage: "stale" }),
    ]);
    prismaMock.courseTopic.count.mockResolvedValue(4);

    expect((await latestTopicAnalysisForCourse("course-1")).job).toMatchObject({
      id: "legacy",
      status: "COMPLETED",
    });
  });
});

describe("retryTopicAnalysis", () => {
  it("clears the failed row and re-records over the course's ready materials", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
    prismaMock.course.findUnique.mockResolvedValue({
      externalId: "77",
      externalSource: "canvas",
    });
    recordTopicAnalysisJobs.mockResolvedValue([
      { jobId: "job-2", created: true, resumable: false },
    ]);

    expect(await retryTopicAnalysis("course-1", "user-1")).toEqual({ jobId: "job-2" });

    expect(prismaMock.aiJob.deleteMany.mock.calls[0][0].where).toMatchObject({
      courseId: "course-1",
      kind: "topic-analysis",
      status: "FAILED",
    });
    expect(recordTopicAnalysisJobs.mock.calls[0][0]).toMatchObject({
      materialIds: ["m1", "m2"],
      canvasCourseId: "77",
    });
  });

  it("passes no Canvas id for a course that was never Canvas linked", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }]);
    prismaMock.course.findUnique.mockResolvedValue({ externalId: null, externalSource: null });
    recordTopicAnalysisJobs.mockResolvedValue([
      { jobId: "job-2", created: true, resumable: false },
    ]);

    await retryTopicAnalysis("course-1", "user-1");

    expect(recordTopicAnalysisJobs.mock.calls[0][0].canvasCourseId).toBeNull();
  });

  it("returns null when the course has nothing to analyse", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    expect(await retryTopicAnalysis("course-1", "user-1")).toBeNull();
    expect(recordTopicAnalysisJobs).not.toHaveBeenCalled();
  });

  it("does not re-run a job that already exists for an unchanged corpus", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1" }]);
    prismaMock.course.findUnique.mockResolvedValue({ externalId: null, externalSource: null });
    recordTopicAnalysisJobs.mockResolvedValue([
      { jobId: "job-1", created: false, resumable: false },
    ]);

    expect(await retryTopicAnalysis("course-1", "user-1")).toEqual({ jobId: "job-1" });
    expect(runTopicAnalysisJob).not.toHaveBeenCalled();
  });
});
