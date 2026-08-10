// @vitest-environment node
// #1213 — POST /api/courses/:courseId/re-embed (start) and
// GET /api/courses/:courseId/re-embed/:jobId (poll): auth + manage-access
// gates, the existing-job reuse dedup, and the job-not-found branch.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/courses/access.server", () => ({
  getCourseIfCanManageMaterials: vi.fn(),
}));

vi.mock("~/lib/ai/re-embed-job.server", () => ({
  findActiveReEmbedJob: vi.fn(),
  startReEmbedJob: vi.fn(),
  serializeReEmbedJob: vi.fn((job: unknown) => job),
  getReEmbedJobForCourse: vi.fn(),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { action as startAction } from "~/routes/api/courses.re-embed.$";
import { loader as pollLoader } from "~/routes/api/courses.re-embed.$jobId";
import { auth } from "~/lib/auth/server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import {
  findActiveReEmbedJob,
  startReEmbedJob,
  getReEmbedJobForCourse,
} from "~/lib/ai/re-embed-job.server";
import { logAuditAction } from "~/lib/logging.server";

function makeStartArgs(method = "POST") {
  return {
    request: new Request("http://localhost/api/courses/course-1/re-embed", { method }),
    params: { courseId: "course-1" },
    context: {} as never,
  } as never;
}

function makePollArgs(courseId?: string, jobId?: string) {
  return {
    request: new Request("http://localhost/api/courses/course-1/re-embed/job-1"),
    params: {
      courseId: courseId === undefined ? "course-1" : courseId,
      jobId: jobId === undefined ? "job-1" : jobId,
    },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({ id: "course-1" } as never);
});

describe("POST /api/courses/:courseId/re-embed", () => {
  it("rejects non-POST methods with 405", async () => {
    const res = await startAction(makeStartArgs("GET"));
    expect(res.status).toBe(405);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await startAction(makeStartArgs());
    expect(res.status).toBe(401);
  });

  it("returns 404 when the caller cannot manage the course", async () => {
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(null);
    const res = await startAction(makeStartArgs());
    expect(res.status).toBe(404);
  });

  it("starts a new job (202) and logs creation when none is active", async () => {
    vi.mocked(findActiveReEmbedJob).mockResolvedValue(null);
    vi.mocked(startReEmbedJob).mockResolvedValue({ id: "job-1" } as never);

    const res = await startAction(makeStartArgs());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, reusedExistingJob: false });
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "RE_EMBED_JOB_CREATED" }),
    );
  });

  it("reuses an active job (200) without re-logging creation", async () => {
    vi.mocked(findActiveReEmbedJob).mockResolvedValue({ id: "job-existing" } as never);

    const res = await startAction(makeStartArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reusedExistingJob: true });
    expect(startReEmbedJob).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("maps an unexpected error to a 500", async () => {
    vi.mocked(findActiveReEmbedJob).mockRejectedValue(new Error("db down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await startAction(makeStartArgs());
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});

describe("GET /api/courses/:courseId/re-embed/:jobId", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await pollLoader(makePollArgs());
    expect(res.status).toBe(401);
  });

  it("returns 400 when courseId or jobId is missing", async () => {
    const res = await pollLoader(makePollArgs("", "job-1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller cannot manage the course", async () => {
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(null);
    const res = await pollLoader(makePollArgs());
    expect(res.status).toBe(404);
  });

  it("returns 404 when the job does not exist", async () => {
    vi.mocked(getReEmbedJobForCourse).mockResolvedValue(null);
    const res = await pollLoader(makePollArgs());
    expect(res.status).toBe(404);
  });

  it("returns the job on success", async () => {
    vi.mocked(getReEmbedJobForCourse).mockResolvedValue({ id: "job-1", status: "RUNNING" } as never);
    const res = await pollLoader(makePollArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job).toEqual({ id: "job-1", status: "RUNNING" });
  });
});
