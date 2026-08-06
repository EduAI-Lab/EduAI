// @vitest-environment node
//
// PICT drift-contract adapter for Canvas → Core material import reconciliation
// (census docs/PICT_CENSUS.md § S4, issue #1183). One oracle
// (tests/models/import-reconcile.oracle.ts), one committed row table
// (tests/models/import-reconcile.cases.json), and a per-row world-builder that
// seeds real Postgres state then calls `importSingleCanvasFile` directly.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";
import {
  CANVAS_EXTERNAL_SOURCE,
  type CanvasFileApi,
  downloadCanvasFile,
} from "~/lib/canvas/client.server";
import { requireCanvasCredentials } from "~/lib/canvas/courses.server";
import { importSingleCanvasFile } from "~/lib/canvas/materials.server";
import { processUploadedFile } from "~/lib/ai/file-processing";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import {
  buildUpstreamCanvasFile,
  seedCanvasIntegrationForUser,
  seedCanvasLinkedCourse,
} from "../helpers/canvas-pict";
import importReconcileCases from "../../../../../tests/models/import-reconcile.cases.json";
import {
  expectedSutOutcome,
  importReconcileOracle,
  type ImportReconcileRow,
} from "../../../../../tests/models/import-reconcile.oracle";

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return {
    ...actual,
    downloadCanvasFile: vi.fn(),
  };
});

const rows = importReconcileCases as ImportReconcileRow[];

const TEST_ENCRYPTION_KEY = "import-reconcile-pict-test-key!!";
const STUB_CHECKSUM = "pict-import-reconcile-checksum";
const UPSTREAM_UPDATED_AT = new Date("2025-01-10T12:00:00.000Z");
const STALE_CANVAS_UPDATED_AT = new Date("2025-01-11T00:00:00.000Z");
const DELETED_AT = new Date("2025-01-12T00:00:00.000Z");

type BuiltRow = {
  courseId: string;
  instructorId: string;
  canvasFileId: string;
  existingMaterialId: string | null;
  existingDeletedAt: Date | null;
  existingCanvasUpdatedAt: Date | null;
  file: CanvasFileApi;
  excludedIds: Set<string>;
};

function canvasFileIdForIndex(index: number): string {
  return String(9000 + index);
}

function toCanvasFileApi(
  upstream: ReturnType<typeof buildUpstreamCanvasFile>,
  canvasPublished: ImportReconcileRow["CanvasPublished"],
): CanvasFileApi {
  const id = Number(upstream.canvasFileId);
  return {
    id,
    display_name: upstream.displayName,
    filename: `file-${upstream.canvasFileId}.txt`,
    "content-type": "text/plain",
    size: 128,
    updated_at: upstream.updatedAt.toISOString(),
    url: upstream.url,
    ...(canvasPublished === "no" ? { hidden: true } : {}),
  };
}

async function cleanupCourse(courseId: string, userId: string) {
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
  await prisma.canvasMaterialExclusion.deleteMany({ where: { courseId } });
  await prisma.enrollment.deleteMany({ where: { courseId } });
  await prisma.canvasIntegration.deleteMany({ where: { userId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

/** World-builder: (row) => seeded Postgres state + SUT inputs. */
async function buildRow(row: ImportReconcileRow, index: number): Promise<BuiltRow> {
  const canvasFileId = canvasFileIdForIndex(index);
  const { course, instructor } = await seedCanvasLinkedCourse();
  await seedCanvasIntegrationForUser(instructor.id);

  if (row.Excluded === "yes") {
    await prisma.canvasMaterialExclusion.create({
      data: {
        courseId: course.id,
        canvasFileId,
        excludedByUserId: instructor.id,
      },
    });
  }

  let existingMaterialId: string | null = null;
  let existingDeletedAt: Date | null = null;
  let existingCanvasUpdatedAt: Date | null = null;

  if (row.ExistingPresent === "yes") {
    existingDeletedAt = row.DeletedAt === "yes" ? DELETED_AT : null;
    existingCanvasUpdatedAt =
      row.StaleAndReady === "yes"
        ? STALE_CANVAS_UPDATED_AT
        : new Date("2025-01-09T00:00:00.000Z");

    const existing = await prisma.courseMaterial.create({
      data: {
        courseId: course.id,
        title: `Existing ${canvasFileId}`,
        mimeType: "text/plain",
        fileSize: 5,
        checksum: `existing-${canvasFileId}`,
        rawText: "existing content",
        status: "READY",
        uploadedBy: instructor.id,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: canvasFileId,
        canvasUpdatedAt: existingCanvasUpdatedAt,
        deletedAt: existingDeletedAt,
      },
    });
    existingMaterialId = existing.id;
  }

  if (row.ChecksumDup === "yes") {
    await prisma.courseMaterial.create({
      data: {
        courseId: course.id,
        title: `Checksum dup ${canvasFileId}`,
        mimeType: "text/plain",
        fileSize: 5,
        checksum: STUB_CHECKSUM,
        rawText: "duplicate checksum content",
        status: "READY",
        uploadedBy: instructor.id,
      },
    });
  }

  const upstream = buildUpstreamCanvasFile({
    canvasFileId,
    updatedAt: UPSTREAM_UPDATED_AT,
    published: row.CanvasPublished === "yes",
  });

  return {
    courseId: course.id,
    instructorId: instructor.id,
    canvasFileId,
    existingMaterialId,
    existingDeletedAt,
    existingCanvasUpdatedAt,
    file: toCanvasFileApi(upstream, row.CanvasPublished),
    excludedIds: row.Excluded === "yes" ? new Set([canvasFileId]) : new Set<string>(),
  };
}

beforeAll(() => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(downloadCanvasFile).mockResolvedValue(new Uint8Array(Buffer.from("hello")));
  vi.mocked(processUploadedFile).mockResolvedValue({
    title: "PICT Canvas file.txt",
    mimeType: "text/plain",
    fileSize: 5,
    checksum: STUB_CHECKSUM,
    content: "hello",
  });
});

async function assertPostConditions(
  row: ImportReconcileRow,
  built: BuiltRow,
  outcome: ReturnType<typeof expectedSutOutcome>,
) {
  const verdict = importReconcileOracle(row);

  if (verdict.outcome === "skipped" && verdict.kind === "deleted") {
    expect(built.existingMaterialId).not.toBeNull();
    const material = await prisma.courseMaterial.findUnique({
      where: { id: built.existingMaterialId! },
    });
    expect(material?.deletedAt).not.toBeNull();
    expect(downloadCanvasFile).not.toHaveBeenCalled();
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
    return;
  }

  if (verdict.outcome === "skipped" && verdict.kind === "not-modified-fresh-ready") {
    expect(built.existingMaterialId).not.toBeNull();
    const material = await prisma.courseMaterial.findUnique({
      where: { id: built.existingMaterialId! },
    });
    expect(material?.status).toBe("READY");
    expect(material?.canvasUpdatedAt?.toISOString()).toBe(
      built.existingCanvasUpdatedAt?.toISOString(),
    );
    expect(downloadCanvasFile).not.toHaveBeenCalled();
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
    return;
  }

  if (verdict.outcome === "skipped" && verdict.kind === "checksum-dup") {
    expect(downloadCanvasFile).toHaveBeenCalled();
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();

    if (built.existingMaterialId) {
      const material = await prisma.courseMaterial.findUnique({
        where: { id: built.existingMaterialId },
      });
      expect(material?.status).toBe("READY");
      expect(material?.checksum).toBe(`existing-${built.canvasFileId}`);
      expect(material?.canvasUpdatedAt?.toISOString()).toBe(
        built.existingCanvasUpdatedAt?.toISOString(),
      );
    } else {
      const linked = await prisma.courseMaterial.findFirst({
        where: {
          courseId: built.courseId,
          externalSource: CANVAS_EXTERNAL_SOURCE,
          externalId: built.canvasFileId,
        },
      });
      expect(linked).toBeNull();
    }
    return;
  }

  if (outcome === "imported") {
    const created = await prisma.courseMaterial.findFirst({
      where: {
        courseId: built.courseId,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: built.canvasFileId,
        deletedAt: null,
      },
    });
    expect(created).not.toBeNull();
    expect(created?.status).toBe("READY");
    expect(processMaterialEmbeddings).toHaveBeenCalled();
    return;
  }

  if (outcome === "updated") {
    expect(built.existingMaterialId).not.toBeNull();
    const material = await prisma.courseMaterial.findUnique({
      where: { id: built.existingMaterialId! },
    });
    expect(material?.status).toBe("READY");
    expect(material?.canvasUpdatedAt?.toISOString()).toBe(UPSTREAM_UPDATED_AT.toISOString());
    expect(material?.checksum).toBe(STUB_CHECKSUM);
    expect(processMaterialEmbeddings).toHaveBeenCalledWith(
      built.existingMaterialId,
      "hello",
      { replace: true },
    );
  }
}

describe.each(rows.map((row, index) => ({ row, index })))(
  "import-reconcile PICT row #$index Excluded=$row.Excluded CanvasPublished=$row.CanvasPublished ExistingPresent=$row.ExistingPresent DeletedAt=$row.DeletedAt StaleAndReady=$row.StaleAndReady ChecksumDup=$row.ChecksumDup",
  ({ row, index }) => {
    it("matches the oracle verdict via importSingleCanvasFile", async () => {
      const built = await buildRow(row, index);
      const credentials = await requireCanvasCredentials(built.instructorId);

      const actual = await importSingleCanvasFile(
        built.courseId,
        built.instructorId,
        built.file,
        credentials,
        fetch,
        built.excludedIds,
      );

      expect(actual).toBe(expectedSutOutcome(row));
      await assertPostConditions(row, built, actual);
      await cleanupCourse(built.courseId, built.instructorId);
    });
  },
);
