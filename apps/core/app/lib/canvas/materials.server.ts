import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { processUploadedFile } from "~/lib/ai/file-processing";
import {
  CANVAS_EXTERNAL_SOURCE,
  type CanvasFileApi,
  type CanvasIntegrationCredentials,
  downloadCanvasFile,
  listCanvasCourseFiles,
} from "~/lib/canvas/client.server";
import {
  requireCanvasCredentials,
  validateInstructorCanvasCourseIds,
} from "~/lib/canvas/courses.server";
import type {
  CanvasMaterialDiscoverItem,
  CanvasMaterialImportStatus,
  SyncCanvasMaterialsResult,
} from "@eduai/types";
import prisma from "~/lib/prisma.server";

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const EXTENSION_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export class CanvasMaterialSyncError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "CanvasMaterialSyncError";
    this.statusCode = statusCode;
  }
}

function normalizeMimeType(file: CanvasFileApi): string | null {
  const raw = file["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_MIME_TYPES.has(raw)) {
    return raw;
  }

  const lowerName = (file.filename || file.display_name || "").toLowerCase();
  for (const [ext, mime] of Object.entries(EXTENSION_MIME)) {
    if (lowerName.endsWith(ext)) {
      return mime;
    }
  }

  return null;
}

function dedupeCanvasFiles(files: CanvasFileApi[]): CanvasFileApi[] {
  const byId = new Map<string, CanvasFileApi>();
  for (const file of files) {
    byId.set(String(file.id), file);
  }
  return [...byId.values()];
}

async function listImportableCanvasFiles(
  credentials: CanvasIntegrationCredentials,
  canvasCourseId: string,
  fetchImpl: typeof fetch,
): Promise<CanvasFileApi[]> {
  const courseFiles = await listCanvasCourseFiles(credentials, canvasCourseId, fetchImpl);
  return dedupeCanvasFiles(courseFiles).filter((file) => normalizeMimeType(file) != null);
}

function resolveImportStatus(
  canvasUpdatedAt: Date,
  material: { id: string; canvasUpdatedAt: Date | null } | undefined,
): CanvasMaterialImportStatus {
  if (!material) {
    return "not_imported";
  }
  if (material.canvasUpdatedAt !== null && canvasUpdatedAt > material.canvasUpdatedAt) {
    return "updated_on_canvas";
  }
  return "imported";
}

async function assertCanvasLinkedCourse(courseId: string, userId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, externalId: true, externalSource: true },
  });

  if (!course) {
    throw new CanvasMaterialSyncError("Course not found", 404);
  }

  if (course.externalSource !== CANVAS_EXTERNAL_SOURCE || !course.externalId) {
    throw new CanvasMaterialSyncError("Course is not linked to Canvas", 400);
  }

  await validateInstructorCanvasCourseIds(userId, [course.externalId]);

  return course;
}

/** Lists Canvas files available for import with local import status. */
export async function discoverCanvasMaterialsForCourse(
  userId: string,
  courseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasMaterialDiscoverItem[]> {
  const course = await assertCanvasLinkedCourse(courseId, userId);
  const credentials = await requireCanvasCredentials(userId);

  const canvasFiles = await listImportableCanvasFiles(
    credentials,
    course.externalId!,
    fetchImpl,
  );

  const imported = await prisma.courseMaterial.findMany({
    where: {
      courseId,
      externalSource: CANVAS_EXTERNAL_SOURCE,
      externalId: { not: null },
      // Soft-deleted rows are EduAI-side removals — never resurface them as
      // "imported"; they should read back as available to (re-)import.
      deletedAt: null,
    },
    select: { id: true, externalId: true, canvasUpdatedAt: true },
  });

  const importedByExternalId = new Map(
    imported
      .filter((row) => row.externalId != null)
      .map((row) => [row.externalId as string, row as { id: string; canvasUpdatedAt: Date | null }]),
  );

  return canvasFiles.map((file) => {
    const canvasFileId = String(file.id);
    const mimeType = normalizeMimeType(file)!;
    const material = importedByExternalId.get(canvasFileId);
    const canvasUpdatedAt = new Date(file.updated_at);

    return {
      canvasFileId,
      displayName: file.display_name || file.filename,
      mimeType,
      sizeBytes: file.size,
      canvasUpdatedAt: canvasUpdatedAt.toISOString(),
      importStatus: resolveImportStatus(canvasUpdatedAt, material),
      coreMaterialId: material?.id ?? null,
    };
  });
}

const MAX_CANVAS_FILE_SIZE = 50 * 1024 * 1024; // 50 MB — matches file-processing.ts cap

async function importSingleCanvasFile(
  courseId: string,
  userId: string,
  file: CanvasFileApi,
  credentials: CanvasIntegrationCredentials,
  fetchImpl: typeof fetch,
): Promise<"imported" | "updated" | "skipped"> {
  const mimeType = normalizeMimeType(file);
  if (!mimeType) {
    throw new Error("Unsupported file type");
  }

  if (file.size > MAX_CANVAS_FILE_SIZE) {
    throw new Error(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max ${MAX_CANVAS_FILE_SIZE / 1024 / 1024} MB)`,
    );
  }

  const canvasFileId = String(file.id);
  const existing = await prisma.courseMaterial.findFirst({
    where: {
      courseId,
      externalSource: CANVAS_EXTERNAL_SOURCE,
      externalId: canvasFileId,
    },
    select: { id: true, status: true, canvasUpdatedAt: true, deletedAt: true },
  });

  // Soft-delete is a one-way EduAI-side removal; Canvas re-sync must not revive
  // it. Leave the row deleted and report it as skipped.
  if (existing?.deletedAt) {
    return "skipped";
  }

  const canvasUpdatedAt = new Date(file.updated_at);
  if (
    existing &&
    existing.canvasUpdatedAt !== null &&
    canvasUpdatedAt <= existing.canvasUpdatedAt &&
    existing.status === "READY"
  ) {
    return "skipped";
  }

  const bytes = await downloadCanvasFile(credentials, file, fetchImpl);
  const uploadFile = new File(
    [bytes as Uint8Array<ArrayBuffer>],
    file.filename || file.display_name,
    { type: mimeType },
  );
  const fileInfo = await processUploadedFile(uploadFile);

  const duplicateByChecksum = await prisma.courseMaterial.findFirst({
    where: { courseId, checksum: fileInfo.checksum },
  });

  if (duplicateByChecksum && duplicateByChecksum.id !== existing?.id) {
    return "skipped";
  }

  let materialId: string;

  if (existing) {
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: {
        title: fileInfo.title,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        checksum: fileInfo.checksum,
        rawText: fileInfo.content,
        status: "PROCESSING",
        uploadedBy: userId,
        canvasUpdatedAt,
      },
    });
    materialId = existing.id;
  } else {
    const created = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: fileInfo.title,
        mimeType: fileInfo.mimeType,
        fileSize: fileInfo.fileSize,
        checksum: fileInfo.checksum,
        rawText: fileInfo.content,
        status: "PROCESSING",
        uploadedBy: userId,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: canvasFileId,
        canvasUpdatedAt,
      },
    });
    materialId = created.id;
  }

  try {
    await processMaterialEmbeddings(materialId, fileInfo.content, { replace: Boolean(existing) });
    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: { status: "READY", processedAt: new Date() },
    });
  } catch (error) {
    await prisma.courseMaterial.update({
      where: { id: materialId },
      data: { status: "FAILED" },
    });
    throw error;
  }

  return existing ? "updated" : "imported";
}

/** Imports selected Canvas files into Core course materials. */
export async function syncSelectedCanvasMaterials(
  userId: string,
  courseId: string,
  canvasFileIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<SyncCanvasMaterialsResult> {
  const course = await assertCanvasLinkedCourse(courseId, userId);
  const credentials = await requireCanvasCredentials(userId);

  const available = await listImportableCanvasFiles(
    credentials,
    course.externalId!,
    fetchImpl,
  );
  const availableById = new Map(available.map((file) => [String(file.id), file]));

  const result: SyncCanvasMaterialsResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: [],
  };

  for (const canvasFileId of canvasFileIds) {
    const file = availableById.get(canvasFileId);
    if (!file) {
      result.failed.push({
        canvasFileId,
        message: "File not found or not importable for this course",
      });
      continue;
    }

    try {
      const outcome = await importSingleCanvasFile(
        courseId,
        userId,
        file,
        credentials,
        fetchImpl,
      );
      if (outcome === "imported") result.imported += 1;
      else if (outcome === "updated") result.updated += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed.push({
        canvasFileId,
        message: error instanceof Error ? error.message : "Import failed",
      });
    }
  }

  return result;
}
