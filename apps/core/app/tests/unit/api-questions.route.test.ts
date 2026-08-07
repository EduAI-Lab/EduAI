// @vitest-environment node
// #1213 — GET/POST /api/questions: service-key vs session auth branches,
// course-access gating, answer stripping for low-rank access, and the
// create action's course-access precheck + idempotency passthrough.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
  stripAnswerForStudents: vi.fn((q: unknown) => q),
  wantsIncludeDeleted: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { course: { findUnique: vi.fn() } },
}));

vi.mock("~/lib/questions/server", () => ({
  listQuestions: vi.fn(),
  createQuestion: vi.fn(),
}));

import { loader, action } from "~/routes/api/questions";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import {
  resolveCourseAccessWithCourse,
  wantsIncludeDeleted,
} from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { listQuestions, createQuestion } from "~/lib/questions/server";

function makeLoaderArgs(query: string, headers: Record<string, string> = {}) {
  return {
    request: new Request(`http://localhost/api/questions${query}`, { headers }),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "POST") {
  return {
    request: new Request("http://localhost/api/questions", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(wantsIncludeDeleted).mockReturnValue(false);
  vi.mocked(listQuestions).mockResolvedValue({ questions: [], total: 0 } as never);
});

describe("GET /api/questions", () => {
  it("returns 400 without a courseId (session path)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous session callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs("?courseId=course-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the course does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({ course: null, access: null });
    const res = await loader(makeLoaderArgs("?courseId=course-1"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when access rank is 0 (e.g. a STUDENT reading directly)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "student", rank: 0 },
    } as never);
    const res = await loader(makeLoaderArgs("?courseId=course-1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with the question list for an authorized INSTRUCTOR", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    vi.mocked(listQuestions).mockResolvedValue({
      questions: [{ id: "q1" }],
      total: 1,
    } as never);

    const res = await loader(makeLoaderArgs("?courseId=course-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ questions: [{ id: "q1" }], total: 1 });
  });

  it("goes through requireServiceKey and skips course-access resolution for Bearer auth", async () => {
    vi.mocked(prisma.course.findUnique).mockResolvedValue({ id: "course-1" } as never);
    const res = await loader(makeLoaderArgs("?courseId=course-1", { Authorization: "Bearer svc-key" }));
    expect(res.status).toBe(200);
    expect(requireServiceKey).toHaveBeenCalled();
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns whatever requireServiceKey's guard response is when the key is invalid", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(new Response(null, { status: 401 }) as never);
    const res = await loader(makeLoaderArgs("?courseId=course-1", { Authorization: "Bearer bad" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/questions (action)", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeActionArgs({}, "DELETE"));
    expect(res.status).toBe(405);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeActionArgs({ courseId: "course-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks course access", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "student", rank: 0 },
    } as never);
    const res = await action(makeActionArgs({ courseId: "course-1" }));
    expect(res.status).toBe(403);
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it("creates the question and returns 201 on success", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    vi.mocked(createQuestion).mockResolvedValue({ id: "q1" } as never);

    const res = await action(makeActionArgs({ courseId: "course-1", prompt: "2+2?" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: "q1" });
  });

  it("maps a service-level creation error to a 404/422 status", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    vi.mocked(createQuestion).mockResolvedValue({ error: "TOPIC_NOT_FOUND" } as never);

    const res = await action(makeActionArgs({ courseId: "course-1", topicId: "bad" }));
    expect(res.status).toBe(404);
  });
});
