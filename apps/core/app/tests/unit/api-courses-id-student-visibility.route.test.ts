// @vitest-environment node
// #2002 — PATCH /api/courses/:id/student-visibility: the Settings tab's audience
// (admin, unit admin, instructor) may change it; TAs, students and outsiders may
// not. Only the fields sent are written, topics are checked before any write,
// and course chat's topic-name cache is dropped after the write commits.
// #2061 — files are shown or hidden here too, and GET reads the whole state.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  courseUpdate: vi.fn(),
  topicCount: vi.fn(),
  topicUpdateMany: vi.fn(),
  materialRead: vi.fn(),
  materialUpdateMany: vi.fn(),
  topicList: vi.fn(),
  materialList: vi.fn(),
  linkList: vi.fn(),
  exclusionList: vi.fn(),
  invalidate: vi.fn(),
  audit: vi.fn(),
  order: [] as string[],
}));

vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: mocks.session }));
vi.mock("~/lib/auth/course-access.server", () => ({ resolveCourseAccessGate: mocks.access }));
vi.mock("~/lib/courses/server", () => ({ invalidateCourseTopicNamesCache: mocks.invalidate }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: (work: Promise<void>) => void work,
  logAuditAction: mocks.audit,
}));
vi.mock("~/lib/prisma.server", () => {
  const tx = {
    course: { update: mocks.courseUpdate },
    courseTopic: { count: mocks.topicCount, updateMany: mocks.topicUpdateMany },
    courseMaterial: { findMany: mocks.materialRead, updateMany: mocks.materialUpdateMany },
  };
  return {
    default: {
      courseTopic: { findMany: mocks.topicList },
      courseMaterial: { findMany: mocks.materialList },
      courseTopicSource: { findMany: mocks.linkList },
      canvasMaterialExclusion: { findMany: mocks.exclusionList },
      $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => {
        const result = await run(tx);
        mocks.order.push("commit");
        return result;
      },
    },
  };
});

import { action, loader } from "~/routes/api/courses.id.student-visibility";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const ROUTE_URL = "http://localhost/api/courses/c1/student-visibility";

function call(body: RouteRequestBody) {
  return action({
    request: new Request(ROUTE_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "c1" },
    context: {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.session.mockResolvedValue({ user: { id: "u1" } });
  mocks.access.mockResolvedValue({
    course: { id: "c1" },
    access: { level: "instructor", rank: 2 },
  });
  mocks.topicCount.mockResolvedValue(1);
  mocks.courseUpdate.mockResolvedValue({});
  mocks.topicUpdateMany.mockResolvedValue({ count: 1 });
  mocks.materialRead.mockResolvedValue([]);
  mocks.materialUpdateMany.mockResolvedValue({ count: 0 });
  mocks.invalidate.mockImplementation(() => mocks.order.push("invalidate"));
});

describe("PATCH /api/courses/:id/student-visibility (#2002)", () => {
  it.each([
    ["admin", 4],
    ["unit", 3],
    ["instructor", 2],
  ])("lets a course's %s change both settings", async (level, rank) => {
    mocks.access.mockResolvedValue({ course: { id: "c1" }, access: { level, rank } });

    const res = await call({
      studentFilesVisible: true,
      topics: [{ id: "t1", visibleToStudents: false }],
    });

    expect(res.status).toBe(200);
    expect(mocks.courseUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { studentFilesVisible: true },
    });
    expect(mocks.topicUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ courseId: "c1", deletedAt: null, id: { in: ["t1"] } }),
      data: { visibleToStudents: false },
    });
  });

  it.each([
    ["no relationship to the course", null],
    ["a TA", { level: "ta", rank: 1 }],
    ["a student", { level: "student", rank: 0 }],
  ])("refuses %s", async (_label, access) => {
    mocks.access.mockResolvedValue({ course: { id: "c1" }, access });

    expect((await call({ studentFilesVisible: true })).status).toBe(403);
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("writes only the fields sent", async () => {
    expect((await call({ topics: [{ id: "t1", visibleToStudents: true }] })).status).toBe(200);
    expect(mocks.courseUpdate).not.toHaveBeenCalled();

    vi.clearAllMocks();
    expect((await call({ studentFilesVisible: false })).status).toBe(200);
    expect(mocks.topicCount).not.toHaveBeenCalled();
    expect(mocks.topicUpdateMany).not.toHaveBeenCalled();
  });

  it("records who changed what students see", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });

    await call({ studentFilesVisible: true });

    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "u1",
        actionCode: "COURSE_STUDENT_VISIBILITY_UPDATED",
        category: "COURSE",
        entityType: "Course",
        entityId: "c1",
        details: { studentFilesVisible: true, topics: [] },
      }),
    );
  });

  it("drops the topic-name cache only after the write commits", async () => {
    await call({ topics: [{ id: "t1", visibleToStudents: false }] });

    expect(mocks.order).toEqual(["commit", "invalidate"]);
    expect(mocks.invalidate).toHaveBeenCalledWith("c1");
  });

  it("rejects the whole save when a topic is not an approved topic of this course", async () => {
    mocks.topicCount.mockResolvedValue(0);

    const res = await call({
      studentFilesVisible: true,
      topics: [{ id: "other-course-topic", visibleToStudents: true }],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_ELIGIBLE" });
    expect(mocks.topicCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        courseId: "c1",
        reviewStatus: "ACCEPTED",
        name: { not: "Uncategorized" },
      }),
    });
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
    expect(mocks.topicUpdateMany).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty body", {}],
    ["a non-boolean flag", { studentFilesVisible: "true" }],
    [
      "a topic listed twice",
      {
        topics: [
          { id: "t1", visibleToStudents: false },
          { id: "t1", visibleToStudents: true },
        ],
      },
    ],
    ["an unknown field", { studentFilesVisible: true, unexpected: true }],
  ])("rejects %s", async (_label, body) => {
    expect((await call(body)).status).toBe(422);
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
  });

  it("answers 401 without a session, 404 for an unknown course and 405 for other methods", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await call({ studentFilesVisible: true })).status).toBe(401);

    mocks.access.mockResolvedValueOnce({ course: null, access: null });
    expect((await call({ studentFilesVisible: true })).status).toBe(404);

    const post = new Request(ROUTE_URL, { method: "POST" });
    expect(
      (await action({ request: post, params: { id: "c1" }, context: {} } as never)).status,
    ).toBe(405);
  });
});

describe("files on /api/courses/:id/student-visibility (#2061)", () => {
  function read() {
    return loader({
      request: new Request(ROUTE_URL),
      params: { id: "c1" },
      context: {},
    } as never);
  }

  const LIVE = { courseId: "c1", deletedAt: null };

  it("shows or hides single files, and audits each one that changed", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    mocks.materialRead.mockResolvedValue([
      { id: "m1", title: "Answer key", visibleToStudents: false },
      { id: "m2", title: "Slides", visibleToStudents: false },
    ]);

    const res = await call({
      materials: [
        { id: "m1", visibleToStudents: true },
        { id: "m2", visibleToStudents: false },
      ],
    });

    expect(res.status).toBe(200);
    expect(mocks.materialUpdateMany).toHaveBeenCalledWith({
      where: { ...LIVE, id: { in: ["m1"] } },
      data: { visibleToStudents: true },
    });
    // m2 was already hidden: written, but not audited as a change. No course entry either.
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "MATERIAL_VISIBILITY_CHANGED",
        entityType: "CourseMaterial",
        entityId: "m1",
        entityLabel: "Answer key",
        details: { courseId: "c1", previousVisibleToStudents: false, newVisibleToStudents: true },
      }),
    );
  });

  it("rejects the whole save when a file is not a live file of this course", async () => {
    mocks.materialRead.mockResolvedValue([{ id: "m1", title: "A", visibleToStudents: true }]);

    const res = await call({
      studentFilesVisible: true,
      materials: [
        { id: "m1", visibleToStudents: false },
        { id: "deleted-or-foreign", visibleToStudents: false },
      ],
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "MATERIAL_NOT_ELIGIBLE" });
    expect(mocks.materialUpdateMany).not.toHaveBeenCalled();
    expect(mocks.courseUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["every file and topic", { scope: "all" }, {}],
    [
      "one topic's files",
      { scope: "topic", topicId: "t1" },
      { derivedTopics: { some: { topicId: "t1" } } },
    ],
    [
      "the files with no approved topic",
      { scope: "unfiled" },
      {
        derivedTopics: {
          none: {
            topic: expect.objectContaining({ courseId: "c1", reviewStatus: "ACCEPTED" }),
          },
        },
      },
    ],
  ])(
    "resolves %s on the server, so no list of ids can go stale or run out",
    async (_label, group, scopeWhere) => {
      mocks.materialRead.mockResolvedValue([{ id: "m9" }]);
      mocks.materialUpdateMany.mockResolvedValue({ count: 7 });
      mocks.topicUpdateMany.mockResolvedValue({ count: 2 });

      const res = await call({ fileGroup: { ...group, visibleToStudents: false } });

      expect(res.status).toBe(200);
      const where = { ...LIVE, ...scopeWhere, visibleToStudents: true };
      expect(mocks.materialUpdateMany).toHaveBeenCalledWith({
        where,
        data: { visibleToStudents: false },
      });
      // The audit sample is read with the same filter, before the write.
      expect(mocks.materialRead).toHaveBeenCalledWith({ where, select: { id: true }, take: 100 });
      if (group.scope === "all") {
        expect(mocks.topicUpdateMany).toHaveBeenCalledWith({
          where: expect.objectContaining({ courseId: "c1", visibleToStudents: true }),
          data: { visibleToStudents: false },
        });
      } else {
        expect(mocks.topicUpdateMany).not.toHaveBeenCalled();
      }
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionCode: "COURSE_STUDENT_VISIBILITY_UPDATED",
          details: expect.objectContaining({
            fileGroup: { ...group, visibleToStudents: false },
            filesChanged: 7,
            topicsChanged: group.scope === "all" ? 2 : 0,
            changedMaterialIds: ["m9"],
          }),
        }),
      );
    },
  );

  it("rejects a topic group for a topic that is not an approved topic of this course", async () => {
    mocks.topicCount.mockResolvedValue(0);

    const res = await call({
      fileGroup: { scope: "topic", topicId: "suggestion", visibleToStudents: true },
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_ELIGIBLE" });
    expect(mocks.materialUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a file listed twice",
      {
        materials: [
          { id: "m1", visibleToStudents: false },
          { id: "m1", visibleToStudents: true },
        ],
      },
    ],
    ["an unknown group", { fileGroup: { scope: "some", visibleToStudents: true } }],
    ["a topic group with no topic", { fileGroup: { scope: "topic", visibleToStudents: true } }],
    [
      "more single files than one save takes",
      {
        materials: Array.from({ length: 101 }, (_, i) => ({
          id: `m${i}`,
          visibleToStudents: true,
        })),
      },
    ],
  ])("rejects %s", async (_label, body) => {
    expect((await call(body)).status).toBe(422);
    expect(mocks.materialUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses a TA", async () => {
    mocks.access.mockResolvedValue({ course: { id: "c1" }, access: { level: "ta", rank: 1 } });
    expect((await call({ fileGroup: { scope: "all", visibleToStudents: false } })).status).toBe(
      403,
    );
    expect(mocks.materialUpdateMany).not.toHaveBeenCalled();
  });

  it("reads the file setting, the approved topics, each live file's topics and what Canvas hides", async () => {
    mocks.access.mockResolvedValue({
      course: { id: "c1", studentFilesVisible: false },
      access: { level: "instructor", rank: 2 },
    });
    mocks.topicList.mockResolvedValue([{ id: "t1", name: "Sorting", visibleToStudents: true }]);
    mocks.materialList.mockResolvedValue([
      {
        id: "m1",
        title: "Lecture",
        visibleToStudents: false,
        availableAt: null,
        unpublishedAt: null,
        externalId: null,
      },
      {
        id: "m2",
        title: "Unpublished",
        visibleToStudents: true,
        availableAt: null,
        unpublishedAt: new Date(),
        externalId: "c-2",
      },
      {
        id: "m3",
        title: "Excluded",
        visibleToStudents: true,
        availableAt: null,
        unpublishedAt: null,
        externalId: "c-3",
      },
    ]);
    mocks.linkList.mockResolvedValue([{ topicId: "t1", materialId: "m1" }]);
    mocks.exclusionList.mockResolvedValue([{ canvasFileId: "c-3" }]);

    const res = await read();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      studentFilesVisible: false,
      topics: [{ id: "t1", name: "Sorting", visibleToStudents: true }],
      files: [
        {
          id: "m1",
          title: "Lecture",
          visibleToStudents: false,
          availableAt: null,
          topicIds: ["t1"],
          hiddenByCanvas: false,
        },
        {
          id: "m2",
          title: "Unpublished",
          visibleToStudents: true,
          availableAt: null,
          topicIds: [],
          hiddenByCanvas: true,
        },
        {
          id: "m3",
          title: "Excluded",
          visibleToStudents: true,
          availableAt: null,
          topicIds: [],
          hiddenByCanvas: true,
        },
      ],
    });
    expect(mocks.materialList.mock.calls[0][0].where).toEqual(LIVE);
    // Links are read by course, never one parameter per file.
    expect(mocks.linkList).toHaveBeenCalledWith({
      where: {
        topic: expect.objectContaining({
          courseId: "c1",
          reviewStatus: "ACCEPTED",
          name: { not: "Uncategorized" },
        }),
        material: LIVE,
      },
      select: { topicId: true, materialId: true },
    });
  });

  it.each([
    ["a TA", { level: "ta", rank: 1 }],
    ["a student", { level: "student", rank: 0 }],
    ["no relationship to the course", null],
  ])("refuses a read from %s", async (_label, access) => {
    mocks.access.mockResolvedValue({ course: { id: "c1" }, access });
    expect((await read()).status).toBe(403);
    expect(mocks.materialList).not.toHaveBeenCalled();
  });

  it("answers a read with 401 without a session", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await read()).status).toBe(401);
  });
});
