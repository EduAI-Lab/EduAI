import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/canvas/materials.server", () => ({
  discoverCanvasMaterialsForCourse: vi.fn(),
  syncSelectedCanvasMaterials: vi.fn(),
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
import { CanvasStoredCredentialsError } from "~/lib/canvas/integration.server";
import { discoverCanvasMaterialsForCourse } from "~/lib/canvas/materials.server";
import { loader } from "~/routes/api/courses.canvas-materials.$";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: { id: "core-course-1" },
    access: { level: "instructor", rank: 2 },
  } as never);
  vi.mocked(discoverCanvasMaterialsForCourse).mockResolvedValue([]);
});

function makeRequest(url: string) {
  return new Request(url, { method: "GET" });
}

describe("courses.canvas-materials loader", () => {
  it("does not opt into the publish-state recheck when ?recheck is absent (GET stays safe by default)", async () => {
    await loader({
      request: makeRequest("http://localhost/api/courses/core-course-1/canvas-materials"),
      params: { courseId: "core-course-1" },
    } as never);

    expect(discoverCanvasMaterialsForCourse).toHaveBeenCalledWith(
      "user-1",
      "core-course-1",
      undefined,
      { recheckPublishState: false },
    );
  });

  it("opts into the publish-state recheck when ?recheck=true", async () => {
    await loader({
      request: makeRequest(
        "http://localhost/api/courses/core-course-1/canvas-materials?recheck=true",
      ),
      params: { courseId: "core-course-1" },
    } as never);

    expect(discoverCanvasMaterialsForCourse).toHaveBeenCalledWith(
      "user-1",
      "core-course-1",
      undefined,
      { recheckPublishState: true },
    );
  });

  it("treats any non-'true' value as not opting in", async () => {
    await loader({
      request: makeRequest(
        "http://localhost/api/courses/core-course-1/canvas-materials?recheck=1",
      ),
      params: { courseId: "core-course-1" },
    } as never);

    expect(discoverCanvasMaterialsForCourse).toHaveBeenCalledWith(
      "user-1",
      "core-course-1",
      undefined,
      { recheckPublishState: false },
    );
  });

  it("returns 400 with reconnect message when stored Canvas credentials cannot be decrypted", async () => {
    vi.mocked(discoverCanvasMaterialsForCourse).mockRejectedValue(
      new CanvasStoredCredentialsError(),
    );

    const res = await loader({
      request: makeRequest("http://localhost/api/courses/core-course-1/canvas-materials"),
      params: { courseId: "core-course-1" },
    } as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Stored Canvas credentials could not be decrypted. Reconnect Canvas in Settings.",
    });
  });
});
