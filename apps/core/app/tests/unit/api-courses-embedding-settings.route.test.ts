// @vitest-environment node
// #1213 — GET/PATCH /api/courses/:courseId/embedding-settings: auth gate,
// manage-access gate, validation, the settings-changed audit guard, and the
// optional reEmbed-after-save branch.
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  ALLOWED_CLOUD_EMBEDDING_MODELS: ["cloud-model"],
  ALLOWED_LOCAL_EMBEDDING_MODELS: ["local-model"],
  clearCourseEmbeddingSettingsCache: vi.fn(),
  isEmbeddingIndexStale: vi.fn().mockReturnValue(false),
  parseEmbeddingSettingsUpdate: vi.fn(),
  resolveEffectiveEmbeddingSettings: vi.fn().mockReturnValue({ provider: "openai", model: "text-embedding-3" }),
  validateEmbeddingSettingsUpdate: vi.fn(),
}));

vi.mock("~/lib/ai/re-embed-job.server", () => ({
  startReEmbedJob: vi.fn(),
  serializeReEmbedJob: vi.fn((job: unknown) => job),
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn((p: Promise<unknown>) => p),
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));

import { loader, action } from "~/routes/api/courses.embedding-settings.$";
import { auth } from "~/lib/auth/server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import prisma from "~/lib/prisma.server";
import {
  parseEmbeddingSettingsUpdate,
  validateEmbeddingSettingsUpdate,
} from "~/lib/ai/embedding";
import { startReEmbedJob } from "~/lib/ai/re-embed-job.server";
import { logAuditAction } from "~/lib/logging.server";

const BASE_COURSE = {
  id: "course-1",
  embeddingProvider: "openai",
  embeddingModel: "text-embedding-3",
  embeddedWithProvider: "openai",
  embeddedWithModel: "text-embedding-3",
  lastEmbeddedAt: null,
};

function makeLoaderArgs(courseId?: string) {
  return {
    request: new Request("http://localhost/api/courses/course-1/embedding-settings"),
    params: courseId === undefined ? { courseId: "course-1" } : { courseId },
    context: {} as never,
  } as never;
}

function makeActionArgs(body: unknown, method = "PATCH") {
  return {
    request: new Request("http://localhost/api/courses/course-1/embedding-settings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { courseId: "course-1" },
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "INSTRUCTOR" },
  } as never);
  vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(BASE_COURSE as never);
});

describe("GET /api/courses/:courseId/embedding-settings", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(401);
  });

  it("returns 400 when courseId is missing", async () => {
    const res = await loader(makeLoaderArgs(""));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller cannot manage the course", async () => {
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(null);
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(404);
  });

  it("returns settings + effective + allow-lists on success", async () => {
    const res = await loader(makeLoaderArgs());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.embeddingProvider).toBe("openai");
    expect(body.allowedLocalModels).toEqual(["local-model"]);
  });
});

describe("PATCH /api/courses/:courseId/embedding-settings", () => {
  it("rejects non-PATCH methods with 405", async () => {
    const res = await action(makeActionArgs({}, "DELETE"));
    expect(res.status).toBe(405);
  });

  it("returns 400 for invalid JSON", async () => {
    const args = {
      request: new Request("http://localhost/api/courses/course-1/embedding-settings", {
        method: "PATCH",
        body: "not json",
      }),
      params: { courseId: "course-1" },
      context: {} as never,
    } as never;
    const res = await action(args);
    expect(res.status).toBe(400);
  });

  it("returns 400 when parseEmbeddingSettingsUpdate rejects the body", async () => {
    vi.mocked(parseEmbeddingSettingsUpdate).mockReturnValue({ ok: false, error: "BAD_SHAPE" } as never);
    const res = await action(makeActionArgs({ embeddingProvider: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when validateEmbeddingSettingsUpdate rejects the transition", async () => {
    vi.mocked(parseEmbeddingSettingsUpdate).mockReturnValue({
      ok: true,
      value: { embeddingProvider: "openai", embeddingModel: "text-embedding-3" },
    } as never);
    vi.mocked(validateEmbeddingSettingsUpdate).mockReturnValue({ ok: false, error: "UNSUPPORTED_MODEL" } as never);
    const res = await action(makeActionArgs({ embeddingProvider: "openai", embeddingModel: "text-embedding-3" }));
    expect(res.status).toBe(400);
  });

  it("updates settings, skips the audit event, and skips re-embed when nothing changed", async () => {
    vi.mocked(parseEmbeddingSettingsUpdate).mockReturnValue({
      ok: true,
      value: { embeddingProvider: "openai", embeddingModel: "text-embedding-3" },
    } as never);
    vi.mocked(validateEmbeddingSettingsUpdate).mockReturnValue({
      ok: true,
      value: { embeddingProvider: "openai", embeddingModel: "text-embedding-3" },
    } as never);
    vi.mocked(prisma.course.update).mockResolvedValue(BASE_COURSE as never);

    const res = await action(makeActionArgs({ embeddingProvider: "openai", embeddingModel: "text-embedding-3" }));
    expect(res.status).toBe(200);
    expect(logAuditAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "EMBEDDING_SETTINGS_CHANGED" }),
    );
    expect(startReEmbedJob).not.toHaveBeenCalled();
  });

  it("logs EMBEDDING_SETTINGS_CHANGED and starts a re-embed job when reEmbed:true", async () => {
    vi.mocked(parseEmbeddingSettingsUpdate).mockReturnValue({
      ok: true,
      value: { embeddingProvider: "ollama", embeddingModel: "mxbai-embed-large" },
    } as never);
    vi.mocked(validateEmbeddingSettingsUpdate).mockReturnValue({
      ok: true,
      value: { embeddingProvider: "ollama", embeddingModel: "mxbai-embed-large" },
    } as never);
    vi.mocked(prisma.course.update).mockResolvedValue({
      ...BASE_COURSE,
      embeddingProvider: "ollama",
      embeddingModel: "mxbai-embed-large",
    } as never);
    vi.mocked(startReEmbedJob).mockResolvedValue({ job: { id: "job-1" }, created: true } as never);

    const res = await action(
      makeActionArgs({ embeddingProvider: "ollama", embeddingModel: "mxbai-embed-large", reEmbed: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reEmbedJob).toEqual({ id: "job-1" });
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "EMBEDDING_SETTINGS_CHANGED" }),
    );
    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionCode: "RE_EMBED_JOB_CREATED" }),
    );
  });
});
