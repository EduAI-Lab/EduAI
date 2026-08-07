// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  course: { update: vi.fn(), findUnique: vi.fn() },
  courseMaterial: { findMany: vi.fn(), update: vi.fn() },
  enrollment: { createMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  resolveAdminCourseId: vi.fn(),
}));

vi.mock("~/lib/courses/access.server", () => ({
  getCourseIfCanManageMaterials: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourseRagSettings: vi.fn(),
  invalidateCourseRagSettingsCache: vi.fn(),
}));

vi.mock("~/lib/ai/embedding", () => ({
  clearCourseEmbeddingSettingsCache: vi.fn(),
}));

vi.mock("~/lib/ai/re-embed-job.server", () => ({
  findActiveReEmbedJob: vi.fn(),
  getReEmbedJobForCourse: vi.fn(),
  serializeReEmbedJob: vi.fn((job: unknown) => ({ serialized: true, ...(job as object) })),
  startReEmbedJob: vi.fn(),
}));

vi.mock("~/lib/canvas/materials.server", () => ({
  discoverCanvasMaterialsForCourse: vi.fn(),
  syncSelectedCanvasMaterials: vi.fn(),
}));

import { resolveAdminCourseId } from "~/lib/agent-tools/admin-context.server";
import { getCourseIfCanManageMaterials } from "~/lib/courses/access.server";
import { getCourseRagSettings, invalidateCourseRagSettingsCache } from "~/lib/courses/server";
import { clearCourseEmbeddingSettingsCache } from "~/lib/ai/embedding";
import {
  findActiveReEmbedJob,
  getReEmbedJobForCourse,
  startReEmbedJob,
} from "~/lib/ai/re-embed-job.server";
import {
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
} from "~/lib/canvas/materials.server";
import {
  createAdminCourse,
  updateAdminCourse,
  deleteAdminCourse,
  setAdminCoursePublished,
  getAdminCourseRagSettings,
  updateAdminCourseRagSettings,
  listAdminCourseMaterials,
  renameAdminCourseMaterial,
  deleteAdminCourseMaterial,
  getAdminCourseEmbeddingSettings,
  updateAdminCourseEmbeddingSettings,
  startAdminCourseReEmbed,
  getAdminCourseReEmbedJob,
  listAdminCanvasMaterials,
  syncAdminCanvasMaterials,
} from "~/lib/agent-tools/admin-platform.server";

const ADMIN = { id: "a1", role: "ADMIN" };
const STUDENT = { id: "s1", role: "STUDENT" };

const OPTS = { courseId: "c1" };

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResolvedCourseId(courseId = "c1") {
  vi.mocked(resolveAdminCourseId).mockResolvedValue({ courseId, courseCode: "COSC 111" });
}

describe("createAdminCourse", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await createAdminCourse(STUDENT, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    const result = await createAdminCourse(ADMIN, { name: "" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    expect((result as { fields: Record<string, string> }).fields).toBeDefined();
  });

  it("returns INVALID_INSTRUCTOR when instructor lookup count mismatches", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    const result = await createAdminCourse(ADMIN, {
      name: "Intro to CS",
      code: "COSC 111",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: "2026-01-01",
      department: "COSC",
      instructorUserIds: ["u1"],
    });
    expect(result).toEqual({ error: "INVALID_INSTRUCTOR" });
  });

  it("creates a course for admin with valid input", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1" }]);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        course: { create: vi.fn().mockResolvedValue({ id: "c1", name: "Intro to CS" }) },
        enrollment: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return fn(tx);
    });

    const result = await createAdminCourse(ADMIN, {
      name: "Intro to CS",
      code: "COSC 111",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: "2026-01-01",
      department: "COSC",
      instructorUserIds: ["u1"],
    });

    expect(result).toMatchObject({ ok: true, course: { id: "c1", name: "Intro to CS" } });
  });
});

describe("updateAdminCourse", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminCourse(STUDENT, OPTS, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates course-id resolution errors", async () => {
    vi.mocked(resolveAdminCourseId).mockResolvedValue({ error: "COURSE_NOT_FOUND" });
    const result = await updateAdminCourse(ADMIN, OPTS, { name: "New Name" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns VALIDATION_ERROR for invalid input", async () => {
    mockResolvedCourseId();
    const result = await updateAdminCourse(ADMIN, OPTS, { year: "not-a-number" });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("updates the course for admin with valid input", async () => {
    mockResolvedCourseId();
    prismaMock.course.update.mockResolvedValue({ id: "c1", name: "New Name" });
    const result = await updateAdminCourse(ADMIN, OPTS, { name: "New Name" });
    expect(result).toEqual({ ok: true, course: { id: "c1", name: "New Name" } });
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1", deletedAt: null },
      data: { name: "New Name" },
    });
  });
});

describe("deleteAdminCourse", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await deleteAdminCourse(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("soft-deletes the course for admin", async () => {
    mockResolvedCourseId();
    prismaMock.course.update.mockResolvedValue({ id: "c1", deletedAt: new Date() });
    const result = await deleteAdminCourse(ADMIN, OPTS);
    expect(result).toEqual({ ok: true, courseId: "c1" });
  });
});

describe("setAdminCoursePublished", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await setAdminCoursePublished(STUDENT, OPTS, true);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("publishes the course for admin", async () => {
    mockResolvedCourseId();
    prismaMock.course.update.mockResolvedValue({ id: "c1", isPublished: true });
    const result = await setAdminCoursePublished(ADMIN, OPTS, true);
    expect(result).toEqual({ ok: true, course: { id: "c1", isPublished: true } });
  });
});

describe("getAdminCourseRagSettings", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminCourseRagSettings(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns COURSE_NOT_FOUND when settings lookup misses", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseRagSettings).mockResolvedValue(null as never);
    const result = await getAdminCourseRagSettings(ADMIN, OPTS);
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns settings payload for admin", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseRagSettings).mockResolvedValue({ ragTopK: 5 } as never);
    const result = await getAdminCourseRagSettings(ADMIN, OPTS);
    expect(result).toMatchObject({ dataSource: "database", settings: { ragTopK: 5 } });
  });
});

describe("updateAdminCourseRagSettings", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminCourseRagSettings(STUDENT, OPTS, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns VALIDATION_ERROR for out-of-range ragTopK", async () => {
    mockResolvedCourseId();
    const result = await updateAdminCourseRagSettings(ADMIN, OPTS, { ragTopK: 99 });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("updates rag settings and invalidates cache for admin", async () => {
    mockResolvedCourseId();
    prismaMock.course.update.mockResolvedValue({ id: "c1", ragTopK: 10, ragSimilarityThreshold: 0.5 });
    const result = await updateAdminCourseRagSettings(ADMIN, OPTS, { ragTopK: 10 });
    expect(result).toEqual({
      ok: true,
      settings: { id: "c1", ragTopK: 10, ragSimilarityThreshold: 0.5 },
    });
    expect(invalidateCourseRagSettingsCache).toHaveBeenCalledWith("c1");
  });
});

describe("listAdminCourseMaterials", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminCourseMaterials(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns materials list for admin", async () => {
    mockResolvedCourseId();
    prismaMock.courseMaterial.findMany.mockResolvedValue([{ id: "m1", title: "Notes" }]);
    const result = await listAdminCourseMaterials(ADMIN, OPTS);
    expect(result).toMatchObject({
      dataSource: "database",
      count: 1,
      materials: [{ id: "m1", title: "Notes" }],
    });
  });
});

describe("renameAdminCourseMaterial", () => {
  const RENAME_OPTS = { courseId: "c1", materialId: "m1", name: "New Title" };

  it("returns Forbidden for non-admin", async () => {
    const result = await renameAdminCourseMaterial(STUDENT, RENAME_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("renames the material for admin", async () => {
    mockResolvedCourseId();
    prismaMock.courseMaterial.update.mockResolvedValue({ id: "m1", title: "New Title" });
    const result = await renameAdminCourseMaterial(ADMIN, RENAME_OPTS);
    expect(result).toEqual({ ok: true, material: { id: "m1", title: "New Title" } });
    expect(prismaMock.courseMaterial.update).toHaveBeenCalledWith({
      where: { id: "m1", courseId: "c1", deletedAt: null },
      data: { title: "New Title" },
      select: { id: true, title: true },
    });
  });
});

describe("deleteAdminCourseMaterial", () => {
  const DELETE_OPTS = { courseId: "c1", materialId: "m1" };

  it("returns Forbidden for non-admin", async () => {
    const result = await deleteAdminCourseMaterial(STUDENT, DELETE_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("soft-deletes the material for admin", async () => {
    mockResolvedCourseId();
    prismaMock.courseMaterial.update.mockResolvedValue({ id: "m1", deletedAt: new Date() });
    const result = await deleteAdminCourseMaterial(ADMIN, DELETE_OPTS);
    expect(result).toEqual({ ok: true, materialId: "m1" });
  });
});

describe("getAdminCourseEmbeddingSettings", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminCourseEmbeddingSettings(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns COURSE_NOT_FOUND when access is denied", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(null);
    const result = await getAdminCourseEmbeddingSettings(ADMIN, OPTS);
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns settings + effective + needsReEmbed for admin", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({
      embeddingProvider: "local",
      embeddingModel: "mxbai-embed-large",
      embeddedWithProvider: "cloud",
      embeddedWithModel: "text-embedding-3-small",
      lastEmbeddedAt: new Date("2026-01-01"),
    } as never);

    const result = await getAdminCourseEmbeddingSettings(ADMIN, OPTS);
    expect(result).toMatchObject({
      dataSource: "database",
      settings: { embeddingProvider: "local", embeddingModel: "mxbai-embed-large" },
      effective: { provider: "local", model: "mxbai-embed-large" },
      needsReEmbed: true,
    });
  });
});

describe("updateAdminCourseEmbeddingSettings", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await updateAdminCourseEmbeddingSettings(STUDENT, OPTS, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns COURSE_NOT_FOUND when access is denied", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue(null);
    const result = await updateAdminCourseEmbeddingSettings(ADMIN, OPTS, {
      embeddingProvider: "local",
    });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns VALIDATION_ERROR when body has neither field", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    } as never);
    const result = await updateAdminCourseEmbeddingSettings(ADMIN, OPTS, {});
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("returns VALIDATION_ERROR when model isn't allowed for the resolved provider", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    } as never);
    const result = await updateAdminCourseEmbeddingSettings(ADMIN, OPTS, {
      embeddingProvider: "local",
      embeddingModel: "not-a-real-model",
    });
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("updates embedding settings and clears cache for admin", async () => {
    mockResolvedCourseId();
    vi.mocked(getCourseIfCanManageMaterials).mockResolvedValue({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    } as never);
    prismaMock.course.update.mockResolvedValue({ id: "c1" });

    const result = await updateAdminCourseEmbeddingSettings(ADMIN, OPTS, {
      embeddingProvider: "local",
      embeddingModel: "mxbai-embed-large",
    });

    expect(result).toEqual({ ok: true, courseId: "c1" });
    expect(prismaMock.course.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { embeddingProvider: "local", embeddingModel: "mxbai-embed-large" },
    });
    expect(clearCourseEmbeddingSettingsCache).toHaveBeenCalledWith("c1");
  });
});

describe("startAdminCourseReEmbed", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await startAdminCourseReEmbed(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns the active job when one is already running", async () => {
    mockResolvedCourseId();
    vi.mocked(findActiveReEmbedJob).mockResolvedValue({ id: "job1", status: "RUNNING" } as never);
    const result = await startAdminCourseReEmbed(ADMIN, OPTS);
    expect(result).toMatchObject({ alreadyRunning: true, job: { serialized: true, id: "job1" } });
    expect(startReEmbedJob).not.toHaveBeenCalled();
  });

  it("starts a new job when none is active", async () => {
    mockResolvedCourseId();
    vi.mocked(findActiveReEmbedJob).mockResolvedValue(null);
    vi.mocked(startReEmbedJob).mockResolvedValue({ id: "job2", status: "PENDING" } as never);
    const result = await startAdminCourseReEmbed(ADMIN, OPTS);
    expect(result).toMatchObject({ alreadyRunning: false, job: { serialized: true, id: "job2" } });
  });
});

describe("getAdminCourseReEmbedJob", () => {
  const JOB_OPTS = { courseId: "c1", jobId: "job1" };

  it("returns Forbidden for non-admin", async () => {
    const result = await getAdminCourseReEmbedJob(STUDENT, JOB_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns JOB_NOT_FOUND when missing", async () => {
    mockResolvedCourseId();
    vi.mocked(getReEmbedJobForCourse).mockResolvedValue(null);
    const result = await getAdminCourseReEmbedJob(ADMIN, JOB_OPTS);
    expect(result).toEqual({ error: "JOB_NOT_FOUND" });
  });

  it("returns the serialized job for admin", async () => {
    mockResolvedCourseId();
    vi.mocked(getReEmbedJobForCourse).mockResolvedValue({ id: "job1", status: "COMPLETED" } as never);
    const result = await getAdminCourseReEmbedJob(ADMIN, JOB_OPTS);
    expect(result).toMatchObject({ dataSource: "database", job: { serialized: true, id: "job1" } });
  });
});

describe("listAdminCanvasMaterials", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await listAdminCanvasMaterials(STUDENT, OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns discovered canvas materials for admin", async () => {
    mockResolvedCourseId();
    vi.mocked(discoverCanvasMaterialsForCourse).mockResolvedValue([{ canvasFileId: "f1" }] as never);
    const result = await listAdminCanvasMaterials(ADMIN, OPTS);
    expect(result).toMatchObject({ dataSource: "database", count: 1, materials: [{ canvasFileId: "f1" }] });
    expect(discoverCanvasMaterialsForCourse).toHaveBeenCalledWith("a1", "c1");
  });
});

describe("syncAdminCanvasMaterials", () => {
  const SYNC_OPTS = { courseId: "c1", canvasFileIds: ["f1", "f2"] };

  it("returns Forbidden for non-admin", async () => {
    const result = await syncAdminCanvasMaterials(STUDENT, SYNC_OPTS);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns COURSE_INSTRUCTOR_REQUIRED when the course has no instructor", async () => {
    mockResolvedCourseId();
    prismaMock.course.findUnique.mockResolvedValue({ instructorId: null });
    const result = await syncAdminCanvasMaterials(ADMIN, SYNC_OPTS);
    expect(result).toEqual({ error: "COURSE_INSTRUCTOR_REQUIRED" });
    expect(syncSelectedCanvasMaterials).not.toHaveBeenCalled();
  });

  it("syncs selected canvas materials for admin", async () => {
    mockResolvedCourseId();
    prismaMock.course.findUnique.mockResolvedValue({ instructorId: "instr1" });
    vi.mocked(syncSelectedCanvasMaterials).mockResolvedValue({ imported: 2, skipped: 0 } as never);
    const result = await syncAdminCanvasMaterials(ADMIN, SYNC_OPTS);
    expect(result).toEqual({ ok: true, imported: 2, skipped: 0 });
    expect(syncSelectedCanvasMaterials).toHaveBeenCalledWith("instr1", "c1", ["f1", "f2"]);
  });
});
