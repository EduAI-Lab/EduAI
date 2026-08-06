import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findUnique: vi.fn() },
    courseMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    canvasMaterialExclusion: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/canvas/courses.server", () => ({
  requireCanvasCredentials: vi.fn(),
  validateInstructorCanvasCourseIds: vi.fn(),
  CANVAS_EXTERNAL_SOURCE: "canvas",
}));

vi.mock("~/lib/canvas/client.server", () => ({
  CANVAS_EXTERNAL_SOURCE: "canvas",
  listCanvasCourseFiles: vi.fn(),
  downloadCanvasFile: vi.fn(),
  computeCanvasFilePublishState: (
    file: { hidden?: boolean; locked?: boolean; lock_at?: string | null; unlock_at?: string | null },
    now: Date = new Date(),
  ) => {
    if (file.hidden || file.locked) {
      return { isPublished: false };
    }
    if (file.unlock_at && new Date(file.unlock_at) > now) {
      return { isPublished: false };
    }
    if (file.lock_at && new Date(file.lock_at) <= now) {
      return { isPublished: false };
    }
    return { isPublished: true };
  },
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import {
  requireCanvasCredentials,
  validateInstructorCanvasCourseIds,
} from "~/lib/canvas/courses.server";
import { listCanvasCourseFiles, downloadCanvasFile } from "~/lib/canvas/client.server";
import { processUploadedFile } from "~/lib/ai/file-processing";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import {
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
  excludeCanvasMaterial,
  unexcludeCanvasMaterial,
} from "~/lib/canvas/materials.server";

const CREDENTIALS = {
  canvasUrl: "http://localhost:8080",
  apiKey: "test-key",
  isTestMode: true,
};

const CANVAS_FILE = {
  id: 1001,
  display_name: "Lecture 1.txt",
  filename: "lecture1.txt",
  "content-type": "text/plain",
  size: 100,
  updated_at: "2025-01-10T12:00:00.000Z",
  url: "mock://file",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.course.findUnique).mockResolvedValue({
    id: "core-course-1",
    externalId: "1",
    externalSource: "canvas",
  } as never);
  vi.mocked(requireCanvasCredentials).mockResolvedValue(CREDENTIALS);
  vi.mocked(validateInstructorCanvasCourseIds).mockResolvedValue(undefined);
  vi.mocked(listCanvasCourseFiles).mockResolvedValue([CANVAS_FILE]);
  vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
  vi.mocked(downloadCanvasFile).mockResolvedValue(new Uint8Array(Buffer.from("hello")));
  vi.mocked(processUploadedFile).mockResolvedValue({
    title: "Lecture 1.txt",
    mimeType: "text/plain",
    fileSize: 5,
    checksum: "abc123",
    content: "hello",
  });
  vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(prisma.courseMaterial.delete).mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined);
  vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([]);
});

describe("discoverCanvasMaterialsForCourse", () => {
  it("returns importable files with not_imported status", async () => {
    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      canvasFileId: "1001",
      displayName: "Lecture 1.txt",
      importStatus: "not_imported",
      coreMaterialId: null,
    });
  });

  it("excludes soft-deleted materials from the imported lookup", async () => {
    await discoverCanvasMaterialsForCourse("user-1", "core-course-1");
    expect(prisma.courseMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it("marks files already imported", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      {
        id: "mat-existing",
        externalId: "1001",
        updatedAt: new Date("2025-01-11T00:00:00.000Z"),
      },
    ] as never);

    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");
    expect(files[0]?.importStatus).toBe("imported");
    expect(files[0]?.coreMaterialId).toBe("mat-existing");
  });

  it("flags an unpublished Canvas file as not importable", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, hidden: true },
    ]);

    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(files[0]).toMatchObject({ isPublished: false, isExcluded: false });
  });

  it("flags an excluded Canvas file and omits it from import eligibility", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);

    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(files[0]).toMatchObject({ isExcluded: true });
  });

  // #225 CANVAS-11: unsupported mime/extension filtered; extension map rescues mismatched type.
  it("omits files with no extension and no supported content-type", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      {
        ...CANVAS_FILE,
        id: 2001,
        display_name: "binary_blob",
        filename: "binary_blob",
        "content-type": "application/octet-stream",
      },
    ]);

    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(files).toHaveLength(0);
  });

  it("accepts a file whose content-type mismatches but extension maps to an allowed mime", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      {
        ...CANVAS_FILE,
        id: 2002,
        display_name: "slides.pdf",
        filename: "slides.pdf",
        "content-type": "application/octet-stream",
      },
    ]);

    const files = await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      canvasFileId: "2002",
      displayName: "slides.pdf",
      importStatus: "not_imported",
    });
  });

  it("does NOT recheck or write unpublishedAt by default (GET must stay safe/idempotent)", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, hidden: true },
    ]);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      { id: "mat-existing", externalId: "1001", canvasUpdatedAt: new Date("2025-01-11T00:00:00.000Z"), unpublishedAt: null },
    ] as never);

    await discoverCanvasMaterialsForCourse("user-1", "core-course-1");

    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
    expect(prisma.courseMaterial.updateMany).not.toHaveBeenCalled();
  });

  it("sets unpublishedAt on a previously-imported material that becomes unpublished when recheckPublishState is opted into", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, hidden: true },
    ]);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      { id: "mat-existing", externalId: "1001", canvasUpdatedAt: new Date("2025-01-11T00:00:00.000Z"), unpublishedAt: null },
    ] as never);

    await discoverCanvasMaterialsForCourse("user-1", "core-course-1", undefined, {
      recheckPublishState: true,
    });

    expect(prisma.courseMaterial.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["mat-existing"] } },
      data: { unpublishedAt: expect.any(Date) },
    });
  });

  it("clears unpublishedAt on a material that becomes published again when recheckPublishState is opted into", async () => {
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      {
        id: "mat-existing",
        externalId: "1001",
        canvasUpdatedAt: new Date("2025-01-11T00:00:00.000Z"),
        unpublishedAt: new Date("2025-02-01T00:00:00.000Z"),
      },
    ] as never);

    await discoverCanvasMaterialsForCourse("user-1", "core-course-1", undefined, {
      recheckPublishState: true,
    });

    expect(prisma.courseMaterial.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["mat-existing"] } },
      data: { unpublishedAt: null },
    });
  });

  it("batches multiple changed materials into a single updateMany per direction", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, id: 1001, hidden: true },
      { ...CANVAS_FILE, id: 1002, hidden: true },
    ]);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      { id: "mat-1", externalId: "1001", canvasUpdatedAt: new Date(), unpublishedAt: null },
      { id: "mat-2", externalId: "1002", canvasUpdatedAt: new Date(), unpublishedAt: null },
    ] as never);

    await discoverCanvasMaterialsForCourse("user-1", "core-course-1", undefined, {
      recheckPublishState: true,
    });

    expect(prisma.courseMaterial.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.courseMaterial.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["mat-1", "mat-2"] } },
      data: { unpublishedAt: expect.any(Date) },
    });
  });

  // CANVAS-05 (#225 / #1195): files deleted from Canvas are unpublished on recheck.
  it("sets unpublishedAt when a previously-imported file is missing from Canvas", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([]);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      {
        id: "mat-deleted-on-canvas",
        externalId: "1001",
        canvasUpdatedAt: new Date("2025-01-11T00:00:00.000Z"),
        unpublishedAt: null,
      },
    ] as never);

    await discoverCanvasMaterialsForCourse("user-1", "core-course-1", undefined, {
      recheckPublishState: true,
    });

    expect(prisma.courseMaterial.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["mat-deleted-on-canvas"] } },
      data: { unpublishedAt: expect.any(Date) },
    });
  });
});

describe("syncSelectedCanvasMaterials", () => {
  it("imports selected Canvas files", async () => {
    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.imported).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(processUploadedFile).toHaveBeenCalled();
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-1", "hello", { replace: false });
  });

  it("marks PROCESSING before extraction and FAILED when extraction throws (#1018)", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-existing",
      status: "READY",
      canvasUpdatedAt: new Date("2025-01-09T00:00:00.000Z"),
      deletedAt: null,
    } as never);
    vi.mocked(processUploadedFile).mockRejectedValueOnce(new Error("PDF extraction worker was killed"));

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.failed).toEqual([
      expect.objectContaining({ canvasFileId: "1001" }),
    ]);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-existing" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-existing" },
        data: { status: "FAILED" },
      }),
    );
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("skips a soft-deleted material instead of reviving it on re-sync", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-deleted",
      status: "READY",
      canvasUpdatedAt: new Date("2025-01-09T00:00:00.000Z"),
      deletedAt: new Date("2025-01-12T00:00:00.000Z"),
    } as never);

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("reports failure for unknown file ids", async () => {
    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["9999"]);

    expect(result.imported).toBe(0);
    expect(result.failed).toEqual([
      { canvasFileId: "9999", message: "File not found or not importable for this course" },
    ]);
  });

  it("skips and reports an unpublished file without importing it", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, hidden: true },
    ]);

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedItems).toEqual([{ canvasFileId: "1001", reason: "unpublished" }]);
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("skips and reports an excluded file without importing it", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skippedItems).toEqual([{ canvasFileId: "1001", reason: "excluded" }]);
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  // #225 CANVAS-08: oversized files fail before download; checksum collision skips import.
  it("rejects a file over 50 MB before calling downloadCanvasFile", async () => {
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([
      { ...CANVAS_FILE, size: 50 * 1024 * 1024 + 1 },
    ]);

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.imported).toBe(0);
    expect(result.failed).toEqual([
      expect.objectContaining({
        canvasFileId: "1001",
        message: expect.stringMatching(/File too large.*max 50 MB/i),
      }),
    ]);
    expect(downloadCanvasFile).not.toHaveBeenCalled();
    expect(processUploadedFile).not.toHaveBeenCalled();
  });

  it("skips import when another material already owns the same checksum", async () => {
    vi.mocked(processUploadedFile).mockResolvedValue({
      title: "Lecture 1.txt",
      mimeType: "text/plain",
      fileSize: 5,
      checksum: "shared-checksum",
      content: "hello",
    });
    vi.mocked(prisma.courseMaterial.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "mat-other", checksum: "shared-checksum" } as never);

    const result = await syncSelectedCanvasMaterials("user-1", "core-course-1", ["1001"]);

    expect(result.skipped).toBe(1);
    expect(result.skippedItems).toEqual([{ canvasFileId: "1001", reason: "not-modified" }]);
    // Provisional PROCESSING row is created before extraction (#1018), then
    // rolled back when another material already owns the content checksum.
    expect(prisma.courseMaterial.create).toHaveBeenCalled();
    expect(prisma.courseMaterial.delete).toHaveBeenCalledWith({ where: { id: "mat-1" } });
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });
});

describe("excludeCanvasMaterial / unexcludeCanvasMaterial", () => {
  it("upserts an exclusion row scoped to the course", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.upsert).mockResolvedValue({} as never);

    await excludeCanvasMaterial("user-1", "core-course-1", "1001");

    expect(prisma.canvasMaterialExclusion.upsert).toHaveBeenCalledWith({
      where: { courseId_canvasFileId: { courseId: "core-course-1", canvasFileId: "1001" } },
      create: { courseId: "core-course-1", canvasFileId: "1001", excludedByUserId: "user-1" },
      update: {},
    });
  });

  it("is idempotent when excluding an already-excluded file", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.upsert).mockResolvedValue({} as never);

    await expect(
      excludeCanvasMaterial("user-1", "core-course-1", "1001"),
    ).resolves.toBeUndefined();
  });

  it("deletes the exclusion row on unexclude", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.deleteMany).mockResolvedValue({ count: 1 } as never);

    await unexcludeCanvasMaterial("user-1", "core-course-1", "1001");

    expect(prisma.canvasMaterialExclusion.deleteMany).toHaveBeenCalledWith({
      where: { courseId: "core-course-1", canvasFileId: "1001" },
    });
  });

  it("is idempotent when unexcluding an already-unexcluded file", async () => {
    vi.mocked(prisma.canvasMaterialExclusion.deleteMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      unexcludeCanvasMaterial("user-1", "core-course-1", "1001"),
    ).resolves.toBeUndefined();
  });
});
