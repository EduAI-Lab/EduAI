// @vitest-environment node
//
// Route coverage for #1112 acceptance criteria: Redis/DB outages → 503,
// idempotent retry → 200 with same job, no orphan on schedule failure.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/courses/access.server", () => ({
  getCourseIfCanManageMaterials: vi.fn(),
}));

vi.mock("~/lib/ai/re-embed-job.server", () => ({
  startReEmbedJob: vi.fn(),
  serializeReEmbedJob: vi.fn((job: { id: string; courseId: string; status: string }) => ({
    id: job.id,
    courseId: job.courseId,
    status: job.status,
  })),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({})),
  getRequestContext: vi.fn(() => ({})),
}));

import { auth } from "~/lib/auth/server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { action } from "~/routes/api/courses.re-embed.$";

const job = {
  id: "job_1",
  courseId: "course_1",
  idempotencyKey: null,
  status: "RUNNING" as const,
  totalMaterials: 0,
  processedCount: 0,
  failedMaterialIds: [] as string[],
  currentMaterialTitle: null,
  errorMessage: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({ id: "course_1" } as never);
  vi.mocked(startReEmbedJob).mockResolvedValue({ job, created: true, keyHonored: true });
});

function postArgs(opts: {
  courseId?: string;
  idempotencyKey?: string;
  headerKey?: string;
} = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.headerKey) headers["Idempotency-Key"] = opts.headerKey;
  const body =
    opts.idempotencyKey !== undefined
      ? JSON.stringify({ idempotencyKey: opts.idempotencyKey })
      : undefined;
  return {
    request: new Request("http://localhost/api/courses/course_1/re-embed", {
      method: "POST",
      headers,
      body,
    }),
    params: { courseId: opts.courseId ?? "course_1" },
    context: {} as never,
  } as never;
}

describe("POST /api/courses/:courseId/re-embed (#1112)", () => {
  it("returns 202 when a new job is created", async () => {
    const res = await action(postArgs());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.reusedExistingJob).toBe(false);
    expect(body.job.id).toBe("job_1");
  });

  it("returns 200 on idempotent retry with the same job", async () => {
    vi.mocked(startReEmbedJob).mockResolvedValueOnce({ job, created: false, keyHonored: true });
    const res = await action(postArgs({ headerKey: "k1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reusedExistingJob).toBe(true);
    expect(startReEmbedJob).toHaveBeenCalledWith("course_1", { idempotencyKey: "k1" });
  });

  it("returns 503 when Redis/queue is unavailable (no orphan path)", async () => {
    vi.mocked(startReEmbedJob).mockRejectedValueOnce(
      new QueueUnavailableError("Queue unavailable", { cause: new Error("ECONNREFUSED") }),
    );
    const res = await action(postArgs());
    expect(res.status).toBe(503);
  });

  it("returns 503 when DB times out during start", async () => {
    vi.mocked(startReEmbedJob).mockRejectedValueOnce(
      new QueueUnavailableError("Database unavailable while creating re-embed job"),
    );
    const res = await action(postArgs({ headerKey: "k-db" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when anonymous", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null as never);
    const res = await action(postArgs());
    expect(res.status).toBe(401);
  });

  it("returns 404 when course access is denied", async () => {
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValueOnce(null);
    const res = await action(postArgs());
    expect(res.status).toBe(404);
  });
});
