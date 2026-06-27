import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getCourse: vi.fn(),
  updateCourse: vi.fn(),
  deleteCourse: vi.fn(),
}));

import { loader, action } from "~/routes/api/courses.id";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { getCourse, updateCourse, deleteCourse } from "~/lib/courses/server";

const VALID_KEY = "test-service-key";
const COURSE = {
  id: "course-1",
  name: "Algorithms",
  code: "COSC 101",
  isPublished: true,
  deletedAt: null,
};

function makeArgs(id?: string, authorization?: string, method = "GET") {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${id ?? ""}`, { method, headers }),
    params: id !== undefined ? { id } : {},
    context: {} as never,
  } as any;
}

describe("GET /api/courses/:id loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(getCourse).mockResolvedValue(COURSE as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: COURSE as never,
      access: { level: "student", rank: 0 },
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 400 when id is missing", async () => {
    const res = await loader(makeArgs() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 401 when no Bearer header and no session", async () => {
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 403 when Bearer token fails requireServiceKey", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await loader(makeArgs("course-1", "Bearer wrong"));
    expect(res.status).toBe(403);
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 200 via service key without session (unscoped)", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COURSE);
    expect(getCourse).toHaveBeenCalledWith("course-1");
    expect(auth.api.getSession).not.toHaveBeenCalled();
    expect(resolveCourseAccessWithCourse).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND when the resolver finds no course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({ course: null, access: null });
    const res = await loader(makeArgs("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 403 when the caller has no course relationship", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: COURSE as never,
      access: null,
    });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for an enrolled student when the course is unpublished (§19 gate)", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { ...COURSE, isPublished: false } as never,
      access: { level: "student", rank: 0 },
    });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(403);
  });

  it("returns 200 for a TA even when the course is unpublished", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { ...COURSE, isPublished: false } as never,
      access: { level: "ta", rank: 1 },
    });
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
  });

  it("returns 200 with flat course JSON for an enrolled student in a published course", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COURSE);
    expect(resolveCourseAccessWithCourse).toHaveBeenCalledWith(
      { id: "u1", role: "STUDENT" },
      "course-1",
    );
  });
});

describe("courses.id action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateCourse).mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(deleteCourse).mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("routes PATCH to updateCourse", async () => {
    const res = await action(makeArgs("course-1", undefined, "PATCH"));
    expect(res.status).toBe(200);
    expect(updateCourse).toHaveBeenCalledWith(expect.any(Request), "course-1");
  });

  it("routes DELETE to deleteCourse (#298 soft-delete)", async () => {
    const res = await action(makeArgs("course-1", undefined, "DELETE"));
    expect(res.status).toBe(204);
    expect(deleteCourse).toHaveBeenCalledWith(expect.any(Request), "course-1");
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await action(makeArgs("course-1", undefined, "PUT"));
    expect(res.status).toBe(405);
    expect(updateCourse).not.toHaveBeenCalled();
    expect(deleteCourse).not.toHaveBeenCalled();
  });
});
