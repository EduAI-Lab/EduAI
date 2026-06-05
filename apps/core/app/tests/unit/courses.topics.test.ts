import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourseTopics: vi.fn(),
  getCourseTopic: vi.fn(),
  createCourseTopic: vi.fn(),
  deleteCourseTopic: vi.fn(),
}));

import { loader, action } from "~/routes/api/courses.topics.$";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  getCourseTopics,
  getCourseTopic,
  createCourseTopic,
  deleteCourseTopic,
} from "~/lib/courses/server";

const COURSE_ID = "course-1";
const VALID_KEY = "test-service-key";
const TOPIC_AT = new Date("2025-01-01T00:00:00.000Z");
const TOPIC = {
  id: "topic-1",
  courseId: COURSE_ID,
  name: "Graphs",
  createdBy: null,
  deletedAt: null,
  createdAt: TOPIC_AT,
  updatedAt: TOPIC_AT,
};
const TOPIC_JSON = {
  ...TOPIC,
  createdAt: TOPIC_AT.toISOString(),
  updatedAt: TOPIC_AT.toISOString(),
};

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

function makePost(body: unknown, authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/topics`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    params: { courseId: COURSE_ID },
    context: {} as never,
  };
}

function makeDelete(body: unknown, authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/topics`, {
      method: "DELETE",
      headers,
      body: JSON.stringify(body),
    }),
    params: { courseId: COURSE_ID },
    context: {} as never,
  };
}

describe("courses.topics loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(getCourseTopics).mockResolvedValue([]);
    vi.mocked(getCourseTopic).mockResolvedValue(TOPIC);
  });

  afterEach(() => vi.unstubAllEnvs());

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

  it("returns 200 topics list via service key", async () => {
    vi.mocked(getCourseTopics).mockResolvedValue([TOPIC]);
    const res = await loader(makeLoaderArgs(COURSE_ID, undefined, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics).toHaveLength(1);
    expect(getCourseTopics).toHaveBeenCalledWith(COURSE_ID);
  });

  it("returns 200 topics list via session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(getCourseTopics).mockResolvedValue([TOPIC]);
    const res = await loader(makeLoaderArgs(COURSE_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0].id).toBe(TOPIC.id);
  });

  it("returns 404 TOPIC_NOT_FOUND for unknown topic id", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    vi.mocked(getCourseTopic).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs(COURSE_ID, "missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns 200 flat topic via session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    const res = await loader(makeLoaderArgs(COURSE_ID, "topic-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TOPIC_JSON);
  });
});

describe("courses.topics action — POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 without auth", async () => {
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(401);
    expect(createCourseTopic).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 404 COURSE_NOT_FOUND when course does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "404" });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 409 TOPIC_ALREADY_EXISTS with existingId", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
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
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    vi.mocked(createCourseTopic).mockResolvedValue({ status: "201", topic: TOPIC });
    const res = await action(makePost({ name: "Heaps" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(TOPIC_JSON);
  });

  it("threads the session user id as createdBy (#294)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
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

describe("courses.topics action — DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 404 when topic not found", async () => {
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "404" });
    const res = await action(makeDelete({ topicId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 204 on successful soft delete", async () => {
    vi.mocked(deleteCourseTopic).mockResolvedValue({ status: "204" });
    const res = await action(makeDelete({ topicId: "topic-1" }));
    expect(res.status).toBe(204);
  });
});
