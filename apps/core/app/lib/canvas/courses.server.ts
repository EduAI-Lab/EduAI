import { EnrollmentRole } from "@prisma/client";
import type { CanvasCourseApi, CanvasIntegrationCredentials } from "~/lib/canvas/client.server";
import {
  CANVAS_EXTERNAL_SOURCE,
  listTeacherCanvasCourses,
} from "~/lib/canvas/client.server";
import { getCanvasIntegrationWithDecryptedKey } from "~/lib/canvas/integration.server";
import type { CanvasCoursePickerItem } from "~/lib/canvas/schemas";
import {
  ubcTermFromDate,
  ubcAcademicYearFromDate,
  inferStartDateFromTermName,
  inferUbcTermStartFromEndDate,
} from "~/lib/canvas/term.server";
import prisma from "~/lib/prisma.server";
import { ensureDefaultBank } from "~/lib/question-banks/server";

export class CanvasNotConnectedError extends Error {
  constructor() {
    super("Connect Canvas first");
    this.name = "CanvasNotConnectedError";
  }
}

export class InvalidCanvasCourseAccessError extends Error {
  readonly invalidCourseIds: string[];

  constructor(invalidCourseIds: string[]) {
    super("One or more courses are not taught by this Canvas account");
    this.name = "InvalidCanvasCourseAccessError";
    this.invalidCourseIds = invalidCourseIds;
  }
}

function parseCanvasIsoDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Course dates from course fields first, then enrollment term start date. */
export function resolveCanvasCourseDates(canvasCourse: CanvasCourseApi): {
  startDate: Date;
  endDate: Date | null;
} {
  const term = canvasCourse.term;
  const termEndDate = parseCanvasIsoDate(term?.end_at);
  const startDate =
    parseCanvasIsoDate(canvasCourse.start_at) ??
    parseCanvasIsoDate(term?.start_at) ??
    inferStartDateFromTermName(term?.name) ??
    (termEndDate ? inferUbcTermStartFromEndDate(termEndDate) : null);

  if (!startDate) {
    throw new Error(
      `Canvas course ${canvasCourse.id} has no start date. Set course or term start dates in Canvas, or give the enrollment term an end date EduAI can infer from.`,
    );
  }

  const endDate =
    parseCanvasIsoDate(canvasCourse.end_at) ?? termEndDate ?? null;

  return { startDate, endDate };
}

export function mapCanvasCourseToCoreFields(canvasCourse: CanvasCourseApi) {
  const { startDate, endDate } = resolveCanvasCourseDates(canvasCourse);
  const term = ubcTermFromDate(startDate);

  return {
    externalId: String(canvasCourse.id),
    externalSource: CANVAS_EXTERNAL_SOURCE,
    name: canvasCourse.name,
    code: canvasCourse.course_code?.trim() || canvasCourse.name,
    section: "001",
    term,
    // Academic-year label, not calendar year — a W2 (Jan–Apr) course
    // attributes to the previous year (#1088; see `ubcAcademicYearFromDate`).
    year: ubcAcademicYearFromDate(startDate, term),
    startDate,
    endDate,
    lastSyncedAt: new Date(),
    deletedAt: null as Date | null,
    isActive: true,
    // Canvas-synced courses are visible to linked students once roster enrollments exist.
    isPublished: true,
  };
}

async function getInstructorSyncedCanvasCourses(userId: string) {
  return prisma.course.findMany({
    where: {
      externalSource: CANVAS_EXTERNAL_SOURCE,
      deletedAt: null,
      enrollments: {
        some: {
          userId,
          role: EnrollmentRole.INSTRUCTOR,
          isActive: true,
        },
      },
    },
    select: {
      id: true,
      externalId: true,
      lastSyncedAt: true,
    },
  });
}

export async function requireCanvasCredentials(userId: string) {
  const integration = await getCanvasIntegrationWithDecryptedKey(userId);
  if (!integration) {
    throw new CanvasNotConnectedError();
  }

  const credentials: CanvasIntegrationCredentials = {
    canvasUrl: integration.canvasUrl,
    apiKey: integration.apiKey,
    isTestMode: integration.isTestMode,
  };

  return credentials;
}

/** Lists Canvas teacher courses with sync state for the instructor picker UI. */
export async function listCanvasCoursesWithSyncState(
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvasCoursePickerItem[]> {
  const credentials = await requireCanvasCredentials(userId);
  const [canvasCourses, syncedCourses] = await Promise.all([
    listTeacherCanvasCourses(credentials, fetchImpl),
    getInstructorSyncedCanvasCourses(userId),
  ]);

  const syncedByExternalId = new Map(
    syncedCourses
      .filter((course) => course.externalId != null)
      .map((course) => [course.externalId as string, course]),
  );

  return canvasCourses.map((course) => {
    const canvasId = String(course.id);
    const synced = syncedByExternalId.get(canvasId);

    return {
      canvasId,
      name: course.name,
      courseCode: course.course_code?.trim() || course.name,
      isSynced: synced != null,
      coreCourseId: synced?.id ?? null,
      lastSyncedAt: synced?.lastSyncedAt?.toISOString() ?? null,
    };
  });
}

/** Upserts a Core course from a Canvas course payload. */
export async function upsertCoreCourseFromCanvas(canvasCourse: CanvasCourseApi) {
  const fields = mapCanvasCourseToCoreFields(canvasCourse);

  const existing = await prisma.course.findFirst({
    where: {
      externalSource: CANVAS_EXTERNAL_SOURCE,
      externalId: fields.externalId,
    },
  });

  if (existing) {
    return prisma.course.update({
      where: { id: existing.id },
      data: {
        name: fields.name,
        code: fields.code,
        section: fields.section,
        term: fields.term,
        year: fields.year,
        startDate: fields.startDate,
        endDate: fields.endDate,
        lastSyncedAt: fields.lastSyncedAt,
        deletedAt: null,
        isActive: true,
        isPublished: true,
      },
    });
  }

  const created = await prisma.course.create({ data: fields });
  await ensureDefaultBank(created.id);
  return created;
}

/** Ensures the syncing instructor has an active INSTRUCTOR enrollment on the course. */
export async function ensureInstructorEnrollment(courseId: string, userId: string) {
  return prisma.enrollment.upsert({
    where: {
      courseId_userId: { courseId, userId },
    },
    create: {
      courseId,
      userId,
      role: EnrollmentRole.INSTRUCTOR,
      isActive: true,
      externalSource: CANVAS_EXTERNAL_SOURCE,
    },
    update: {
      role: EnrollmentRole.INSTRUCTOR,
      isActive: true,
      externalSource: CANVAS_EXTERNAL_SOURCE,
    },
  });
}

/** Ensures every requested Canvas course id appears in the instructor's teacher course list. */
export async function validateInstructorCanvasCourseIds(
  userId: string,
  canvasCourseIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (canvasCourseIds.length === 0) {
    return;
  }

  const credentials = await requireCanvasCredentials(userId);
  const teacherCourses = await listTeacherCanvasCourses(credentials, fetchImpl);
  const allowedIds = new Set(teacherCourses.map((course) => String(course.id)));
  const invalidCourseIds = canvasCourseIds.filter((canvasId) => !allowedIds.has(canvasId));

  if (invalidCourseIds.length > 0) {
    throw new InvalidCanvasCourseAccessError(invalidCourseIds);
  }
}

/** Returns Canvas external IDs currently synced by this instructor. */
export async function getInstructorSyncedCanvasExternalIds(userId: string): Promise<Set<string>> {
  const courses = await getInstructorSyncedCanvasCourses(userId);
  return new Set(
    courses
      .map((course) => course.externalId)
      .filter((externalId): externalId is string => externalId != null),
  );
}
