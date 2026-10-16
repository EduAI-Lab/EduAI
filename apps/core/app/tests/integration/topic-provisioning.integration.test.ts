// @vitest-environment node
//
// #1624 — automatic topic provisioning, against the real test database.
//
// Covers the acceptance-criteria scenarios that are only meaningful with real
// constraints behind them: initial sync, resync of unchanged material, changed
// material, duplicate prevention under retry, job failure, and the zero-topic
// fallback.
//
// #1965: the job that runs after uploads now files materials under the course's
// existing topics instead of generating new ones. The generator itself is kept
// for on-demand suggestions (#1966), so its tests call it directly.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

import prisma from "~/lib/prisma.server";
import {
  deleteCourseTopic,
  getCourseTopicNamesCached,
  getCourseTopicsWithSources,
  getCourseTopicWithSources,
  invalidateCourseTopicNamesCache,
} from "~/lib/courses/server";
import { ensureCourseHasTopic, FALLBACK_TOPIC_NAME } from "~/lib/topics/fallback.server";
import { removeOrphanedSuggestions } from "~/lib/topics/orphaned-suggestions.server";
import {
  recordTopicAnalysisJobs,
  resumeStaleTopicAnalysisJobs,
  runTopicAnalysisJob,
  topicAnalysisIdempotencyKey,
  TOPIC_ANALYSIS_LEASE_MS,
  type StartTopicAnalysisArgs,
} from "~/lib/topics/job.server";
import { matchMaterialsToTopics } from "~/lib/topics/auto-match.server";
import { setMaterialTopics } from "~/lib/topics/material-topics.server";
import { suggestCourseTopics } from "~/lib/topics/suggest.server";
import { provisionCourseTopics, type RunTopicCompletion } from "~/lib/topics/provision.server";
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

async function softDeleteMaterial(materialId: string) {
  await prisma.courseMaterial.update({
    where: { id: materialId },
    data: { deletedAt: new Date() },
  });
}

/** Run the topic generator directly; uploads no longer run it (#1965). */
async function generateTopics(materialIds: string[]) {
  return provisionCourseTopics({
    courseId,
    materialIds,
    canvasCourseId: null,
    userId,
    jobId: "job-generate",
    runCompletion: noAi,
  });
}

async function acceptedTopic(name: string) {
  return prisma.courseTopic.create({ data: { courseId, name, createdBy: userId } });
}

/** Names of the topics a material is filed under, main topic first. */
async function materialTopicNames(materialId: string) {
  const links = await prisma.courseTopicSource.findMany({
    where: { materialId, topic: { deletedAt: null, reviewStatus: "ACCEPTED" } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { topic: { select: { name: true } } },
  });
  return links.map((link) => link.topic.name);
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

    await generateTopics([material.id]);

    const topics = await liveTopics();
    expect(topics.map((topic) => topic.name)).toEqual([
      "Chapter 1 — Limits",
      "Chapter 2 — Derivatives",
    ]);
    expect(topics.every((topic) => topic.reviewStatus === "SUGGESTED")).toBe(true);
    expect(topics.every((topic) => topic.origin === "MATERIAL_HEADING")).toBe(true);
    expect(topics.every((topic) => topic.generatedByJobId === "job-generate")).toBe(true);
  });

  it("records which materials each generated topic came from", async () => {
    const material = await seedMaterial({
      checksum: "sum-sources",
      rawText: "Chapter 1 — Limits\n",
    });
    await generateTopics([material.id]);

    const [topic] = await liveTopics();
    const sources = await prisma.courseTopicSource.findMany({ where: { topicId: topic.id } });
    expect(sources.map((source) => source.materialId)).toEqual([material.id]);
  });

  it("marks the job COMPLETED with a readable summary", async () => {
    await acceptedTopic("Chapter 1 — Limits");
    const material = await seedMaterial({ checksum: "sum-summary", rawText: "Chapter 1 — Limits" });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({ status: "COMPLETED", matched: 1, unmatched: 0 });
    expect(status.pendingSuggestions).toBe(0);
    expect(await materialTopicNames(material.id)).toEqual(["Chapter 1 — Limits"]);
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

  it("does not file a material twice when the job is run twice", async () => {
    await acceptedTopic("Chapter 1 — Limits");
    const material = await seedMaterial({ checksum: "sum-twice", rawText: "Chapter 1 — Limits" });
    const recorded = await recordTopicAnalysisJob({
      courseId,
      userId,
      materialIds: [material.id],
    });

    await runTopicAnalysisJob(recorded!.jobId, noAi);
    // The second run cannot claim a COMPLETED row, which is what makes a
    // duplicated delivery a no-op rather than a duplicated link.
    await runTopicAnalysisJob(recorded!.jobId, noAi);

    expect(await prisma.courseTopicSource.count({ where: { materialId: material.id } })).toBe(1);
  });

  it("runs a fresh job when a material's content actually changes", async () => {
    await acceptedTopic("Chapter 1 — Limits");
    await acceptedTopic("Chapter 2 — Derivatives");
    const material = await seedMaterial({ checksum: "sum-v1", rawText: "Chapter 1 — Limits" });
    const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    await runTopicAnalysisJob(first!.jobId, noAi);

    await prisma.courseMaterial.update({
      where: { id: material.id },
      // Reprocessed after its first link was made, so it is matched again.
      data: {
        checksum: "sum-v2",
        rawText: "Chapter 2 — Derivatives",
        processedAt: new Date(Date.now() + 1000),
      },
    });

    const second = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
    expect(second).toMatchObject({ created: true });
    expect(second!.jobId).not.toBe(first!.jobId);

    await runTopicAnalysisJob(second!.jobId, noAi);

    // Matching adds the new fit and never removes the old one.
    expect(await materialTopicNames(material.id)).toEqual([
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

    await generateTopics([material.id]);

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
    await generateTopics([material.id]);

    const [suggestion] = await liveTopics();
    expect(await dismissGeneratedTopic(courseId, suggestion.id, userId)).toMatchObject({
      status: "200",
    });

    // A second run over the same material must still not resurrect it. The
    // dismissal restored the fallback, since it left the course with no topics.
    await generateTopics([material.id]);

    expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
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
    // No accepted topics to match against: nothing filed, nothing asked of a model.
    const status = await latestTopicAnalysisForCourse(courseId);
    expect(status.job).toMatchObject({ status: "COMPLETED", matched: 0, unmatched: 0 });
  });

  it("records FAILED when the model throws, leaving the course's topics alone", async () => {
    await acceptedTopic("Integrals");
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
    expect((await liveTopics()).map((topic) => topic.name)).toEqual(["Integrals"]);
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
    await acceptedTopic("Chapter 1 — Limits");
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
    expect(await materialTopicNames(material.id)).toEqual(["Chapter 1 — Limits"]);
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

// #1937: a suggestion is the instructor's to review, so students and course chat
// never see one, and it does not outlive the material it was derived from.
describe("unreviewed suggestions stay with staff and their materials (#1937)", () => {
  async function seedSuggestion(name: string, materialIds: string[]) {
    return prisma.courseTopic.create({
      data: {
        courseId,
        name,
        origin: "MATERIAL_HEADING",
        reviewStatus: "SUGGESTED",
        confidence: 0.8,
        sources: { create: materialIds.map((materialId) => ({ materialId })) },
      },
    });
  }

  /** Fallback first: it is only created for a course with no live topics. */
  async function seedMixedTopics() {
    const material = await seedMaterial({ checksum: "sum-mixed", rawText: "Chapter 2" });
    await ensureCourseHasTopic(courseId);
    await prisma.courseTopic.create({ data: { courseId, name: "Limits", createdBy: userId } });
    const suggestion = await seedSuggestion("Chapter 2 — Derivatives", [material.id]);
    return { suggestion };
  }

  it("lists only accepted topics for learners, while staff still see everything", async () => {
    const { suggestion } = await seedMixedTopics();

    const learner = await getCourseTopicsWithSources(courseId, false, "learner");
    expect(learner.map((topic) => topic.name)).toEqual(["Limits"]);
    expect(await getCourseTopicWithSources(courseId, suggestion.id, false, "learner")).toBeNull();

    const staff = await getCourseTopicsWithSources(courseId);
    expect(staff.map((topic) => topic.name)).toEqual([
      "Chapter 2 — Derivatives",
      "Limits",
      FALLBACK_TOPIC_NAME,
    ]);
  });

  it("gives course chat only accepted topic names", async () => {
    await seedMixedTopics();
    invalidateCourseTopicNamesCache(courseId);

    // The chat prompt lists `accepted`; the scope classifier also gets
    // `suggested` (#1936). The "Uncategorized" fallback is in neither.
    expect(await getCourseTopicNamesCached(courseId)).toEqual({
      accepted: ["Limits"],
      suggested: ["Chapter 2 — Derivatives"],
    });
  });

  it("puts a suggestion into course chat as soon as it is approved", async () => {
    const { suggestion } = await seedMixedTopics();
    invalidateCourseTopicNamesCache(courseId);
    expect((await getCourseTopicNamesCached(courseId)).accepted).toEqual(["Limits"]);

    await approveGeneratedTopic(courseId, suggestion.id);

    expect((await getCourseTopicNamesCached(courseId)).accepted).toEqual([
      "Chapter 2 — Derivatives",
      "Limits",
    ]);
  });

  it("stops naming a deleted material as a topic's source", async () => {
    const kept = await seedMaterial({ checksum: "sum-kept", rawText: "Chapter 3" });
    const gone = await seedMaterial({ checksum: "sum-gone", rawText: "Chapter 3" });
    await seedSuggestion("Chapter 3 — Integrals", [kept.id, gone.id]);
    await softDeleteMaterial(gone.id);

    const [topic] = await getCourseTopicsWithSources(courseId);
    expect(topic.sources).toEqual([{ materialId: kept.id, title: kept.title }]);
    expect(topic.sourceCount).toBe(1);
  });

  describe("removeOrphanedSuggestions", () => {
    it("hard-deletes a suggestion once every material it came from is deleted", async () => {
      const only = await seedMaterial({ checksum: "sum-only", rawText: "Chapter 4" });
      const other = await seedMaterial({ checksum: "sum-other", rawText: "Chapter 4" });
      const orphan = await seedSuggestion("Chapter 4 — Series", [only.id]);
      const shared = await seedSuggestion("Chapter 5 — Vectors", [only.id, other.id]);
      await softDeleteMaterial(only.id);

      expect(await removeOrphanedSuggestions(courseId)).toBe(1);

      // Gone, not soft-deleted, so a revised upload can suggest the name again.
      expect(await prisma.courseTopic.findUnique({ where: { id: orphan.id } })).toBeNull();
      expect(await prisma.courseTopic.findUnique({ where: { id: shared.id } })).not.toBeNull();
    });

    it("leaves accepted topics, dismissals, used suggestions and source-less ones alone", async () => {
      const material = await seedMaterial({ checksum: "sum-guarded", rawText: "Chapter 6" });
      const accepted = await prisma.courseTopic.create({
        data: {
          courseId,
          name: "Approved from the deleted file",
          reviewStatus: "ACCEPTED",
          sources: { create: [{ materialId: material.id }] },
        },
      });
      const dismissed = await seedSuggestion("Dismissed by the instructor", [material.id]);
      await prisma.courseTopic.update({
        where: { id: dismissed.id },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
      const used = await seedSuggestion("Has a question on it", [material.id]);
      await prisma.question.create({
        data: { courseId, topicId: used.id, createdBy: userId, content: "Q?", type: "SA" },
      });
      // A Canvas module with no files yields a suggestion with no sources at all.
      const sourceless = await seedSuggestion("Module with no files", []);
      await softDeleteMaterial(material.id);

      expect(await removeOrphanedSuggestions(courseId)).toBe(0);

      const ids = [accepted.id, dismissed.id, used.id, sourceless.id];
      expect(await prisma.courseTopic.count({ where: { id: { in: ids } } })).toBe(4);

      await prisma.question.deleteMany({ where: { courseId } });
    });

    it("restores the Uncategorized fallback when the removal empties the course", async () => {
      const material = await seedMaterial({ checksum: "sum-last", rawText: "Chapter 7" });
      await seedSuggestion("Chapter 7 — Proofs", [material.id]);
      await softDeleteMaterial(material.id);

      await removeOrphanedSuggestions(courseId);

      expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);
    });

    it("re-suggests a restored file's topics, but never one the instructor dismissed", async () => {
      const material = await seedMaterial({
        checksum: "sum-restored",
        rawText: "Chapter 1 — Limits\nChapter 2 — Derivatives\n",
      });
      const first = await recordTopicAnalysisJob({ courseId, userId, materialIds: [material.id] });
      await runTopicAnalysisJob(first!.jobId, noAi);
      await generateTopics([material.id]);
      const limits = await prisma.courseTopic.findFirstOrThrow({
        where: { courseId, name: "Chapter 1 — Limits" },
      });
      await dismissGeneratedTopic(courseId, limits.id, userId);

      // Delete: the undismissed suggestion goes with the file.
      await softDeleteMaterial(material.id);
      await removeOrphanedSuggestions(courseId);
      expect((await liveTopics()).map((topic) => topic.name)).toEqual([FALLBACK_TOPIC_NAME]);

      // Re-upload of the same file: the row is restored, same checksum, so the
      // earlier analysis is COMPLETED under the same key and must be re-run.
      await prisma.courseMaterial.update({
        where: { id: material.id },
        data: { deletedAt: null },
      });
      const [again] = await recordTopicAnalysisJobs({
        courseId,
        userId,
        materialIds: [material.id],
        rerunCompleted: true,
      });
      expect(again).toMatchObject({ jobId: first!.jobId, resumable: true });
      await runTopicAnalysisJob(again.jobId, noAi);
      await generateTopics([material.id]);

      expect((await liveTopics()).map((topic) => topic.name)).toEqual([
        "Chapter 2 — Derivatives",
        FALLBACK_TOPIC_NAME,
      ]);
    });

    it("runs on the transaction it is handed, alongside the material delete", async () => {
      const material = await seedMaterial({ checksum: "sum-tx", rawText: "Chapter 8" });
      const orphan = await seedSuggestion("Chapter 8 — Sets", [material.id]);

      await prisma.$transaction(async (tx) => {
        await tx.courseMaterial.update({
          where: { id: material.id },
          data: { deletedAt: new Date() },
        });
        await removeOrphanedSuggestions(courseId, tx);
      });

      expect(await prisma.courseTopic.findUnique({ where: { id: orphan.id } })).toBeNull();
    });
  });
});

// #1965: uploads are filed under the course's existing topics, and instructors
// choose a material's topics themselves.
describe("auto-matching uploads to existing topics (#1965)", () => {
  function match(materialIds: string[], runCompletion: RunTopicCompletion = noAi) {
    return matchMaterialsToTopics({
      courseId,
      materialIds,
      canvasCourseId: null,
      userId,
      runCompletion,
    });
  }

  /** A completion seam that always chooses `match` (null: "none fits"). */
  function replying(match: string | null) {
    return vi.fn(async () => JSON.stringify({ match }));
  }

  it("files a material whose heading names a topic, without asking a model", async () => {
    await acceptedTopic("Chapter 3 — Loop");
    const material = await seedMaterial({ checksum: "m-heading", rawText: "Chapter 3: Loops" });

    expect(await match([material.id])).toEqual({ matched: 1, unmatched: 0 });
    expect(await materialTopicNames(material.id)).toEqual(["Chapter 3 — Loop"]);
    expect(noAi).not.toHaveBeenCalled();
  });

  it("asks the model when the structure names no topic, and files by its choice", async () => {
    await acceptedTopic("Recursion");
    await acceptedTopic("Sorting");
    const material = await seedMaterial({ checksum: "m-model", rawText: "quicksort and merge" });
    const model = replying("sorting");

    expect(await match([material.id], model)).toEqual({ matched: 1, unmatched: 0 });
    expect(await materialTopicNames(material.id)).toEqual(["Sorting"]);
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("leaves a material unfiled when the model says none fits, creating nothing", async () => {
    await acceptedTopic("Recursion");
    const material = await seedMaterial({ checksum: "m-none", rawText: "linear algebra" });

    expect(await match([material.id], replying(null))).toEqual({
      matched: 0,
      unmatched: 1,
    });
    expect(await materialTopicNames(material.id)).toEqual([]);
    expect((await liveTopics()).map((topic) => topic.name)).toEqual(["Recursion"]);
  });

  it("ignores a model choice that is not one of the course's topics", async () => {
    await acceptedTopic("Recursion");
    const material = await seedMaterial({ checksum: "m-invented", rawText: "graphs" });

    expect(await match([material.id], replying("Graph Theory"))).toEqual({
      matched: 0,
      unmatched: 1,
    });
    expect(await liveTopics()).toHaveLength(1);
  });

  it("never files under a suggestion or the fallback, and skips the model with nothing else", async () => {
    await ensureCourseHasTopic(courseId);
    await prisma.courseTopic.create({
      data: { courseId, name: "Chapter 1 — Limits", origin: "AI", reviewStatus: "SUGGESTED" },
    });
    const material = await seedMaterial({ checksum: "m-suggested", rawText: "Chapter 1 — Limits" });

    expect(await match([material.id])).toEqual({ matched: 0, unmatched: 0 });
    expect(noAi).not.toHaveBeenCalled();
  });

  it("leaves a material whose topics were set by hand alone", async () => {
    await acceptedTopic("Chapter 1 — Limits");
    const material = await seedMaterial({ checksum: "m-manual", rawText: "Chapter 1 — Limits" });
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { topicsSetManuallyAt: new Date() },
    });

    expect(await match([material.id])).toEqual({ matched: 0, unmatched: 0 });
    expect(await materialTopicNames(material.id)).toEqual([]);
  });

  it("does not add a topic to a material that already has three", async () => {
    const material = await seedMaterial({
      checksum: "m-full",
      rawText: "Chapter 4 — Trees",
    });
    for (const [position, name] of ["A topic", "B topic", "C topic"].entries()) {
      const topic = await acceptedTopic(name);
      await prisma.courseTopicSource.create({
        data: { topicId: topic.id, materialId: material.id, position },
      });
    }
    await acceptedTopic("Chapter 4 — Trees");
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { processedAt: new Date(Date.now() + 1000) },
    });

    expect(await match([material.id])).toEqual({ matched: 0, unmatched: 0 });
    expect(await materialTopicNames(material.id)).toEqual(["A topic", "B topic", "C topic"]);
  });
});

describe("instructors choosing a material's topics (#1965)", () => {
  function choose(
    materialId: string,
    topics: Parameters<typeof setMaterialTopics>[0]["topics"],
    canCreateTopics = true,
  ) {
    return setMaterialTopics({ courseId, materialId, topics, userId, canCreateTopics });
  }

  it("saves the topics in order and stops auto-matching from changing them", async () => {
    const a = await acceptedTopic("Arrays");
    const b = await acceptedTopic("Big-O");
    const material = await seedMaterial({ checksum: "c-order", rawText: "x" });

    const outcome = await choose(material.id, [{ topicId: b.id }, { topicId: a.id }]);

    expect(outcome).toMatchObject({ status: "200", createdTopics: [] });
    expect(await materialTopicNames(material.id)).toEqual(["Big-O", "Arrays"]);
    const row = await prisma.courseMaterial.findUniqueOrThrow({ where: { id: material.id } });
    expect(row.topicsSetManuallyAt).not.toBeNull();
  });

  it("reuses an existing topic for a typed near-duplicate name", async () => {
    await acceptedTopic("Loops");
    const material = await seedMaterial({ checksum: "c-plural", rawText: "x" });

    expect(await choose(material.id, [{ name: "  loop " }])).toMatchObject({
      status: "200",
      createdTopics: [],
    });
    expect(await materialTopicNames(material.id)).toEqual(["Loops"]);
    expect(await liveTopics()).toHaveLength(1);
  });

  it("creates a new name as an accepted instructor topic", async () => {
    const material = await seedMaterial({ checksum: "c-new", rawText: "x" });

    const outcome = await choose(material.id, [{ name: "Hash tables" }]);

    expect(outcome).toMatchObject({ status: "200", createdTopics: [{ name: "Hash tables" }] });
    const [topic] = await liveTopics();
    expect(topic).toMatchObject({
      name: "Hash tables",
      origin: "HUMAN",
      reviewStatus: "ACCEPTED",
      createdBy: userId,
    });
  });

  it("approves a pending suggestion that the instructor names", async () => {
    const suggestion = await prisma.courseTopic.create({
      data: { courseId, name: "Graphs", origin: "AI", reviewStatus: "SUGGESTED" },
    });
    const material = await seedMaterial({ checksum: "c-approve", rawText: "x" });

    await choose(material.id, [{ name: "graphs" }]);

    const after = await prisma.courseTopic.findUniqueOrThrow({ where: { id: suggestion.id } });
    expect(after.reviewStatus).toBe("ACCEPTED");
    expect(await materialTopicNames(material.id)).toEqual(["Graphs"]);
  });

  // #1988 review: naming a suggestion approves it for the course, which turns its
  // links to other files into their topics too. Those must respect the cap.
  it("approving a suggestion by name never gives another file a fourth topic", async () => {
    const edited = await seedMaterial({ checksum: "c-name-edited", rawText: "x" });
    const full = await seedMaterial({ checksum: "c-name-full", rawText: "x" });
    const roomy = await seedMaterial({ checksum: "c-name-roomy", rawText: "x" });
    for (const [position, name] of ["A topic", "B topic", "C topic"].entries()) {
      const topic = await acceptedTopic(name);
      await prisma.courseTopicSource.create({
        data: { topicId: topic.id, materialId: full.id, position },
      });
    }
    const roomyTopic = await acceptedTopic("D topic");
    await prisma.courseTopicSource.create({
      data: { topicId: roomyTopic.id, materialId: roomy.id, position: 0 },
    });
    await prisma.courseTopic.create({
      data: {
        courseId,
        name: "Graphs",
        origin: "AI",
        reviewStatus: "SUGGESTED",
        sources: {
          create: [edited, full, roomy].map((material) => ({ materialId: material.id })),
        },
      },
    });

    expect(await choose(edited.id, [{ name: "graphs" }])).toMatchObject({ status: "200" });

    expect(await materialTopicNames(edited.id)).toEqual(["Graphs"]);
    expect(await materialTopicNames(full.id)).toEqual(["A topic", "B topic", "C topic"]);
    expect(await materialTopicNames(roomy.id)).toEqual(["D topic", "Graphs"]);
  });

  it("refuses more than three topics and changes nothing", async () => {
    const material = await seedMaterial({ checksum: "c-cap", rawText: "x" });

    expect(
      await choose(material.id, [
        { name: "One" },
        { name: "Two" },
        { name: "Three" },
        { name: "Four" },
      ]),
    ).toEqual({ status: "400", error: "TOO_MANY_TOPICS" });
    expect(await liveTopics()).toHaveLength(0);
  });

  it("counts a repeated choice once toward the cap", async () => {
    const a = await acceptedTopic("Arrays");
    const material = await seedMaterial({ checksum: "c-repeat", rawText: "x" });

    const outcome = await choose(material.id, [
      { topicId: a.id },
      { name: "arrays" },
      { name: "Two" },
      { name: "Three" },
    ]);

    expect(outcome).toMatchObject({ status: "200" });
    expect(await materialTopicNames(material.id)).toEqual(["Arrays", "Two", "Three"]);
  });

  it("refuses a new name from a caller who cannot create topics", async () => {
    const material = await seedMaterial({ checksum: "c-forbidden", rawText: "x" });

    expect(await choose(material.id, [{ name: "Hash tables" }], false)).toEqual({
      status: "403",
      error: "TOPIC_CREATE_FORBIDDEN",
    });
  });

  it("refuses a name a deleted topic still holds", async () => {
    await prisma.courseTopic.create({
      data: { courseId, name: "Heaps", deletedAt: new Date() },
    });
    const material = await seedMaterial({ checksum: "c-taken", rawText: "x" });

    expect(await choose(material.id, [{ name: "Heaps" }])).toEqual({
      status: "409",
      error: "TOPIC_NAME_TAKEN",
    });
    expect(await materialTopicNames(material.id)).toEqual([]);
  });

  it("refuses a suggestion or unknown topic chosen by id", async () => {
    const suggestion = await prisma.courseTopic.create({
      data: { courseId, name: "Tries", origin: "AI", reviewStatus: "SUGGESTED" },
    });
    const material = await seedMaterial({ checksum: "c-by-id", rawText: "x" });

    expect(await choose(material.id, [{ topicId: suggestion.id }])).toEqual({
      status: "404",
      error: "TOPIC_NOT_FOUND",
    });
    expect(await choose(material.id, [{ topicId: "missing" }])).toEqual({
      status: "404",
      error: "TOPIC_NOT_FOUND",
    });
  });

  it("replaces the material's topics but keeps a suggestion's record of its source", async () => {
    const old = await acceptedTopic("Old topic");
    const next = await acceptedTopic("New topic");
    const material = await seedMaterial({ checksum: "c-replace", rawText: "x" });
    const suggestion = await prisma.courseTopic.create({
      data: {
        courseId,
        name: "Pending",
        origin: "AI",
        reviewStatus: "SUGGESTED",
        sources: { create: [{ materialId: material.id }] },
      },
    });
    await prisma.courseTopicSource.create({ data: { topicId: old.id, materialId: material.id } });

    await choose(material.id, [{ topicId: next.id }]);

    expect(await materialTopicNames(material.id)).toEqual(["New topic"]);
    expect(
      await prisma.courseTopicSource.count({
        where: { topicId: suggestion.id, materialId: material.id },
      }),
    ).toBe(1);
  });
});

// #1966: Suggest reads the whole course and proposes only what it is missing;
// approving or merging a suggestion files the materials it covered.
describe("on-demand topic suggestions (#1966)", () => {
  /** Run Suggest with a model that proposes `topics` (file numbers are 1-based). */
  async function suggest(topics: Array<{ name: string; files: number[] }>) {
    const model = vi.fn(async (_args: { systemPrompt: string; prompt: string }) =>
      JSON.stringify({ topics }),
    );
    const result = await suggestCourseTopics({
      courseId,
      canvasCourseId: null,
      userId,
      jobId: "job-suggest",
      runCompletion: model,
    });
    return { result, prompt: model.mock.calls[0]?.[0].prompt ?? "" };
  }

  /** Seed in order; Suggest numbers files newest first. */
  async function seedInOrder(count: number) {
    const materials = [];
    for (let i = 0; i < count; i += 1) {
      materials.push(
        await prisma.courseMaterial.create({
          data: {
            courseId,
            title: `File ${i + 1}`,
            mimeType: "text/plain",
            fileSize: 1,
            checksum: `s-${i}`,
            rawText: `Chapter ${i + 1} — Topic ${i + 1}`,
            status: "READY",
            uploadedBy: userId,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          },
        }),
      );
    }
    return materials;
  }

  it("creates the missing topics as suggestions linked to the files they cover", async () => {
    const [first, second] = await seedInOrder(2);

    // Newest first: 1 is File 2, 2 is File 1.
    const { result } = await suggest([{ name: "Recursion", files: [1, 2] }]);

    expect(result).toEqual({ created: 1, createdNames: ["Recursion"], duplicatesSkipped: 0 });
    const [topic] = await liveTopics();
    expect(topic).toMatchObject({ name: "Recursion", origin: "AI", reviewStatus: "SUGGESTED" });
    const sources = await prisma.courseTopicSource.findMany({ where: { topicId: topic.id } });
    const linked = sources.map((s) => s.materialId);
    expect(linked).toHaveLength(2);
    expect(linked).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("shows the model every kind of topic, and drops anything the course already has", async () => {
    await seedInOrder(1);
    await acceptedTopic("Loops");
    await prisma.courseTopic.create({
      data: { courseId, name: "Arrays", origin: "AI", reviewStatus: "SUGGESTED" },
    });
    await prisma.courseTopic.create({
      data: { courseId, name: "Pointers", origin: "AI", deletedAt: new Date() },
    });

    const { result, prompt } = await suggest([
      { name: "loop", files: [1] },
      { name: "Array", files: [1] },
      { name: "pointers", files: [1] },
      { name: FALLBACK_TOPIC_NAME, files: [1] },
      { name: "Graphs", files: [1] },
      { name: "graph", files: [1] },
    ]);

    expect(prompt).toContain("- Loops");
    expect(prompt).toContain("- Arrays");
    expect(prompt).toContain("## Dismissed topics (never propose these again)\n\n- Pointers");
    expect(result).toEqual({ created: 1, createdNames: ["Graphs"], duplicatesSkipped: 5 });
  });

  it("does nothing for a course with no processed materials", async () => {
    const { result, prompt } = await suggest([{ name: "Graphs", files: [1] }]);
    expect(result.created).toBe(0);
    expect(prompt).toBe("");
  });

  it("approving files the suggestion under its materials, within the cap", async () => {
    const [roomy, full] = await seedInOrder(2);
    for (const name of ["A topic", "B topic", "C topic"]) {
      const topic = await acceptedTopic(name);
      await prisma.courseTopicSource.create({ data: { topicId: topic.id, materialId: full.id } });
    }
    await suggest([{ name: "Recursion", files: [1, 2] }]);
    const suggestion = await prisma.courseTopic.findFirstOrThrow({ where: { name: "Recursion" } });

    await approveGeneratedTopic(courseId, suggestion.id);

    expect(await materialTopicNames(roomy.id)).toEqual(["Recursion"]);
    expect(await materialTopicNames(full.id)).toEqual(["A topic", "B topic", "C topic"]);
  });

  it("merging moves the suggestion's files onto the target topic", async () => {
    const [material] = await seedInOrder(1);
    const target = await acceptedTopic("Recursion");
    await suggest([{ name: "Recursive functions", files: [1] }]);
    const suggestion = await prisma.courseTopic.findFirstOrThrow({
      where: { name: "Recursive functions" },
    });

    await mergeGeneratedTopic(courseId, suggestion.id, target.id, userId);

    expect(await materialTopicNames(material.id)).toEqual(["Recursion"]);
  });

  it("counts processed materials with no accepted topic in the status", async () => {
    const [filed] = await seedInOrder(3);
    const topic = await acceptedTopic("Loops");
    await prisma.courseTopicSource.create({ data: { topicId: topic.id, materialId: filed.id } });

    expect((await latestTopicAnalysisForCourse(courseId)).unfiledMaterials).toBe(2);
  });
});
