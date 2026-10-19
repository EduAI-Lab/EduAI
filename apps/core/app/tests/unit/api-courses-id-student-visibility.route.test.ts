// @vitest-environment node
// #2002 — PATCH /api/courses/:id/student-visibility: the Settings tab's audience
// (admin, unit admin, instructor) may change it; TAs, students and outsiders may
// not. Only the fields sent are written, topics are checked before any write,
// and course chat's topic-name cache is dropped after the write commits.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  access: vi.fn(),
  courseUpdate: vi.fn(),
  topicCount: vi.fn(),
  topicUpdateMany: vi.fn(),
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
  };
  return {
    default: {
      $transaction: async (run: (client: typeof tx) => Promise<boolean>) => {
        const result = await run(tx);
        mocks.order.push("commit");
        return result;
      },
    },
  };
});

import { action } from "~/routes/api/courses.id.student-visibility";
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
