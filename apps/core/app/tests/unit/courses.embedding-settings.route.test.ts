// @vitest-environment node
//
// #1269 review: the settings PATCH route's outer catch always returned 500,
// even when the reEmbed=true path throws QueueUnavailableError from
// startReEmbedJob on a DB/queue outage. That must surface as 503.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/courses/access.server", () => ({
  getCourseIfCanManageMaterials: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { course: { update: vi.fn() } },
}));

vi.mock("~/lib/ai/embedding", () => ({
  ALLOWED_CLOUD_EMBEDDING_MODELS: ["gpt-embedding"],
  ALLOWED_LOCAL_EMBEDDING_MODELS: ["local-embedding"],
  clearCourseEmbeddingSettingsCache: vi.fn(),
  isEmbeddingIndexStale: vi.fn(() => false),
  parseEmbeddingSettingsUpdate: vi.fn((body: unknown) => ({ ok: true, value: body })),
  resolveEffectiveEmbeddingSettings: vi.fn((fields: unknown) => fields),
  validateEmbeddingSettingsUpdate: vi.fn((_current: unknown, value: unknown) => ({
    ok: true,
    value,
  })),
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
import prisma from "~/lib/prisma.server";
import { startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { action } from "~/routes/api/courses.embedding-settings.$";

const course = {
  id: "course_1",
  embeddingProvider: "local",
  embeddingModel: "local-embedding",
  embeddedWithProvider: "local",
  embeddedWithModel: "local-embedding",
  lastEmbeddedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(course as never);
  vi.mocked(prisma.course.update).mockResolvedValue(course as never);
});

function patchArgs(body: Record<string, unknown>) {
  return {
    request: new Request("http://localhost/api/courses/course_1/embedding-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { courseId: "course_1" },
    context: {} as never,
  } as never;
}

describe("PATCH /api/courses/:courseId/embedding-settings (#1269)", () => {
  it("returns 503, not 500, when startReEmbedJob throws QueueUnavailableError", async () => {
    vi.mocked(startReEmbedJob).mockRejectedValueOnce(
      new QueueUnavailableError("Queue unavailable"),
    );

    const res = await action(
      patchArgs({ embeddingProvider: "local", embeddingModel: "local-embedding", reEmbed: true }),
    );

    expect(res.status).toBe(503);
  });

  it("still returns 500 for a genuine application error", async () => {
    vi.mocked(startReEmbedJob).mockRejectedValueOnce(new Error("boom"));

    const res = await action(
      patchArgs({ embeddingProvider: "local", embeddingModel: "local-embedding", reEmbed: true }),
    );

    expect(res.status).toBe(500);
  });

  it("returns 200 on a normal save with no re-embed requested", async () => {
    const res = await action(
      patchArgs({ embeddingProvider: "local", embeddingModel: "local-embedding" }),
    );

    expect(res.status).toBe(200);
    expect(startReEmbedJob).not.toHaveBeenCalled();
  });
});
