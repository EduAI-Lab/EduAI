import { EnrollmentRole } from "@prisma/client";
import type { CanvasCourseApi } from "~/lib/canvas/client.server";
import {
  CANVAS_EXTERNAL_SOURCE,
  getCanvasCourseWithTerm,
} from "~/lib/canvas/client.server";
import {
  ensureInstructorEnrollment,
  getInstructorSyncedCanvasExternalIds,
  requireCanvasCredentials,
  upsertCoreCourseFromCanvas,
} from "~/lib/canvas/courses.server";
import {
  deactivateDroppedCanvasEnrollments,
  linkEnrollmentsFromStagingForCourse,
} from "~/lib/canvas/enrollment-link.server";
import {
  deactivateCourseRoster,
  syncCourseRoster,
} from "~/lib/canvas/roster.server";
import type {
  SyncCanvasCourseResult,
  SyncCanvasCoursesResult,
  UnsyncCanvasCourseResult,
} from "~/lib/canvas/schemas";
import prisma from "~/lib/prisma.server";

async function findCanvasCourseByExternalId(
  canvasCourseId: string,
  fetchImpl: typeof fetch,
  userId: string,
): Promise<CanvasCourseApi | null> {
  const credentials = await requireCanvasCredentials(userId);
  return getCanvasCourseWithTerm(credentials, canvasCourseId, fetchImpl);
}

async function syncSingleCanvasCourse(
  userId: string,
  canvasCourseId: string,
  fetchImpl: typeof fetch,
): Promise<Omit<SyncCanvasCourseResult, 'canvasId'>> {
  const credentials = await requireCanvasCredentials(userId);
  const canvasCourse = await findCanvasCourseByExternalId(canvasCourseId, fetchImpl, userId);

  if (!canvasCourse) {
    throw new Error(`Canvas course ${canvasCourseId} not found or not taught by this account`);
  }

  const syncStartedAt = new Date();
  const coreCourse = await upsertCoreCourseFromCanvas(canvasCourse);
  await ensureInstructorEnrollment(coreCourse.id, userId);

  const rosterMembersSynced = await syncCourseRoster({
    credentials,
    coreCourseId: coreCourse.id,
    canvasCourseId,
    syncedByUserId: userId,
    syncStartedAt,
    fetchImpl,
  });

  const enrollmentsLinked = await linkEnrollmentsFromStagingForCourse(coreCourse.id);
  await deactivateDroppedCanvasEnrollments(coreCourse.id);

  return {
    coreCourseId: coreCourse.id,
    rosterMembersSynced,
    enrollmentsLinked,
  };
}

async function unsyncSingleCanvasCourse(
  userId: string,
  canvasCourseId: string,
): Promise<Omit<UnsyncCanvasCourseResult, 'canvasId'>> {
  const course = await prisma.course.findFirst({
    where: {
      externalSource: CANVAS_EXTERNAL_SOURCE,
      externalId: canvasCourseId,
      deletedAt: null,
      enrollments: {
        some: {
          userId,
          role: EnrollmentRole.INSTRUCTOR,
          isActive: true,
        },
      },
    },
    select: { id: true },
  });

  if (!course) {
    throw new Error(`Synced course ${canvasCourseId} not found for this instructor`);
  }

  await prisma.enrollment.updateMany({
    where: {
      courseId: course.id,
      userId,
      role: EnrollmentRole.INSTRUCTOR,
    },
    data: { isActive: false },
  });

  await prisma.enrollment.updateMany({
    where: {
      courseId: course.id,
      externalSource: CANVAS_EXTERNAL_SOURCE,
      role: { in: [EnrollmentRole.STUDENT, EnrollmentRole.TA] },
      isActive: true,
    },
    data: { isActive: false },
  });

  await deactivateCourseRoster(course.id);

  const otherActiveInstructors = await prisma.enrollment.count({
    where: {
      courseId: course.id,
      role: EnrollmentRole.INSTRUCTOR,
      isActive: true,
      userId: { not: userId },
    },
  });

  if (otherActiveInstructors === 0) {
    await prisma.course.update({
      where: { id: course.id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  return { coreCourseId: course.id };
}

/**
 * Pure delta between currently synced Canvas ids and the instructor's new selection.
 *
 * `liveCanvasIds` restricts unsyncing to courses still visible in the instructor's live
 * Canvas course list. A synced course that has dropped out of that list (term ended, access
 * revoked, etc.) is left untouched rather than unsynced, since the instructor never had a
 * chance to see it in the picker and choose to omit it.
 */
export function computeCanvasSyncDelta(
  currentlySynced: Iterable<string>,
  canvasCourseIds: string[],
  liveCanvasIds: Iterable<string>,
): { toSync: string[]; toUnsync: string[] } {
  const syncedSet = new Set(currentlySynced);
  const requested = new Set(canvasCourseIds);
  const liveSet = new Set(liveCanvasIds);

  return {
    toSync: canvasCourseIds,
    toUnsync: [...syncedSet].filter(
      (canvasId) => !requested.has(canvasId) && liveSet.has(canvasId),
    ),
  };
}

/**
 * Syncs checked Canvas courses and unsyncs any the instructor previously synced but omitted,
 * excluding courses that have dropped out of the instructor's live Canvas course list.
 */
export async function syncCanvasCourses(
  userId: string,
  canvasCourseIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<SyncCanvasCoursesResult> {
  const credentials = await requireCanvasCredentials(userId);
  const [currentlySynced, liveCourses] = await Promise.all([
    getInstructorSyncedCanvasExternalIds(userId),
    listTeacherCanvasCourses(credentials, fetchImpl),
  ]);
  const liveCanvasIds = liveCourses.map((course) => String(course.id));
  const { toSync, toUnsync } = computeCanvasSyncDelta(currentlySynced, canvasCourseIds, liveCanvasIds);

  const result: SyncCanvasCoursesResult = {
    synced: [],
    unsynced: [],
    errors: [],
  };

  for (const canvasId of toSync) {
    try {
      const syncResult = await syncSingleCanvasCourse(userId, canvasId, fetchImpl);
      result.synced.push({
        canvasId,
        coreCourseId: syncResult.coreCourseId,
        rosterMembersSynced: syncResult.rosterMembersSynced,
        enrollmentsLinked: syncResult.enrollmentsLinked,
      });
    } catch (error) {
      result.errors.push({
        canvasId,
        message: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  for (const canvasId of toUnsync) {
    try {
      const unsyncResult = await unsyncSingleCanvasCourse(userId, canvasId);
      result.unsynced.push({
        canvasId,
        coreCourseId: unsyncResult.coreCourseId,
      });
    } catch (error) {
      result.errors.push({
        canvasId,
        message: error instanceof Error ? error.message : "Unsync failed",
      });
    }
  }

  return result;
}
