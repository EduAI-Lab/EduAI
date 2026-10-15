import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveCourseAccessGate = vi.hoisted(() => vi.fn());
const getRequestSession = vi.hoisted(() => vi.fn());
const getPolicy = vi.hoisted(() => vi.fn());
const setMaterialTopics = vi.hoisted(() => vi.fn());
const logAuditAction = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ courseMaterial: { findFirst: vi.fn() } }));

vi.mock("~/lib/auth/course-access.server", () => ({ resolveCourseAccessGate }));
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession }));
vi.mock("~/lib/policy.server", () => ({ getPolicy }));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/topics/material-topics.server", () => ({ setMaterialTopics }));
vi.mock("~/lib/logging.server", () => ({ fireAndForget: vi.fn(), logAuditAction }));
vi.mock("~/lib/request-context.server", () => ({
  getActorContext: () => ({}),
  getRequestContext: () => ({}),
}));

const { action } = await import("~/routes/api/courses.materials.topics");

const PARAMS = { courseId: "course-1", materialId: "mat-1" };

/** Request bodies under test, including the malformed `id` key. */
type TopicsBody = { topics: Array<{ topicId?: string; name?: string; id?: string }> };

function send(raw: string, method: "PUT" | "POST" = "PUT") {
  return new Request("https://eduai.test/api/courses/course-1/materials/mat-1/topics", {
    method,
    body: raw,
    headers: { "Content-Type": "application/json" },
  });
}

function put(body: TopicsBody, method: "PUT" | "POST" = "PUT") {
  return send(JSON.stringify(body), method);
}

function call(request: Request) {
  return action({ request, params: PARAMS, context: {} } as never);
}

function asAccess(level: string, rank: number) {
  resolveCourseAccessGate.mockResolvedValue({
    course: { id: "course-1", isPublished: true },
    access: { level, rank },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSession.mockResolvedValue({ user: { id: "user-1", role: "INSTRUCTOR" } });
  asAccess("instructor", 2);
  getPolicy.mockResolvedValue(false);
  prismaMock.courseMaterial.findFirst.mockResolvedValue({ title: "Week 1", uploadedBy: "user-9" });
  setMaterialTopics.mockResolvedValue({
    status: "200",
    topics: [{ id: "t1", name: "Limits" }],
    createdTopics: [],
  });
});

describe("PUT /api/courses/:courseId/materials/:materialId/topics", () => {
  it("saves an instructor's choice and returns the topics", async () => {
    const res = await call(put({ topics: [{ topicId: "t1" }, { name: "Series" }] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ topics: [{ id: "t1", name: "Limits" }] });
    expect(setMaterialTopics).toHaveBeenCalledWith({
      courseId: "course-1",
      materialId: "mat-1",
      topics: [{ topicId: "t1" }, { name: "Series" }],
      userId: "user-1",
      canCreateTopics: true,
    });
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "MATERIAL_TOPICS_SET", entityId: "mat-1" }),
    );
  });

  it("audits each topic created along the way", async () => {
    setMaterialTopics.mockResolvedValue({
      status: "200",
      topics: [{ id: "t2", name: "Series" }],
      createdTopics: [{ id: "t2", name: "Series" }],
    });

    await call(put({ topics: [{ name: "Series" }] }));

    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "TOPIC_CREATED", entityId: "t2" }),
    );
  });

  it("lets a TA file their own upload, creating topics only with the grant", async () => {
    asAccess("ta", 1);
    prismaMock.courseMaterial.findFirst.mockResolvedValue({ title: "Mine", uploadedBy: "user-1" });

    expect((await call(put({ topics: [] }))).status).toBe(200);
    expect(setMaterialTopics.mock.calls[0][0].canCreateTopics).toBe(false);

    getPolicy.mockResolvedValue(true);
    await call(put({ topics: [] }));
    expect(setMaterialTopics.mock.calls[1][0].canCreateTopics).toBe(true);
    expect(getPolicy).toHaveBeenCalledWith("tas.canManageTopics");
  });

  it("refuses a TA on someone else's upload, and a student", async () => {
    asAccess("ta", 1);
    expect((await call(put({ topics: [] }))).status).toBe(403);

    asAccess("student", 0);
    expect((await call(put({ topics: [] }))).status).toBe(403);
    expect(setMaterialTopics).not.toHaveBeenCalled();
  });

  it("passes the service's refusal through with its status", async () => {
    setMaterialTopics.mockResolvedValue({ status: "400", error: "TOO_MANY_TOPICS" });

    const res = await call(put({ topics: [{ name: "a" }] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "TOO_MANY_TOPICS" });
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("rejects a malformed body, an unknown material, and other methods", async () => {
    expect((await call(send("not json"))).status).toBe(400);
    expect((await call(put({ topics: [{ id: "t1" }] }))).status).toBe(400);
    expect((await call(put({ topics: [] }, "POST"))).status).toBe(405);

    prismaMock.courseMaterial.findFirst.mockResolvedValue(null);
    expect((await call(put({ topics: [] }))).status).toBe(404);
  });

  it("requires a session", async () => {
    getRequestSession.mockResolvedValue(null);
    expect((await call(put({ topics: [] }))).status).toBe(401);
  });
});
