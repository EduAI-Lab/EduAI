import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/canvas/materials.server", () => ({
  excludeCanvasMaterial: vi.fn(),
  unexcludeCanvasMaterial: vi.fn(),
  CanvasMaterialSyncError: class CanvasMaterialSyncError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import { excludeCanvasMaterial, unexcludeCanvasMaterial } from "~/lib/canvas/materials.server";
import { action } from "~/routes/api/courses.canvas-materials.exclusions.$";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: { id: "core-course-1" },
    access: { level: "instructor", rank: 2 },
  } as never);
});

function makeRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/courses/core-course-1/canvas-materials/exclusions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("courses.canvas-materials.exclusions action", () => {
  it("excludes a Canvas file on POST", async () => {
    const response = await action({
      request: makeRequest("POST", { canvasFileId: "1001" }),
      params: { courseId: "core-course-1" },
    } as never);

    expect(response.status).toBe(200);
    expect(excludeCanvasMaterial).toHaveBeenCalledWith("user-1", "core-course-1", "1001");
  });

  it("unexcludes a Canvas file on DELETE", async () => {
    const response = await action({
      request: makeRequest("DELETE", { canvasFileId: "1001" }),
      params: { courseId: "core-course-1" },
    } as never);

    expect(response.status).toBe(204);
    expect(unexcludeCanvasMaterial).toHaveBeenCalledWith("user-1", "core-course-1", "1001");
  });

  it("rejects non-instructor access with 403", async () => {
    vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
      course: { id: "core-course-1" },
      access: { level: "student", rank: 0 },
    } as never);

    const response = await action({
      request: makeRequest("POST", { canvasFileId: "1001" }),
      params: { courseId: "core-course-1" },
    } as never);

    expect(response.status).toBe(403);
  });
});
