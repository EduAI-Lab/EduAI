import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseTopic: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourseTopics: vi.fn(),
  getCourseTopic: vi.fn(),
  createCourseTopic: vi.fn(),
  updateCourseTopic: vi.fn(),
  deleteCourseTopic: vi.fn(),
}));

// getPolicy resolves to each flag's real code default unless a test overrides it.
vi.mock("~/lib/policy.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/policy.server")>();
  return {
    ...actual,
    getPolicy: vi.fn(async (key: keyof typeof actual.POLICY_FLAGS) => actual.POLICY_FLAGS[key].default),
    logPolicyDenial: vi.fn(),
  };
});

import { loader, action } from "~/routes/api/courses.topics.$";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import {
  getCourseTopics,
  getCourseTopic,
  createCourseTopic,
  updateCourseTopic,
  deleteCourseTopic,
} from "~/lib/courses/server";
import { getPolicy, POLICY_FLAGS } from "~/lib/policy.server";

const COURSE_ID = "course-1";
const VALID_KEY = "test-service-key";
const TOPIC_AT = new Date("2025-01-01T00:00:00.000Z");
const TOPIC = {
  id: "topic-1",
  courseId: COURSE_ID,
  name: "Graphs",
  createdBy: null,
  deletedAt: null,
  deletedBy: null,
  createdAt: TOPIC_AT,
  updatedAt: TOPIC_AT,
};
const TOPIC_JSON = {
  ...TOPIC,
  createdAt: TOPIC_AT.toISOString(),
  updatedAt: TOPIC_AT.toISOString(),
};

const COURSE = { id: COURSE_ID, isPublished: true, department: null };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function mockUser(id = "u1", role = "STUDENT") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

function makeLoaderArgs(courseId: string, topicId?: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  const path = topicId
    ? `/api/courses/${courseId}/topics/${topicId}`
    : `/api/courses/${courseId}/topics`;
  return {
    request: new Request(`http://localhost${path}`, { method: "GET", headers }),
    params: { courseId, ...(topicId ? { topicId } : {}) },
    context: {} as never,
  };
}

function makeAction(
  method: string,
  body: unknown,
  opts: { authorization?: string; topicId?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.authorization) headers.set("Authorization", opts.authorization);
  const path = opts.topicId
    ? `/api/courses/${COURSE_ID}/topics/${opts.topicId}`
    : `/api/courses/${COURSE_ID}/topics`;
  return {
    request: new Request(`http://localhost${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    }),
    params: { courseId: COURSE_ID, ...(opts.topicId ? { topicId: opts.topicId } : {}) },
    context: {} as never,
  };
}

const makePost = (body: unknown, authorization?: string) =>
  makeAction("POST", body, { authorization });
const makeDelete = (body: unknown, authorization?: string) =>
  makeAction("DELETE", body, { authorization });
const makePatch = (body: unknown, topicId?: string, authorization?: string) =>
  makeAction("PATCH", body, { topicId, authorization });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(getCourseTopics).mockResolvedValue([]);
  vi.mocked(getCourseTopic).mockResolvedValue(TOPIC);
  mockAccess({ level: "admin", rank: 4 });
  vi.mocked(getPolicy).mockImplementation(async (key) => POLICY_FLAGS[key].default);
});

afterEach(() => vi.unstubAllEnvs());

describe("courses.topics loader", () => {
  it("returns 400 when courseId is missing", async () => {
    const res = await loader({
      request: new Request("http://localhost/api/courses//topics"),
      params: {},
      context: {} as never,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Course ID is required" });
  });

  it("returns 401 when no Bearer header and no session", async () => {
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getCourseTopics).not.toHaveBeenCalled();
  });

  it("returns 403 when Bearer token fails requireServiceKey", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await loader(makeLoaderArgs(COURSE_ID, undefined, "Bearer wrong"));
    expect(res.status).toBe(403);
    expect(getCourseTopics).not.toHaveBeenCalled();
  });

  it("returns 200 topics list via service key (no RBAC resolution)", async () => {
    vi.mocked(getCourseTopics).mockResolvedValue([TOPIC]);
    const res = await loader(makeLoaderArgs(COURSE_ID, undefined, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics).toHaveLength(1);
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND when resolver finds no course (#299)", async () => {
    mockUser();
    mockAccess(null, null);
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(404);
  });

  it("returns 403 for an authenticated user with no course relationship (#299)", async () => {
    mockUser();
    mockAccess(null);
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(403);
    expect(getCourseTopics).not.toHaveBeenCalled();
  });

  it("returns 403 for an enrolled student in an unpublished course (§19)", async () => {
    mockUser();
    mockAccess({ level: "student", rank: 0 }, { ...COURSE, isPublished: false });
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(403);
  });

  it("returns 200 for an enrolled student in a published course", async () => {
    mockUser();
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(getCourseTopics).mockResolvedValue([TOPIC]);
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics).toHaveLength(1);
  });

  it("returns 200 for a TA even in an unpublished course", async () => {
    mockUser();
    mockAccess({ level: "ta", rank: 1 }, { ...COURSE, isPublished: false });
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(200);
  });

  it("returns 404 TOPIC_NOT_FOUND for unknown topic id", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(getCourseTopic).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs(COURSE_ID, "missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns 200 flat topic via session", async () => {
    mockUser("u1", "ADMIN");
    const res = await loader(makeLoaderArgs(COURSE_ID, "topic-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TOPIC_JSON);
  });
});

describe("courses.topics action — POST", () => {
  it("returns 401 without auth", async () => {
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(401);
    expect(createCourseTopic).not.toHaveBeenCalled();
  });

  it("returns 403 for an enrolled student", async () => {
    mockUser();
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 403 for an enrolled TA (create is rank >= 2)", async () => {
    mockUser();
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(403);
  });

  it("admits a TA create when tas.canManageTopics is on", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(getPolicy).mockResolvedValue(true);
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(201);
    expect(getPolicy).toHaveBeenCalledWith("tas.canManageTopics");
  });

  it("returns 201 for an enrolled INSTRUCTOR (#299 — no longer ADMIN-only)", async () => {
    mockUser("u1", "INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(201);
  });

  it("returns 404 COURSE_NOT_FOUND when course does not exist", async () => {
    mockUser("u1", "ADMIN");
    mockAccess(null, null);
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 409 TOPIC_ALREADY_EXISTS with existingId", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(createCourseTopic).mockResolvedValue({
      status: "409",
      existingId: "existing-id",
    });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "TOPIC_ALREADY_EXISTS",
      existingId: "existing-id",
    });
  });

  it("returns 201 flat topic for admin session", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(TOPIC_JSON);
  });

  it("threads the session user id as createdBy (#294)", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    await action(makePost({ name: "Heaps" }));
    expect(createCourseTopic).toHaveBeenCalledWith(COURSE_ID, { name: "Heaps" }, "u1");
  });

  it("returns 201 via service key without session", async () => {
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    const res = await action(makePost({ name: "Heaps" }, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(201);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("passes null createdBy on the service-key path (#294 — no owner)", async () => {
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    await action(makePost({ name: "Heaps" }, `Bearer ${VALID_KEY}`));
    expect(createCourseTopic).toHaveBeenCalledWith(COURSE_ID, { name: "Heaps" }, null);
  });
});

describe("courses.topics action — PATCH (#299 new route)", () => {
  it("returns 400 when topicId is missing", async () => {
    mockUser("u1", "ADMIN");
    const res = await action(makeAction("PATCH", { name: "Renamed" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TOPIC_ID_REQUIRED" });
  });

  it("returns 403 for an enrolled student", async () => {
    mockUser();
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(403);
    expect(updateCourseTopic).not.toHaveBeenCalled();
  });

  it("returns 200 for an enrolled INSTRUCTOR", async () => {
    mockUser("u1", "INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(updateCourseTopic).mockResolvedValue({
      status: "200",
      topic: { ...TOPIC, name: "Renamed" },
    });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renamed");
    expect(updateCourseTopic).toHaveBeenCalledWith(COURSE_ID, "topic-1", { name: "Renamed" });
  });

  it("admits a TA on their own topic (§19 TA own-only)", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "ta-1" });
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "200", topic: TOPIC });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(200);
  });

  it("rejects a TA on another user's topic", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "someone-else" });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(403);
  });

  it("admits a TA on another user's topic when tas.canManageTopics is on", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "someone-else" });
    vi.mocked(getPolicy).mockResolvedValue(true);
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "200", topic: TOPIC });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(200);
  });

  it("rejects a TA on an ownerless topic (null createdBy)", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: null });
    const res = await action(makePatch({ name: "Renamed" }, "topic-1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 TOPIC_NOT_FOUND when topic does not exist", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "404" });
    const res = await action(makePatch({ name: "Renamed" }, "missing"));
    expect(res.status).toBe(404);
  });

  it("returns 409 on duplicate name", async () => {
    mockUser("u1", "ADMIN");
    vi.mocked(updateCourseTopic).mockResolvedValue({ status: "409", existingId: "other" });
    const res = await action(makePatch({ name: "Graphs" }, "topic-1"));
    expect(res.status).toBe(409);
  });
});

describe("courses.topics action — DELETE", () => {
  beforeEach(() => {
    mockUser("u1", "ADMIN");
  });

  it("returns 404 when topic not found", async () => {
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "404" });
    const res = await action(makeDelete({ topicId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful soft delete", async () => {
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(204);
  });

  it("returns 403 for an enrolled student (#299 — was ADMIN-only, now rank >= 2)", async () => {
    mockUser();
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(403);
    expect(deleteCourseTopic).not.toHaveBeenCalled();
  });

  it("returns 204 for an enrolled INSTRUCTOR", async () => {
    mockUser("u1", "INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(204);
  });

  it("admits a TA deleting their own topic (§19 TA own-only)", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "ta-1" });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(204);
  });

  it("rejects a TA deleting another user's topic", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "someone-else" });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(403);
    expect(deleteCourseTopic).not.toHaveBeenCalled();
  });

  it("admits a TA deleting another user's topic when tas.canManageTopics is on", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    prismaMock.courseTopic.findFirst.mockResolvedValue({ createdBy: "someone-else" });
    vi.mocked(getPolicy).mockResolvedValue(true);
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(204);
  });

  it("resolves delete-by-name to a topic id for the TA own-only check", async () => {
    mockUser("ta-1");
    mockAccess({ level: "ta", rank: 1 });
    // First call resolves name → id, second call reads createdBy for ownership.
    prismaMock.courseTopic.findFirst
      .mockResolvedValueOnce({ id: "topic-1" })
      .mockResolvedValueOnce({ createdBy: "ta-1" });
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ name: "Graphs" }));
    expect(res.status).toBe(204);
  });

  it("returns 204 via service key without session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204", topic: { id: TOPIC.id, name: TOPIC.name } });
    const res = await action(makeDelete({ topicId: "topic-1" }, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(204);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });
});
