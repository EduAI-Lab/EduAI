// @vitest-environment node
//
// #1624 — automatic topic provisioning, against the real test database.
//
// Covers the acceptance-criteria scenarios that are only meaningful with real
// constraints behind them: initial sync, resync of unchanged material, changed
// material, duplicate prevention under retry, job failure, and the zero-topic
// fallback.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

import prisma from "~/lib/prisma.server";
import { deleteCourseTopic } from "~/lib/courses/server";
import { ensureCourseHasTopic, FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";
import {
  recordTopicAnalysisJobs,
  resumeStaleTopicAnalysisJobs,
  runTopicAnalysisJob,
  topicAnalysisIdempotencyKey,
  TOPIC_ANALYSIS_LEASE_MS,
  type StartTopicAnalysisArgs,
} from "~/lib/topics/job.server";
import { provisionCourseTopics } from "~/lib/topics/provision.server";
import {
  approveGeneratedTopic,
  dismissGeneratedTopic,
  latestTopicAnalysisForCourse,
  mergeGeneratedTopic,
} from "~/lib/topics/review.server";

let courseId: string;
let userId: string;

/** A completion seam that never reaches a model. */
const noAi = vi.fn(async () => null);

/**
 * Single-chunk convenience over `recordTopicAnalysisJobs`.
 *
 * Every batch in this file is far below the per-job material bound, so it always
 * yields exactly one row; chunking itself is covered in the unit tests, where a
 * 501-material corpus can be set up without seeding 501 rows.
 */
async function recordTopicAnalysisJob(args: StartTopicAnalysisArgs) {
  const [job] = await recordTopicAnalysisJobs(args);
  return job ?? null;
}

async function seedMaterial(overrides: { id?: string; checksum: string; rawText: string }) {
  return prisma.courseMaterial.create({
    data: {
      courseId,
      title: `Material ${overrides.checksum}`,
      mimeType: "text/plain",
      fileSize: overrides.rawText.length,
      checksum: overrides.checksum,
      rawText: overrides.rawText,
      status: "READY",
      uploadedBy: userId,
    },
  });
}

async function liveTopics() {
  return prisma.courseTopic.findMany({
    where: { courseId, deletedAt: null },
    orderBy: { name: "asc" },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: "instructor-topic-provisioning@test.com",
      name: "Topic Provisioning Instructor",
      role: "INSTRUCTOR",
      emailVerified: false,
    },
  });
  userId = user.id;

  const course = await prisma.course.create({
    data: {
      name: "Topic Provisioning Course",
      code: "TPR 999",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
    },
  });
  courseId = course.id;
});

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.aiJob.deleteMany({ where: { courseId } });
  await prisma.courseTopic.deleteMany({ where: { courseId } });
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
});

afterAll(async () => {
  await prisma.aiJob.deleteMany({ where: { courseId } });
  await prisma.courseTopic.deleteMany({ where: { courseId } });
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("initial sync", () => {
  it("provisions chapter topics from a freshly processed material", async () => {
    const material = await seedMaterial({
      checksum: "sum-initial",
      rawText: "Chapter 1 — Limits\nChapter 2 — Derivatives\n",
    });

    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    expect(recorded).toMatchObject({ created: true });

    await runTopicAnalysisJob(recorded!.jobId, noAi);

    const topics = await liveTopics();
    expect(topics.map((topic) => topic.name)).toEqual([
      "Chapter 1 — Limits",
      "Chapter 2 — Derivatives",
    ]);
    expect(topics.every((topic) => topic.reviewStatus === "SUGGESTED")).toBe(true);
    expect(topics.every((topic) => topic.origin === "MATERIAL_HEADING")).toBe(true);
    expect(topics.every((topic) => topic.generatedByJobId === recorded!.jobId)).toBe(true);
  });

  it("records which materials each generated topic came from", async () => {
    const material = await seedMaterial({
      checksum: "sum-sources",
      rawText: "Chapter 1 — Limits\n",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    const [topic] = await liveTopics();
    const sources = await prisma.courseTopicSource.findMany({ where: { topicId: topic.id } });
    expect(sources.map((source) => source.materialId)).toEqual([material.id]);
  });

  it("marks the job COMPLETED with a readable summary", async () => {
    const material = await seedMaterial({ checksum: "sum-summary", rawText: "Chapter 1 — Limits" });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({
      status: "COMPLETED",
      created: 1,
      usedSource: "material-headings",
    });
    expect(status.pendingSuggestions).toBe(1);
  });
});

describe("resync and retry", () => {
  it("reuses the same job when an unchanged batch is retried", async () => {
    const material = await seedMaterial({ checksum: "sum-stable", rawText: "Chapter 1 — Limits" });

    const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    const second = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });

    // Resumable because nothing has claimed the PENDING row yet — adopting it is
    // still what stops a second row being minted for the same corpus.
    expect(second).toEqual({ jobId: first!.jobId, created: false, resumable: true });
    expect(await prisma.aiJob.count({ where: { courseId, kind: "topic-analysis" } })).toBe(1);
  });

  it("does not create duplicate topics when the job is run twice", async () => {
    const material = await seedMaterial({ checksum: "sum-twice", rawText: "Chapter 1 — Limits" });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });

    await runTopicAnalysisJob(recorded!.jobId, noAi);
    // The second run cannot claim a COMPLETED row, which is what makes a
    // duplicated delivery a no-op rather than a duplicated topic list.
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    expect((await liveTopics()).map((topic) => topic.name)).toEqual(["Chapter 1 — Limits"]);
  });

  it("runs a fresh job when a material's content actually changes", async () => {
    const material = await seedMaterial({ checksum: "sum-v1", rawText: "Chapter 1 — Limits" });
    const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    await runTopicAnalysisJob(first!.jobId, noAi);

    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { checksum: "sum-v2", rawText: "Chapter 1 — Limits\nChapter 2 — Derivatives" },
    });

    const second = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    expect(second).toMatchObject({ created: true });
    expect(second!.jobId).not.toBe(first!.jobId);

    await runTopicAnalysisJob(second!.jobId, noAi);

    expect((await liveTopics()).map((topic) => topic.name)).toEqual([
      "Chapter 1 — Limits",
      "Chapter 2 — Derivatives",
    ]);
  });

  it("keys the job on content, so the same corpus hashes identically", async () => {
    expect(topicAnalysisIdempotencyKey(courseId, ["a", "b"])).toBe(
      topicAnalysisIdempotencyKey(courseId, ["b", "a"]),
    );
  });
});

describe("existing topics are never modified", () => {
  it("leaves an instructor's topic alone and skips it as a duplicate", async () => {
    const human = await prisma.courseTopic.create({
      data: { courseId, name: "Chapter 1 — Limits", createdBy: userId },
    });
    const material = await seedMaterial({
      checksum: "sum-human",
      rawText: "Chapter 1: limits\nChapter 2 — Derivatives",
    });

    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    const after = await prisma.courseTopic.findUniqueOrThrow({ where: { id: human.id } });
    expect(after).toMatchObject({
      name: "Chapter 1 — Limits",
      origin: "HUMAN",
      reviewStatus: "ACCEPTED",
      deletedAt: null,
      createdBy: userId,
    });
    expect((await liveTopics()).map((topic) => topic.name)).toEqual([
      "Chapter 1 — Limits",
      "Chapter 2 — Derivatives",
    ]);
  });

  it("does not re-propose a dismissed suggestion on the next run", async () => {
    const material = await seedMaterial({
      checksum: "sum-dismiss-1",
      rawText: "Chapter 1 — Limits",
    });
    const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    await runTopicAnalysisJob(first!.jobId, noAi);

    const [suggestion] = await liveTopics();
    expect(await dismissGeneratedTopic(courseId, suggestion.id, userId)).toMatchObject({
      status: "200",
    });

    // Same content, new batch identity — the generator must still not resurrect it.
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { checksum: "sum-dismiss-2" },
    });
    const second = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    await runTopicAnalysisJob(second!.jobId, noAi);

    expect(await liveTopics()).toHaveLength(1);
    expect((await liveTopics())[0].name).toBe(FALLBACK_TOPIC_NAME);
  });
});

describe("zero-topic fallback", () => {
  it("creates Uncategorized for a course with no topics", async () => {
    expect(await ensureCourseHasTopic(courseId)).toBe(true);

    const topics = await liveTopics();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      name: FALLBACK_TOPIC_NAME,
      origin: "SYSTEM",
      reviewStatus: "ACCEPTED",
    });
  });

  it("is idempotent and does not stack fallbacks", async () => {
    await ensureCourseHasTopic(courseId);
    expect(await ensureCourseHasTopic(courseId)).toBe(false);
    expect(await liveTopics()).toHaveLength(1);
  });

  it("leaves the course authorable when analysis finds nothing", async () => {
    const material = await seedMaterial({
      checksum: "sum-nothing",
      rawText: "prose with no structure whatsoever",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });

    await runTopicAnalysisJob(recorded!.jobId, noAi);

    expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({ status: "COMPLETED", created: 0, usedSource: "none" });
  });

  it("records FAILED and still guarantees a topic when the AI path throws", async () => {
    const material = await seedMaterial({
      checksum: "sum-ai-fail",
      rawText: "prose with no structure whatsoever",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });

    await runTopicAnalysisJob(recorded!.jobId, async () => {
      throw new Error("model unreachable");
    });

    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({ status: "FAILED" });
    expect(status.job?.errorMessage).toContain("model unreachable");
    expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
  });
});

describe("review actions", () => {
  async function seedSuggestion(name: string) {
    return prisma.courseTopic.create({
      data: {
        courseId,
        name,
        origin: "MATERIAL_HEADING",
        reviewStatus: "SUGGESTED",
        confidence: 0.8,
      },
    });
  }

  it("approve clears the suggestion flag", async () => {
    const topic = await seedSuggestion("Chapter 1 — Limits");

    await approveGeneratedTopic(courseId, topic.id);

    const after = await prisma.courseTopic.findUniqueOrThrow({ where: { id: topic.id } });
    expect(after.reviewStatus).toBe("ACCEPTED");
    expect(after.deletedAt).toBeNull();
  });

  it("approve refuses a topic that is not a suggestion", async () => {
    const human = await prisma.courseTopic.create({
      data: { courseId, name: "Hand written", createdBy: userId },
    });

    expect(await approveGeneratedTopic(courseId, human.id)).toEqual({
      status: "404",
      error: "TOPIC_NOT_FOUND",
    });
  });

  it("merge repoints questions and dismisses the source", async () => {
    const source = await seedSuggestion("Chapter 1 — Limits");
    const target = await prisma.courseTopic.create({
      data: { courseId, name: "Limits", createdBy: userId },
    });
    const question = await prisma.question.create({
      data: {
        courseId,
        topicId: source.id,
        createdBy: userId,
        content: "What is a limit?",
        type: "SA",
      },
    });

    const result = await mergeGeneratedTopic(courseId, source.id, target.id, userId);
    expect(result).toMatchObject({ status: "200" });

    expect((await prisma.question.findUniqueOrThrow({ where: { id: question.id } })).topicId).toBe(
      target.id,
    );
    expect(
      (await prisma.courseTopic.findUniqueOrThrow({ where: { id: source.id } })).deletedAt,
    ).not.toBeNull();

    await prisma.question.deleteMany({ where: { courseId } });
  });

  it("dismiss refuses to orphan authored questions", async () => {
    const suggestion = await seedSuggestion("Chapter 1 — Limits");
    await prisma.question.create({
      data: {
        courseId,
        topicId: suggestion.id,
        createdBy: userId,
        content: "What is a limit?",
        type: "SA",
      },
    });

    expect(await dismissGeneratedTopic(courseId, suggestion.id, userId)).toEqual({
      status: "409",
      error: "TOPIC_HAS_QUESTIONS",
    });

    await prisma.question.deleteMany({ where: { courseId } });
  });

  it("carries a secondary tag across a merge rather than discarding it", async () => {
    const source = await seedSuggestion("Chapter 1 — Limits");
    const target = await prisma.courseTopic.create({
      data: { courseId, name: "Limits", createdBy: userId },
    });
    const other = await prisma.courseTopic.create({
      data: { courseId, name: "Continuity", createdBy: userId },
    });
    // The question's primary topic is unrelated, so nothing about the merge
    // makes its secondary tag redundant — it must survive, repointed.
    const question = await prisma.question.create({
      data: {
        courseId,
        topicId: other.id,
        createdBy: userId,
        content: "What is a limit?",
        type: "SA",
        secondaryTopics: { create: [{ topicId: source.id }] },
      },
    });

    expect(await mergeGeneratedTopic(courseId, source.id, target.id, userId)).toMatchObject({
      status: "200",
    });

    const tags = await prisma.questionSecondaryTopic.findMany({
      where: { questionId: question.id },
    });
    expect(tags.map((tag) => tag.topicId)).toEqual([target.id]);

    await prisma.question.deleteMany({ where: { courseId } });
  });

  it("drops a secondary tag the merge would duplicate on the target", async () => {
    const source = await seedSuggestion("Chapter 1 — Limits");
    const target = await prisma.courseTopic.create({
      data: { courseId, name: "Limits", createdBy: userId },
    });
    const other = await prisma.courseTopic.create({
      data: { courseId, name: "Continuity", createdBy: userId },
    });
    // Already tags the target, so repointing would collide on the composite key.
    const question = await prisma.question.create({
      data: {
        courseId,
        topicId: other.id,
        createdBy: userId,
        content: "What is a limit?",
        type: "SA",
        secondaryTopics: { create: [{ topicId: source.id }, { topicId: target.id }] },
      },
    });

    expect(await mergeGeneratedTopic(courseId, source.id, target.id, userId)).toMatchObject({
      status: "200",
    });

    const tags = await prisma.questionSecondaryTopic.findMany({
      where: { questionId: question.id },
    });
    expect(tags.map((tag) => tag.topicId)).toEqual([target.id]);

    await prisma.question.deleteMany({ where: { courseId } });
  });

  it("dismiss refuses when the only references are secondary tags", async () => {
    const suggestion = await seedSuggestion("Chapter 1 — Limits");
    const other = await prisma.courseTopic.create({
      data: { courseId, name: "Continuity", createdBy: userId },
    });
    await prisma.question.create({
      data: {
        courseId,
        topicId: other.id,
        createdBy: userId,
        content: "What is a limit?",
        type: "SA",
        secondaryTopics: { create: [{ topicId: suggestion.id }] },
      },
    });

    expect(await dismissGeneratedTopic(courseId, suggestion.id, userId)).toEqual({
      status: "409",
      error: "TOPIC_HAS_QUESTIONS",
    });

    await prisma.question.deleteMany({ where: { courseId } });
  });

  it("restores the fallback when the last topic is dismissed", async () => {
    const suggestion = await seedSuggestion("Chapter 1 — Limits");

    expect(await dismissGeneratedTopic(courseId, suggestion.id, userId)).toMatchObject({
      status: "200",
    });

    // Authoring must never be blocked, so the course is left with Uncategorized.
    expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
  });
});

describe("stale job recovery", () => {
  it("resumes a RUNNING row abandoned past its lease", async () => {
    const material = await seedMaterial({
      checksum: "sum-stale",
      rawText: "Chapter 1 — Limits",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    // Simulate a process that died after claiming the row.
    await prisma.aiJob.update({
      where: { id: recorded!.jobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(Date.now() - TOPIC_ANALYSIS_LEASE_MS - 60_000),
      },
    });

    expect(await resumeStaleTopicAnalysisJobs(courseId)).toEqual([recorded!.jobId]);

    // The resume runs without awaiting; wait for the row to reach a terminal state.
    await vi.waitFor(async () => {
      const row = await prisma.aiJob.findUniqueOrThrow({ where: { id: recorded!.jobId } });
      expect(row.status).toBe("COMPLETED");
    });
    expect((await liveTopics()).map((topic) => topic.name)).toContain("Chapter 1 — Limits");
  });

  it("leaves a job still inside its lease alone", async () => {
    const material = await seedMaterial({
      checksum: "sum-healthy",
      rawText: "Chapter 1 — Limits",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await prisma.aiJob.update({
      where: { id: recorded!.jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    expect(await resumeStaleTopicAnalysisJobs(courseId)).toEqual([]);
    expect((await prisma.aiJob.findUniqueOrThrow({ where: { id: recorded!.jobId } })).status).toBe(
      "RUNNING",
    );
  });

  it("reports an abandoned batch as resumable when the same corpus syncs again", async () => {
    const material = await seedMaterial({
      checksum: "sum-abandoned",
      rawText: "Chapter 1 — Limits",
    });
    const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    await prisma.aiJob.update({
      where: { id: first!.jobId },
      data: {
        status: "RUNNING",
        startedAt: new Date(Date.now() - TOPIC_ANALYSIS_LEASE_MS - 60_000),
      },
    });

    const second = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });

    // Same row (the idempotency key is unchanged), but now the caller may run it
    // — which is what stops the banner sitting in flight forever.
    expect(second).toEqual({ jobId: first!.jobId, created: false, resumable: true });
  });
});

describe("batch status aggregation", () => {
  /**
   * An oversized sync becomes several rows sharing a `batchKey`. Reporting only
   * the newest would let a completed chunk hide a failed sibling, so the banner
   * would claim success over a batch that half failed.
   */
  it("reports a batch as FAILED while any chunk failed", async () => {
    const material = await seedMaterial({
      checksum: "sum-batch",
      rawText: "Chapter 1 — Limits",
    });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    // A sibling chunk of the same batch that failed, written directly so the
    // batch has one completed and one failed row.
    const completed = await prisma.aiJob.findUniqueOrThrow({ where: { id: recorded!.jobId } });
    await prisma.aiJob.create({
      data: {
        kind: "topic-analysis",
        type: "background",
        source: "core:topic-analysis",
        status: "FAILED",
        errorMessage: "provider unreachable",
        completedAt: new Date(),
        payload: completed.payload as object,
        userId,
        courseId,
        queueName: completed.queueName,
        bullJobId: `${completed.bullJobId}-sibling`,
      },
    });

    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({
      status: "FAILED",
      errorMessage: "provider unreachable",
    });
  });
});

describe("the course always keeps an authorable topic", () => {
  it("refuses to delete the fallback when it is the only live topic", async () => {
    await ensureCourseHasTopic(courseId);

    expect(await deleteCourseTopic(courseId, { name: FALLBACK_TOPIC_NAME })).toEqual({
      status: "409",
      error: "LAST_TOPIC_PROTECTED",
    });
    expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
  });

  it("restores the fallback when the last real topic is deleted", async () => {
    const topic = await prisma.courseTopic.create({
      data: { courseId, name: "Limits", createdBy: userId },
    });

    expect(await deleteCourseTopic(courseId, { topicId: topic.id })).toMatchObject({
      status: "204",
    });
    expect((await liveTopics()).map((t) => t.name)).toEqual([FALLBACK_TOPIC_NAME]);
  });

  it("allows deleting the fallback once real topics exist", async () => {
    await ensureCourseHasTopic(courseId);
    await prisma.courseTopic.create({
      data: { courseId, name: "Limits", createdBy: userId },
    });

    expect(await deleteCourseTopic(courseId, { name: FALLBACK_TOPIC_NAME })).toMatchObject({
      status: "204",
    });
    expect((await liveTopics()).map((topic) => topic.name)).toEqual(["Limits"]);
  });
});

describe("provisionCourseTopics reads only processed material", () => {
  it("ignores a material that is still processing", async () => {
    const material = await seedMaterial({
      checksum: "sum-processing",
      rawText: "Chapter 1 — Limits",
    });
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { status: "PROCESSING" },
    });

    const result = await provisionCourseTopics({
      courseId,
      materialIds: [material.id],
      canvasCourseId: null,
      userId,
      jobId: "job-x",
      runCompletion: noAi,
    });

    expect(result).toMatchObject({ created: 0, usedSource: "none" });
  });
});
