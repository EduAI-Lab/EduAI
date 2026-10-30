// @vitest-environment node
//
// #2002 — what students see in a course, against the real test database: the
// course's file sharing and the topics shown to students, each on and off.
// Defaults leave a course as it was (#1962: no files for students; every
// approved topic shown). Only admins, the course's unit admins and its
// instructors may change either setting, and a save writes only what it sends.

import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));

import prisma from "~/lib/prisma.server";
import { action as saveVisibility } from "~/routes/api/courses.id.student-visibility";
import { loader as readFiles, action as changeFile } from "~/routes/api/courses.materials.$";
import { getCourseTopicNamesCached, getCourseTopicsWithSources } from "~/lib/courses/server";
import {
  loadLearnerTopicsByMaterial,
  loadVisibleLearnerTopicNames,
} from "~/lib/chat/learner-sources.server";
import { toLearnerTranscript } from "~/lib/chat/revive-message.server";
import type { RouteRequestBody } from "../helpers/route-fixtures";
import { cleanupRbac, enroll, mockSession, seedCourse, seedUser } from "../helpers/rbac";

const UNIT = "COSC";

let courseId: string;
let otherCourseId: string;
async function seedUsers() {
  const [instructor, student, ta, otherInstructor, admin, unitAdmin, otherUnitAdmin] =
    await Promise.all([
      seedUser({ role: "INSTRUCTOR" }),
      seedUser(),
      seedUser(),
      seedUser({ role: "INSTRUCTOR" }),
      seedUser({ role: "ADMIN" }),
      seedUser({ role: "UNIT_ADMIN", authorizedUnits: [UNIT] }),
      seedUser({ role: "UNIT_ADMIN", authorizedUnits: ["MATH"] }),
    ]);
  return { instructor, student, ta, otherInstructor, admin, unitAdmin, otherUnitAdmin };
}

let users: Awaited<ReturnType<typeof seedUsers>>;
let shownFileId: string;
let plainFileId: string;
let hiddenFileId: string;
let shownTopicId: string;
let hiddenTopicId: string;
let foreignTopicId: string;

function saveArgs(body: RouteRequestBody) {
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/student-visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: courseId },
    context: {},
  } as never;
}

/** The materials route's params: the collection, or one material in it. */
type FilesParams = { courseId: string; materialId?: string };

/** The collection (`materialId` omitted) or one material, with an optional query string. */
function filesArgs(method = "GET", materialId?: string, query = "") {
  const path = materialId ? `/${materialId}` : "";
  const params: FilesParams = { courseId };
  if (materialId) params.materialId = materialId;
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/materials${path}${query}`, {
      method,
    }),
    params,
    context: {},
  } as never;
}

async function listedIds(query = "") {
  const res = await readFiles(filesArgs("GET", undefined, query));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { materials: { id: string }[] };
  return body.materials.map((m) => m.id);
}

async function stored() {
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  const hidden = await prisma.courseTopic.findUniqueOrThrow({ where: { id: hiddenTopicId } });
  return { files: course.studentFilesVisible, hiddenTopicShown: hidden.visibleToStudents };
}

beforeAll(async () => {
  users = await seedUsers();
  courseId = (await seedCourse({ department: UNIT })).id;
  otherCourseId = (await seedCourse()).id;
  await enroll(courseId, users.instructor.id, "INSTRUCTOR");
  await enroll(courseId, users.student.id, "STUDENT");
  await enroll(courseId, users.ta.id, "TA");
  await enroll(otherCourseId, users.otherInstructor.id, "INSTRUCTOR");

  const file = (title: string, extra: Partial<Prisma.CourseMaterialUncheckedCreateInput> = {}) =>
    prisma.courseMaterial.create({
      data: {
        courseId,
        title,
        mimeType: "text/plain",
        fileSize: 12,
        checksum: title,
        status: "READY",
        rawText: "Course content",
        ...extra,
      },
    });
  shownFileId = (await file("Shown")).id;
  plainFileId = (await file("Plain")).id;
  hiddenFileId = (await file("Hidden", { visibleToStudents: false })).id;
  await file("Scheduled", { availableAt: new Date("2099-01-01") });
  await file("Canvas unpublished", { unpublishedAt: new Date() });
  await file("Canvas excluded", { externalId: "excluded-canvas-file" });
  await prisma.canvasMaterialExclusion.create({
    data: { courseId, canvasFileId: "excluded-canvas-file" },
  });

  shownTopicId = (await prisma.courseTopic.create({ data: { courseId, name: "Shown topic" } })).id;
  hiddenTopicId = (await prisma.courseTopic.create({ data: { courseId, name: "Hidden topic" } }))
    .id;
  foreignTopicId = (
    await prisma.courseTopic.create({ data: { courseId: otherCourseId, name: "Foreign" } })
  ).id;
  await prisma.courseTopicSource.createMany({
    data: [
      { topicId: shownTopicId, materialId: shownFileId },
      { topicId: hiddenTopicId, materialId: shownFileId },
    ],
  });
});

afterAll(async () => {
  await cleanupRbac({
    courseIds: [courseId, otherCourseId],
    userIds: Object.values(users ?? {}).map((u) => u.id),
  });
});

describe("course student visibility (#2002)", () => {
  it("leaves a course as it was by default: no files for students, every topic shown", async () => {
    expect(await stored()).toEqual({ files: false, hiddenTopicShown: true });

    mockSession(users.student);
    expect((await readFiles(filesArgs())).status).toBe(403);
    expect(
      (await getCourseTopicsWithSources(courseId, false, "learner")).map((t) => t.name),
    ).toEqual(["Hidden topic", "Shown topic"]);
  });

  it.each(["student", "ta", "otherInstructor", "otherUnitAdmin"] as const)(
    "refuses a change from %s",
    async (who) => {
      mockSession(users[who]);

      const res = await saveVisibility(saveArgs({ studentFilesVisible: true }));

      expect(res.status).toBe(403);
      expect(await stored()).toEqual({ files: false, hiddenTopicShown: true });
    },
  );

  it("rejects a topic from another course before writing anything", async () => {
    mockSession(users.instructor);

    const res = await saveVisibility(
      saveArgs({
        studentFilesVisible: true,
        topics: [{ id: foreignTopicId, visibleToStudents: false }],
      }),
    );

    expect(res.status).toBe(422);
    expect(await stored()).toEqual({ files: false, hiddenTopicShown: true });
  });

  it("keeps both of two managers' saves, each sending only its own change", async () => {
    // Read before either save, so a stale cached list would be the risk.
    expect((await getCourseTopicNamesCached(courseId, true)).accepted).toContain("Hidden topic");

    mockSession(users.instructor);
    expect((await saveVisibility(saveArgs({ studentFilesVisible: true }))).status).toBe(200);
    mockSession(users.unitAdmin);
    const hide = { topics: [{ id: hiddenTopicId, visibleToStudents: false }] };
    expect((await saveVisibility(saveArgs(hide))).status).toBe(200);

    expect(await stored()).toEqual({ files: true, hiddenTopicShown: false });
  });

  it("shares only the files a student may see, read-only", async () => {
    mockSession(users.student);

    // #2061: Shown is filed under the topic hidden above, and a hidden topic
    // hides its files, so only the unfiled Plain file is shared.
    expect(await listedIds()).toEqual([plainFileId]);
    expect(await listedIds(`?ids=${plainFileId},${shownFileId},${hiddenFileId}`)).toEqual([
      plainFileId,
    ]);
    expect((await readFiles(filesArgs("GET", plainFileId))).status).toBe(200);
    expect((await readFiles(filesArgs("GET", shownFileId))).status).toBe(404);
    expect((await readFiles(filesArgs("GET", hiddenFileId))).status).toBe(404);
    expect((await changeFile(filesArgs("DELETE", plainFileId))).status).toBe(403);
    expect(
      await prisma.courseMaterial.findUniqueOrThrow({ where: { id: plainFileId } }),
    ).toMatchObject({ deletedAt: null });
  });

  it("drops a hidden topic from every place a student sees topics, but not from staff's", async () => {
    expect(
      (await getCourseTopicsWithSources(courseId, false, "learner")).map((t) => t.name),
    ).toEqual(["Shown topic"]);
    expect(
      (await getCourseTopicsWithSources(courseId, false, "staff")).map((t) => t.name),
    ).toContain("Hidden topic");

    // Course chat: the prompt's list, the "Topics:" line and a stored turn.
    const names = await getCourseTopicNamesCached(courseId, true);
    expect(names.accepted).toEqual(["Shown topic"]);
    expect(names.suggested).toContain("Hidden topic");
    const labels = await loadLearnerTopicsByMaterial(courseId, [
      { materialId: shownFileId, materialTitle: "Shown", content: "Text", similarity: 1 },
    ]);
    expect(labels.get(shownFileId)).toEqual(["Shown topic"]);
    const [turn] = toLearnerTranscript(
      [
        {
          id: "m1",
          role: "assistant",
          content: "Answer",
          metadata: { ragTopics: ["Shown topic", "Hidden topic"] },
        },
      ],
      await loadVisibleLearnerTopicNames(courseId),
    );
    expect(turn.metadata?.ragTopics).toEqual(["Shown topic"]);
  });

  it("closes the files and shows the topic again when an admin turns both back", async () => {
    mockSession(users.admin);
    const restore = {
      studentFilesVisible: false,
      topics: [{ id: hiddenTopicId, visibleToStudents: true }],
    };
    expect((await saveVisibility(saveArgs(restore))).status).toBe(200);

    mockSession(users.student);
    expect((await readFiles(filesArgs("GET", shownFileId))).status).toBe(403);
    expect((await getCourseTopicNamesCached(courseId, true)).accepted).toEqual([
      "Hidden topic",
      "Shown topic",
    ]);
  });
});
