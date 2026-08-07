// @vitest-environment node
// #1213 — GET/PATCH /api/courses/:id/rag-settings: courseId gate, auth gate,
// instructor-or-above (rank>=2) gate, and the update+cache-invalidate path.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourseRagSettings: vi.fn(),
  invalidateCourseRagSettingsCache: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { course: { update: vi.fn() } },
}));

import { loader, action } from "~/routes/api/courses.id.rag-settings";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getCourseRagSettings, invalidateCourseRagSettingsCache } from "~/lib/courses/server";
import prisma from "~/lib/prisma.server";

function makeLoaderArgs(id?: string) {
  return {
    request: new Request("http://localhost/api/courses/course-1/rag-settings"),
    params: id === undefined ? { id: "course-1" } : { id },
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "PATCH") {
  return {
    request: new Request("http://localhost/api/courses/course-1/rag-settings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "course-1" },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
});

describe("GET /api/courses/:id/rag-settings", () => {
  it("returns 400 when :id is missing", async () => {
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the course does not exist", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({ course: null, access: null });
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(404);
  });

  it("returns 403 for rank < 2 (e.g. a TA)", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1", courseScopeGuardrailEnabled: false },
      access: { level: "ta", rank: 1 },
    } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(403);
  });

  it("returns settings + guardrail flag for an instructor", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1", courseScopeGuardrailEnabled: true },
      access: { level: "instructor", rank: 2 },
    } as never);
    vi.mocked(getCourseRagSettings).mockResolvedValue({ ragTopK: 5 } as never);

    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ragTopK: 5, courseScopeGuardrailEnabled: true });
  });
});

describe("PATCH /api/courses/:id/rag-settings", () => {
  it("rejects non-PATCH methods with 405", async () => {
    const res = await action(makeActionArgs({}, "DELETE"));
    expect(res.status).toBe(405);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeActionArgs({ ragTopK: 5 }));
    expect(res.status).toBe(401);
  });

  it("returns 422 for a schema-invalid body", async () => {
    const res = await action(makeActionArgs({ ragTopK: "not-a-number" }));
    expect(res.status).toBe(422);
  });

  it("returns 403 for a caller below instructor rank", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "student", rank: 0 },
    } as never);
    const res = await action(makeActionArgs({ ragTopK: 5 }));
    expect(res.status).toBe(403);
  });

  it("updates and invalidates the cache on success", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "instructor", rank: 2 },
    } as never);
    vi.mocked(prisma.course.update).mockResolvedValue({
      id: "course-1",
      courseScopeGuardrailEnabled: true,
      ragTopK: 5,
      ragSimilarityThreshold: 0.5,
    } as never);

    const res = await action(makeActionArgs({ ragTopK: 5 }));
    expect(res.status).toBe(200);
    expect(invalidateCourseRagSettingsCache).toHaveBeenCalledWith("course-1");
  });
});
