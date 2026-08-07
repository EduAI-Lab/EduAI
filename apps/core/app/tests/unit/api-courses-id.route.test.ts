// @vitest-environment node
// #1213 — GET/PATCH/DELETE /api/courses/:id: service-key vs session read
// paths, the includeDeleted forensics bypass, the published-gate for
// students, and the PATCH/DELETE audit-on-success branches.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireServiceKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
  wantsIncludeDeleted: vi.fn().mockReturnValue(false),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/courses.id";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse, wantsIncludeDeleted } from "~/lib/auth/course-access.server";
import { getCourse, updateCourse, deleteCourse } from "~/lib/courses/server";
import { logAuditAction } from "~/lib/logging.server";

function makeLoaderArgs(id?: string, headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/api/courses/course-1", { headers }),
    params: id === undefined ? { id: "course-1" } : { id },
    context: {} as never,
  } as never;
}

function makeActionArgs(method: string, id?: string) {
  return {
    request: new Request("http://localhost/api/courses/course-1", { method }),
    params: id === undefined ? { id: "course-1" } : { id },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireServiceKey).mockResolvedValue(null);
  vi.mocked(wantsIncludeDeleted).mockReturnValue(false);
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
});

describe("GET /api/courses/:id", () => {
  it("returns 400 when :id is missing", async () => {
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns the course directly for a valid service key (unscoped)", async () => {
    vi.mocked(getCourse).mockResolvedValue({ id: "course-1" } as never);
    const res = await loader(makeLoaderArgs(undefined, { Authorization: "Bearer svc" }));
    expect(res.status).toBe(200);
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 404 for a service-key caller when the course is missing", async () => {
    vi.mocked(getCourse).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs(undefined, { Authorization: "Bearer svc" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 for anonymous session callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("bypasses the access resolver for an ADMIN includeDeleted read", async () => {
    vi.mocked(wantsIncludeDeleted).mockReturnValue(true);
    vi.mocked(getCourse).mockResolvedValue({ id: "course-1" } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    expect(getCourse).toHaveBeenCalledWith("course-1", true);
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 404 when the course does not exist", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({ course: null, access: null });
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(404);
  });

  it("returns 403 for a student and an unpublished course", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1", isPublished: false },
      access: { level: "student", rank: 0 },
    } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(403);
  });

  it("returns the course for an authorized instructor", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "course-1", isPublished: true },
      access: { level: "instructor", rank: 2 },
    } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
  });
});

describe("/api/courses/:id action", () => {
  it("returns 400 when :id is missing", async () => {
    const res = await action(makeActionArgs("PATCH", ""));
    expect(res.status).toBe(400);
  });

  it("rejects unsupported methods with 405", async () => {
    const res = await action(makeActionArgs("PUT"));
    expect(res.status).toBe(405);
  });

  it("logs COURSE_UPDATED on a successful PATCH", async () => {
    vi.mocked(updateCourse).mockResolvedValue(
      new Response(JSON.stringify({ id: "course-1", code: "COSC101" }), { status: 200 }),
    );
    const res = await action(makeActionArgs("PATCH"));
    expect(res.status).toBe(200);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "COURSE_UPDATED" }),
    );
  });

  it("does not log when PATCH fails", async () => {
    vi.mocked(updateCourse).mockResolvedValue(new Response(null, { status: 400 }));
    await action(makeActionArgs("PATCH"));
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("logs COURSE_DELETED on a successful DELETE", async () => {
    vi.mocked(deleteCourse).mockResolvedValue(new Response(null, { status: 204 }));
    const res = await action(makeActionArgs("DELETE"));
    expect(res.status).toBe(204);
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "COURSE_DELETED" }),
    );
  });
});
