// @vitest-environment node
//
// Integration tests for:
//   GET    /api/courses/:courseId/topics
//   POST   /api/courses/:courseId/topics
//   DELETE /api/courses/:courseId/topics
//
// Auth layer is mocked; all other logic (Prisma, guards, schemas) runs against
// the real test database.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader, action } from "~/routes/api/courses.topics.$";
import { auth } from "~/lib/auth/server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_SERVICE_KEY = "topics-integration-service-key-xyz";

const ADMIN_SESSION = {
  user: { id: "", role: "ADMIN", email: "admin-topics@test.com", name: "Admin" },
};
const STUDENT_SESSION = {
  user: { id: "", role: "STUDENT", email: "student-topics@test.com", name: "Student" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLoaderArgs(
  courseId: string,
  topicId?: string,
  authorization?: string,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(
      `http://localhost/api/courses/${courseId}/topics`,
      { method: "GET", headers },
    ),
    params: { courseId, ...(topicId ? { topicId } : {}) },
    context: {} as never,
  };
}

function makeActionArgs(
  method: "POST" | "DELETE",
  courseId: string,
  body?: unknown,
  authorization?: string,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(
      `http://localhost/api/courses/${courseId}/topics`,
      { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    ),
    params: { courseId },
    context: {} as never,
  };
}

function missingCourseIdArgs(method: "GET" | "POST" | "DELETE", body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  return {
    request: new Request("http://localhost/api/courses//topics", {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    params: {} as Record<string, string>,
    context: {} as never,
  };
}

// ---------------------------------------------------------------------------
// Seed / teardown
// ---------------------------------------------------------------------------

let courseId: string;
let adminId: string;
let studentId: string;

beforeAll(async () => {
  vi.stubEnv("EDUAI_API_KEY", VALID_SERVICE_KEY);

  const admin = await prisma.user.create({
    data: {
      email: "admin-topics@test.com",
      name: "Admin Topics",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  adminId = admin.id;
  ADMIN_SESSION.user.id = adminId;

  const student = await prisma.user.create({
    data: {
      email: "student-topics@test.com",
      name: "Student Topics",
      role: "STUDENT",
      emailVerified: false,
    },
  });
  studentId = student.id;
  STUDENT_SESSION.user.id = studentId;

  const course = await prisma.course.create({
    data: {
      name: "Topics Integration Course",
      code: "TOP 999",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;
});

afterAll(async () => {
  await prisma.courseTopic.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, studentId] } } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default to no session — each test that needs auth configures its own.
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// GET /api/courses/:courseId/topics
// ---------------------------------------------------------------------------

describe("GET /api/courses/:courseId/topics", () => {
  it("returns 400 when courseId is missing", async () => {
    const res = await loader(missingCourseIdArgs("GET") as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Course ID is required" });
  });

  it("returns 401 when no session is present", async () => {
    const res = await loader(makeLoaderArgs(courseId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 INVALID_SERVICE_KEY for a wrong Bearer token", async () => {
    const res = await loader(makeLoaderArgs(courseId, undefined, "Bearer wrong-key"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 200 with empty topics array when course has no topics", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("topics");
    expect(Array.isArray(body.topics)).toBe(true);
    expect(body.topics).toHaveLength(0);
  });

  it("returns 200 with topics for any authenticated user", async () => {
    await prisma.courseTopic.create({ data: { courseId, name: "Sorting Algorithms" } });

    vi.mocked(auth.api.getSession).mockResolvedValue(STUDENT_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics.some((t: { name: string }) => t.name === "Sorting Algorithms")).toBe(true);

    await prisma.courseTopic.deleteMany({ where: { courseId, name: "Sorting Algorithms" } });
  });

  it("returns 200 with topics via service key — no session required", async () => {
    await prisma.courseTopic.create({ data: { courseId, name: "Graphs" } });

    const res = await loader(makeLoaderArgs(courseId, undefined, `Bearer ${VALID_SERVICE_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics.some((t: { name: string }) => t.name === "Graphs")).toBe(true);
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();

    await prisma.courseTopic.deleteMany({ where: { courseId, name: "Graphs" } });
  });

  it("excludes soft-deleted topics from the list", async () => {
    await prisma.courseTopic.create({
      data: { courseId, name: "Hidden Topic", deletedAt: new Date() },
    });
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics.some((t: { name: string }) => t.name === "Hidden Topic")).toBe(false);
    await prisma.courseTopic.deleteMany({ where: { courseId, name: "Hidden Topic" } });
  });
});

// ---------------------------------------------------------------------------
// GET /api/courses/:courseId/topics/:topicId
// ---------------------------------------------------------------------------

describe("GET /api/courses/:courseId/topics/:topicId", () => {
  let singleTopicId: string;

  beforeAll(async () => {
    const t = await prisma.courseTopic.create({ data: { courseId, name: "Single Topic Test" } });
    singleTopicId = t.id;
  });

  afterAll(async () => {
    await prisma.courseTopic.deleteMany({ where: { courseId, name: "Single Topic Test" } });
  });

  it("returns 401 when no session is present", async () => {
    const res = await loader(makeLoaderArgs(courseId, singleTopicId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 200 with the topic when authenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId, singleTopicId));
    expect(res.status).toBe(200);
    const topic = await res.json();
    expect(topic.id).toBe(singleTopicId);
    expect(topic.name).toBe("Single Topic Test");
    expect(topic.courseId).toBe(courseId);
  });

  it("returns 200 with the topic via service key — no session required", async () => {
    const res = await loader(
      makeLoaderArgs(courseId, singleTopicId, `Bearer ${VALID_SERVICE_KEY}`),
    );
    expect(res.status).toBe(200);
    const topic = await res.json();
    expect(topic.id).toBe(singleTopicId);
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 404 TOPIC_NOT_FOUND when topicId does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId, "nonexistent-topic-id"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns 404 TOPIC_NOT_FOUND when topic is soft-deleted", async () => {
    const deleted = await prisma.courseTopic.create({
      data: { courseId, name: "Soft Deleted Topic", deletedAt: new Date() },
    });
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await loader(makeLoaderArgs(courseId, deleted.id));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
    await prisma.courseTopic.delete({ where: { id: deleted.id } });
  });
});

// ---------------------------------------------------------------------------
// POST /api/courses/:courseId/topics
// ---------------------------------------------------------------------------

describe("POST /api/courses/:courseId/topics", () => {
  it("returns 400 when courseId is missing", async () => {
    const res = await action(missingCourseIdArgs("POST", { name: "Trees" }) as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Course ID is required" });
  });

  it("returns 401 when no session is present", async () => {
    const res = await action(makeActionArgs("POST", courseId, { name: "Heaps" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when a non-admin user attempts to create a topic", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(STUDENT_SESSION as never);
    const res = await action(makeActionArgs("POST", courseId, { name: "Heaps" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 403 INVALID_SERVICE_KEY for a wrong Bearer token", async () => {
    const res = await action(
      makeActionArgs("POST", courseId, { name: "Heaps" }, "Bearer wrong-key"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 400 when name is an empty string", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("POST", courseId, { name: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 COURSE_NOT_FOUND for unknown courseId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(
      makeActionArgs("POST", "nonexistent-course-id", { name: "Orphan Topic" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 201 with the created topic when an admin posts a valid body", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("POST", courseId, { name: "Dynamic Programming" }));
    expect(res.status).toBe(201);
    const topic = await res.json();
    expect(topic.name).toBe("Dynamic Programming");
    expect(topic.courseId).toBe(courseId);
    expect(typeof topic.id).toBe("string");
  });

  it("returns 201 with the created topic via service key — no session required", async () => {
    const res = await action(
      makeActionArgs("POST", courseId, { name: "Greedy Algorithms" }, `Bearer ${VALID_SERVICE_KEY}`),
    );
    expect(res.status).toBe(201);
    const topic = await res.json();
    expect(topic.name).toBe("Greedy Algorithms");
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 409 TOPIC_ALREADY_EXISTS with existingId on duplicate name", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);

    const first = await action(makeActionArgs("POST", courseId, { name: "Binary Search" }));
    expect(first.status).toBe(201);
    const { id: existingId } = await first.json();

    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const second = await action(makeActionArgs("POST", courseId, { name: "Binary Search" }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body).toEqual({ error: "TOPIC_ALREADY_EXISTS", existingId });
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/courses/:courseId/topics
// ---------------------------------------------------------------------------

describe("DELETE /api/courses/:courseId/topics", () => {
  let deleteByIdTopicId: string;

  beforeAll(async () => {
    const t1 = await prisma.courseTopic.create({ data: { courseId, name: "To Delete By Id" } });
    deleteByIdTopicId = t1.id;
    await prisma.courseTopic.create({ data: { courseId, name: "To Delete By Name" } });
  });

  it("returns 400 when courseId is missing", async () => {
    const res = await action(
      missingCourseIdArgs("DELETE", { topicId: deleteByIdTopicId }) as never,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Course ID is required" });
  });

  it("returns 401 when no session is present", async () => {
    const res = await action(makeActionArgs("DELETE", courseId, { topicId: deleteByIdTopicId }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when a non-admin user attempts to delete a topic", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(STUDENT_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, { topicId: deleteByIdTopicId }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 403 INVALID_SERVICE_KEY for a wrong Bearer token", async () => {
    const res = await action(
      makeActionArgs("DELETE", courseId, { topicId: deleteByIdTopicId }, "Bearer wrong-key"),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });

  it("returns 400 when neither topicId nor name is provided", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when no topic matches the given topicId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, { topicId: "nonexistent-cuid" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when no topic matches the given name", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, { name: "Nonexistent Topic" }));
    expect(res.status).toBe(404);
  });

  it("returns 204 when an admin deletes a topic by topicId (soft delete)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, { topicId: deleteByIdTopicId }));
    expect(res.status).toBe(204);
    const row = await prisma.courseTopic.findUnique({ where: { id: deleteByIdTopicId } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("returns 204 when an admin deletes a topic by name (soft delete)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(ADMIN_SESSION as never);
    const res = await action(makeActionArgs("DELETE", courseId, { name: "To Delete By Name" }));
    expect(res.status).toBe(204);
    const row = await prisma.courseTopic.findFirst({
      where: { courseId, name: "To Delete By Name" },
    });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("returns 204 when a service key deletes a topic — no session required", async () => {
    const extra = await prisma.courseTopic.create({ data: { courseId, name: "Service Delete Topic" } });
    const res = await action(
      makeActionArgs("DELETE", courseId, { topicId: extra.id }, `Bearer ${VALID_SERVICE_KEY}`),
    );
    expect(res.status).toBe(204);
    expect(vi.mocked(auth.api.getSession)).not.toHaveBeenCalled();
  });
});
