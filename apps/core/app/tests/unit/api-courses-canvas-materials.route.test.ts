// @vitest-environment node
// #1213 — GET/POST /api/courses/:courseId/canvas-materials: courseId gate,
// auth + instructor-only access gate, the discover/sync happy paths, and
// the shared Canvas-error → status-code mapping.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return { ...actual };
});

vi.mock("~/lib/canvas/courses.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/courses.server")>();
  return { ...actual };
});

vi.mock("~/lib/canvas/integration.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/integration.server")>();
  return { ...actual };
});

vi.mock("~/lib/canvas/materials.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/materials.server")>();
  return {
    ...actual,
    discoverCanvasMaterialsForCourse: vi.fn(),
    syncSelectedCanvasMaterials: vi.fn(),
  };
});

import { loader, action } from "~/routes/api/courses.canvas-materials.$";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { CanvasApiError } from "~/lib/canvas/client.server";
import { InvalidCanvasCourseAccessError } from "~/lib/canvas/courses.server";
import {
  CanvasMaterialSyncError,
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
} from "~/lib/canvas/materials.server";

function makeLoaderArgs(courseId?: string, query = "") {
  return {
    request: new Request(`http://localhost/api/courses/course-1/canvas-materials${query}`),
    params: courseId === undefined ? { courseId: "course-1" } : { courseId },
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "POST", courseId?: string) {
  return {
    request: new Request("http://localhost/api/courses/course-1/canvas-materials", {
      method,
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }),
    params: courseId === undefined ? { courseId: "course-1" } : { courseId },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "instructor-1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(resolveCourseAccessGate).mockResolvedValue({
    course: { id: "course-1" },
    access: { level: "instructor", rank: 2 },
  } as never);
});

describe("GET /api/courses/:courseId/canvas-materials", () => {
  it("returns 400 when courseId is missing", async () => {
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the course does not exist", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({ course: null, access: null });
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(404);
  });

  it("returns 403 for a non-instructor (e.g. a TA)", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "ta", rank: 1 },
    } as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(403);
  });

  it("discovers and returns the file list on success", async () => {
    vi.mocked(discoverCanvasMaterialsForCourse).mockResolvedValue([{ id: "f1" }] as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.files).toEqual([{ id: "f1" }]);
  });

  it("passes recheck=true through to discoverCanvasMaterialsForCourse", async () => {
    vi.mocked(discoverCanvasMaterialsForCourse).mockResolvedValue([]);
    await loader(makeLoaderArgs(undefined, "?recheck=true"));
    expect(discoverCanvasMaterialsForCourse).toHaveBeenCalledWith(
      "instructor-1",
      "course-1",
      undefined,
      { recheckPublishState: true },
    );
  });

  it("maps a CanvasApiError 5xx to 502", async () => {
    vi.mocked(discoverCanvasMaterialsForCourse).mockRejectedValue(new CanvasApiError("down", 503));
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(502);
  });
});

describe("POST /api/courses/:courseId/canvas-materials", () => {
  it("returns 400 when courseId is missing", async () => {
    const res = await action(makeActionArgs({}, "POST", ""));
    expect(res.status).toBe(400);
  });

  it("rejects non-POST methods with 405", async () => {
    const res = await action(makeActionArgs(undefined, "GET"));
    expect(res.status).toBe(405);
  });

  it("returns 403 for a non-instructor before parsing the body", async () => {
    vi.mocked(resolveCourseAccessGate).mockResolvedValue({
      course: { id: "course-1" },
      access: { level: "student", rank: 0 },
    } as never);
    const res = await action(makeActionArgs({ canvasFileIds: ["1"] }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await action({
      request: new Request("http://localhost/api/courses/course-1/canvas-materials", {
        method: "POST",
        body: "not json",
      }),
      params: { courseId: "course-1" },
      context: {} as never,
    } as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a schema-invalid body (empty canvasFileIds)", async () => {
    const res = await action(makeActionArgs({ canvasFileIds: [] }));
    expect(res.status).toBe(400);
  });

  it("syncs the selected files and returns 200 on success", async () => {
    vi.mocked(syncSelectedCanvasMaterials).mockResolvedValue({ synced: 2 } as never);
    const res = await action(makeActionArgs({ canvasFileIds: ["f1", "f2"] }));
    expect(res.status).toBe(200);
    expect(syncSelectedCanvasMaterials).toHaveBeenCalledWith("instructor-1", "course-1", ["f1", "f2"]);
  });

  it("maps a CanvasMaterialSyncError to its statusCode", async () => {
    vi.mocked(syncSelectedCanvasMaterials).mockRejectedValue(
      new CanvasMaterialSyncError("file too large", 413),
    );
    const res = await action(makeActionArgs({ canvasFileIds: ["f1"] }));
    expect(res.status).toBe(413);
  });

  it("maps an InvalidCanvasCourseAccessError to 403 with invalidCourseIds", async () => {
    vi.mocked(syncSelectedCanvasMaterials).mockRejectedValue(
      new InvalidCanvasCourseAccessError(["course-x"]),
    );
    const res = await action(makeActionArgs({ canvasFileIds: ["f1"] }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.invalidCourseIds).toEqual(["course-x"]);
  });

  it("maps an unrecognized error to 500 with its message outside production", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    vi.mocked(syncSelectedCanvasMaterials).mockRejectedValue(new Error("boom"));
    const res = await action(makeActionArgs({ canvasFileIds: ["f1"] }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
    process.env.NODE_ENV = originalEnv;
  });
});
