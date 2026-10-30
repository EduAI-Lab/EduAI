// @vitest-environment node
//
// #2061 — the Settings tab's "What students see", against the real test
// database: one place to show or hide every file, a topic, the files with no
// topic, or one file. Each change alters both what an enrolled student lists on
// the course page and what course chat retrieves for them. A hidden topic hides
// its files, including files filed under it later, and wins over a shown topic.
// A scheduled file keeps its date, a deleted file is never touched, and the
// whole-course change holds on a course far larger than one page of files.
//
// Only the embedding provider is mocked, with one fixed vector for every chunk
// and query, so the chat assertions test the visibility SQL, not ranking.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));

const FIXED_EMBEDDING = vi.hoisted(() => Array.from({ length: 1024 }, (_, i) => (i + 1) * 0.0001));
vi.mock("ai", () => ({
  embed: vi.fn().mockResolvedValue({ embedding: FIXED_EMBEDDING }),
  embedMany: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({ embedding: vi.fn(() => ({})) })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import prisma from "~/lib/prisma.server";
import {
  action as saveVisibility,
  loader as readVisibility,
} from "~/routes/api/courses.id.student-visibility";
import { loader as readFiles } from "~/routes/api/courses.materials.$";
import { findRelevantContent } from "~/lib/ai/embedding";
import { LEARNER_TOPIC_WHERE } from "~/lib/topics/learner-view.server";
import type { RouteRequestBody } from "../helpers/route-fixtures";
import { cleanupRbac, enroll, mockSession, seedCourse, seedUser } from "../helpers/rbac";
import { seedMaterial, seedMaterialChunkWithEmbedding } from "../helpers/materials";

const ORIGINAL_ENV = {
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  EMBEDDING_DIMENSION: process.env.EMBEDDING_DIMENSION,
  RAG_HYBRID_BM25: process.env.RAG_HYBRID_BM25,
};

type SeededUser = Awaited<ReturnType<typeof seedUser>>;
let courseId: string;
let bigCourseId: string;
let instructor: SeededUser;
let student: SeededUser;
let ta: SeededUser;
const topics = { sorting: "", examPrep: "", suggestion: "" };
const files = { lecture: "", slides: "", answerKey: "", scheduled: "", canvas: "", deleted: "" };

function visibilityArgs(method: string, body?: RouteRequestBody, course = courseId) {
  return {
    request: new Request(`http://localhost/api/courses/${course}/student-visibility`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params: { id: course },
    context: {},
  } as never;
}

async function save(body: RouteRequestBody, course = courseId) {
  mockSession(instructor);
  return saveVisibility(visibilityArgs("PATCH", body, course));
}

function everything(visibleToStudents: boolean) {
  return { fileGroup: { scope: "all", visibleToStudents } };
}

/** The titles an enrolled student lists on the course page. */
async function studentSees() {
  mockSession(student);
  const res = await readFiles({
    request: new Request(`http://localhost/api/courses/${courseId}/materials`),
    params: { courseId },
    context: {},
  } as never);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { materials: { title: string }[] };
  return body.materials.map((m) => m.title).sort();
}

/** The chunks course chat retrieves for a student, on both retrieval paths. */
async function chatUses() {
  const seen: string[][] = [];
  for (const hybrid of ["1", ""]) {
    process.env.RAG_HYBRID_BM25 = hybrid;
    const hits = await findRelevantContent("course content", courseId, 20, undefined, true);
    seen.push(hits.map((h) => h.content).sort());
  }
  expect(seen[0]).toEqual(seen[1]);
  return seen[0];
}

/** The topic names a student is shown. */
async function topicsShown() {
  const rows = await prisma.courseTopic.findMany({
    where: { courseId, deletedAt: null, ...LEARNER_TOPIC_WHERE },
    select: { name: true },
  });
  return rows.map((t) => t.name).sort();
}

async function addFile(
  key: string,
  topicIds: string[],
  extra: Partial<Parameters<typeof seedMaterial>[0]> = {},
) {
  const material = await seedMaterial({ courseId, title: key, ...extra });
  await seedMaterialChunkWithEmbedding(material.id, FIXED_EMBEDDING, `${key} chunk`);
  for (const topicId of topicIds) {
    await prisma.courseTopicSource.create({ data: { topicId, materialId: material.id } });
  }
  return material.id;
}

beforeAll(async () => {
  process.env.EMBEDDING_PROVIDER = "cloud";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.EMBEDDING_DIMENSION = "1024";
  delete process.env.OLLAMA_BASE_URL;

  courseId = (await seedCourse()).id;
  bigCourseId = (await seedCourse()).id;
  await prisma.course.update({ where: { id: courseId }, data: { studentFilesVisible: true } });
  [instructor, student, ta] = await Promise.all([
    seedUser({ role: "INSTRUCTOR" }),
    seedUser(),
    seedUser(),
  ]);
  await enroll(courseId, instructor.id, "INSTRUCTOR");
  await enroll(bigCourseId, instructor.id, "INSTRUCTOR");
  await enroll(courseId, student.id, "STUDENT");
  await enroll(courseId, ta.id, "TA");

  const topic = async (name: string, reviewStatus: "ACCEPTED" | "SUGGESTED" = "ACCEPTED") =>
    (await prisma.courseTopic.create({ data: { courseId, name, reviewStatus } })).id;
  topics.sorting = await topic("Sorting");
  topics.examPrep = await topic("Exam prep");
  topics.suggestion = await topic("Suggested", "SUGGESTED");

  files.lecture = await addFile("lecture", [topics.sorting]);
  files.slides = await addFile("slides", [topics.sorting, topics.examPrep]);
  files.answerKey = await addFile("answerKey", [topics.examPrep], { visibleToStudents: false });
  files.scheduled = await addFile("scheduled", [topics.suggestion], {
    availableAt: new Date("2099-01-01"),
  });
  files.canvas = await addFile("canvas", [], { unpublishedAt: new Date() });
  files.deleted = await addFile("deleted", [topics.sorting], {
    visibleToStudents: false,
    deletedAt: new Date(),
  });

  // A course far past one page of files, for the whole-course change.
  await prisma.courseMaterial.createMany({
    data: Array.from({ length: 1500 }, (_, i) => ({
      courseId: bigCourseId,
      title: `Big ${i}`,
      mimeType: "text/plain",
      fileSize: 1,
      checksum: `big-${bigCourseId}-${i}`,
      status: "READY" as const,
    })),
  });
});

afterAll(async () => {
  await cleanupRbac({
    courseIds: [courseId, bigCourseId],
    userIds: [instructor.id, student.id, ta.id],
  });
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await prisma.$disconnect();
});

describe("what students see: files, by topic and one at a time (#2061)", () => {
  it("reads every live file with its approved topics and whether Canvas hides it", async () => {
    mockSession(instructor);
    const res = await readVisibility(visibilityArgs("GET"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      studentFilesVisible: boolean;
      topics: { name: string }[];
      files: {
        title: string;
        visibleToStudents: boolean;
        topicIds: string[];
        hiddenByCanvas: boolean;
      }[];
    };

    expect(body.studentFilesVisible).toBe(true);
    expect(body.topics.map((t) => t.name)).toEqual(["Exam prep", "Sorting"]);
    expect(
      body.files.map((f) => [
        f.title,
        f.visibleToStudents,
        [...f.topicIds].sort(),
        f.hiddenByCanvas,
      ]),
    ).toEqual([
      ["answerKey", false, [topics.examPrep], false],
      ["canvas", true, [], true],
      ["lecture", true, [topics.sorting], false],
      // A suggestion is not a topic a student can be shown, so this file has none.
      ["scheduled", true, [], false],
      ["slides", true, [topics.examPrep, topics.sorting].sort(), false],
    ]);
    expect(await studentSees()).toEqual(["lecture", "slides"]);
  });

  it("refuses a TA and a student, to read or to change", async () => {
    for (const who of [ta, student]) {
      mockSession(who);
      expect((await readVisibility(visibilityArgs("GET"))).status).toBe(403);
      expect((await saveVisibility(visibilityArgs("PATCH", everything(false)))).status).toBe(403);
    }
    expect(await studentSees()).toEqual(["lecture", "slides"]);
  });

  it("hides a topic's files with it, even under another topic that is shown", async () => {
    expect(
      (await save({ topics: [{ id: topics.examPrep, visibleToStudents: false }] })).status,
    ).toBe(200);

    // slides is under Sorting too, but the hidden topic wins.
    expect(await studentSees()).toEqual(["lecture"]);
    expect(await chatUses()).toEqual(["lecture chunk"]);
    expect(await topicsShown()).toEqual(["Sorting"]);
    // The files' own switches are untouched: showing the topic brings them back.
    const slides = await prisma.courseMaterial.findUniqueOrThrow({ where: { id: files.slides } });
    expect(slides.visibleToStudents).toBe(true);
  });

  it("hides a file filed under a hidden topic after the topic was hidden", async () => {
    const late = await addFile("late solutions", [topics.examPrep]);

    expect(await studentSees()).toEqual(["lecture"]);
    expect(await chatUses()).toEqual(["lecture chunk"]);
    await prisma.courseMaterial.delete({ where: { id: late } });
  });

  it("shows a topic again without revealing a file hidden on its own", async () => {
    await save({ topics: [{ id: topics.examPrep, visibleToStudents: true }] });

    expect(await studentSees()).toEqual(["lecture", "slides"]);
    expect(await chatUses()).toEqual(["lecture chunk", "slides chunk"]);
  });

  it("hides every file and topic, then shows them all again", async () => {
    expect((await save(everything(false))).status).toBe(200);
    expect(await studentSees()).toEqual([]);
    expect(await chatUses()).toEqual([]);
    expect(await topicsShown()).toEqual([]);

    expect((await save(everything(true))).status).toBe(200);
    // The scheduled file waits for its date; Canvas still hides its file.
    expect(await studentSees()).toEqual(["answerKey", "lecture", "slides"]);
    expect(await chatUses()).toEqual(["answerKey chunk", "lecture chunk", "slides chunk"]);
    expect(await topicsShown()).toEqual(["Exam prep", "Sorting"]);
    const scheduled = await prisma.courseMaterial.findUniqueOrThrow({
      where: { id: files.scheduled },
    });
    expect(scheduled.availableAt).toEqual(new Date("2099-01-01"));
  });

  it("changes one topic's files, or the files with no approved topic, as a group", async () => {
    await save({
      fileGroup: { scope: "topic", topicId: topics.sorting, visibleToStudents: false },
    });
    expect(await studentSees()).toEqual(["answerKey"]);

    await save({ fileGroup: { scope: "unfiled", visibleToStudents: false } });
    const unfiled = await prisma.courseMaterial.findMany({
      where: { id: { in: [files.scheduled, files.canvas] } },
      select: { visibleToStudents: true },
    });
    expect(unfiled.map((f) => f.visibleToStudents)).toEqual([false, false]);

    await save(everything(true));
  });

  it("changes one file on its own, and refuses a save naming a deleted file", async () => {
    expect(
      (await save({ materials: [{ id: files.slides, visibleToStudents: false }] })).status,
    ).toBe(200);
    expect(await studentSees()).toEqual(["answerKey", "lecture"]);

    const res = await save({ materials: [{ id: files.deleted, visibleToStudents: true }] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "MATERIAL_NOT_ELIGIBLE" });
  });

  it("never touches a deleted file", async () => {
    const deleted = await prisma.courseMaterial.findUniqueOrThrow({
      where: { id: files.deleted },
    });
    expect(deleted.visibleToStudents).toBe(false);
  });

  it("hides and reads back every file of a course far past one page", async () => {
    expect((await save(everything(false), bigCourseId)).status).toBe(200);
    expect(
      await prisma.courseMaterial.count({
        where: { courseId: bigCourseId, visibleToStudents: true },
      }),
    ).toBe(0);

    mockSession(instructor);
    const res = await readVisibility(visibilityArgs("GET", undefined, bigCourseId));
    const body = (await res.json()) as { files: { visibleToStudents: boolean }[] };
    expect(body.files).toHaveLength(1500);
    expect(body.files.every((f) => !f.visibleToStudents)).toBe(true);
  });
});
