/**
 * @file The one "may this viewer read this material" rule (#1821).
 *
 * The material preview the student UI renders (`GET /api/courses/:id/materials/:id`)
 * and the help assistant's material context both read a material through
 * {@link readMaterialForViewer}, so the assistant can never ground an answer in
 * text the student UI would refuse to show. A second copy of these filters is
 * how the two would drift.
 */
import type { Prisma } from "@prisma/client";

import type { AccessLevel } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";

/** Characters of extracted text the preview shows; the assistant reads the same excerpt. */
export const PREVIEW_EXCERPT_MAX = 4000;

/**
 * Prisma `where` fragment that hides materials students shouldn't see yet:
 * Canvas-unpublished (`unpublishedAt`), selectively excluded Canvas files,
 * explicitly hidden (`visibleToStudents: false`), or scheduled for a future
 * reveal (`availableAt` in the future). Staff callers must NOT apply this.
 *
 * When `excludedCanvasFileIds` is empty the availableAt clause stays a top-level
 * `OR` so scheduling tests remain readable; with exclusions an `AND` wraps both
 * OR groups so Prisma doesn't overwrite one with the other.
 */
export function studentVisibilityWhere(
  now: Date,
  excludedCanvasFileIds: string[] = [],
): Prisma.CourseMaterialWhereInput {
  const availableAtGate = {
    OR: [{ availableAt: null }, { availableAt: { lte: now } }],
  };
  const exclusionGate =
    excludedCanvasFileIds.length > 0
      ? {
          OR: [{ externalId: null }, { externalId: { notIn: excludedCanvasFileIds } }],
        }
      : null;

  return {
    unpublishedAt: null,
    visibleToStudents: true,
    ...(exclusionGate ? { AND: [availableAtGate, exclusionGate] } : availableAtGate),
  };
}

/** The student gate for one course: `{}` for staff, the visibility filter for a student. */
export async function materialGateFor(
  courseId: string,
  access: AccessLevel,
  now: Date = new Date(),
): Promise<Prisma.CourseMaterialWhereInput> {
  if (access.level !== "student") return {};
  const excludedCanvasFileIds = (
    await prisma.canvasMaterialExclusion.findMany({
      where: { courseId },
      select: { canvasFileId: true },
    })
  ).map((row) => row.canvasFileId);
  return studentVisibilityWhere(now, excludedCanvasFileIds);
}

export const VIEWABLE_MATERIAL_SELECT = {
  id: true,
  title: true,
  mimeType: true,
  fileSize: true,
  status: true,
  createdAt: true,
  rawText: true,
} satisfies Prisma.CourseMaterialSelect;

export type ViewableMaterial = Prisma.CourseMaterialGetPayload<{
  select: typeof VIEWABLE_MATERIAL_SELECT;
}>;

export type ReadMaterialResult =
  | { status: "ok"; material: ViewableMaterial }
  /** Exists, but the student gate hides it from this viewer. */
  | { status: "hidden" }
  | { status: "missing" };

/**
 * One material as this viewer may see it. Callers must already have resolved
 * course access (and, for students, the course-publish and policy gates).
 */
export async function readMaterialForViewer(input: {
  courseId: string;
  materialId: string;
  access: AccessLevel;
}): Promise<ReadMaterialResult> {
  const { courseId, materialId, access } = input;
  const studentGate = await materialGateFor(courseId, access);
  const material = await prisma.courseMaterial.findFirst({
    where: { id: materialId, courseId, deletedAt: null, ...studentGate },
    select: VIEWABLE_MATERIAL_SELECT,
  });
  if (material) return { status: "ok", material };

  // A student-gated miss is ambiguous: either the material doesn't exist (or is
  // soft-deleted) or it exists but the gate excluded it. Only students can hit
  // the latter (the gate is `{}` for staff), so one extra query tells them
  // apart and hidden-but-real material can report 403 (#1180).
  if (access.level === "student") {
    const exists = await prisma.courseMaterial.findFirst({
      where: { id: materialId, courseId, deletedAt: null },
      select: { id: true },
    });
    if (exists) return { status: "hidden" };
  }
  return { status: "missing" };
}

/** The preview excerpt the student UI shows, with whether it was cut. */
export type PreviewExcerpt = { excerpt: string; truncated: boolean };

export function previewExcerpt(rawText: string | null): PreviewExcerpt {
  const text = rawText ?? "";
  const truncated = text.length > PREVIEW_EXCERPT_MAX;
  return { excerpt: truncated ? text.slice(0, PREVIEW_EXCERPT_MAX) : text, truncated };
}
