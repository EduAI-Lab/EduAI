import { EnrollmentRole } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { CANVAS_EXTERNAL_SOURCE } from "~/lib/canvas/client.server";
import {
  normalizeStudentId,
  prepareStudentIdStorage,
  readStoredStudentId,
  rosterSisUserIdMatchForUser,
  studentIdsMatchFilter,
} from "~/lib/canvas/student-id.server";

export { normalizeStudentId };

export function normalizeRosterEmail(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Links active staging rows to Users with a matching studentId and upserts Enrollments.
 */
export async function linkEnrollmentsFromStagingForCourse(courseId: string): Promise<number> {
  const stagingRows = await prisma.canvasRosterMember.findMany({
    where: {
      courseId,
      isActive: true,
      OR: [{ sisUserIdLookup: { not: null } }, { sisUserId: { not: null } }],
    },
    select: {
      id: true,
      role: true,
      sisUserId: true,
      canvasUserId: true,
    },
  });

  if (stagingRows.length === 0) {
    return 0;
  }

  const sisIds = [
    ...new Set(
      stagingRows
        .map((row) => readStoredStudentId(row.sisUserId))
        .filter((id): id is string => id != null),
    ),
  ];

  const users = await prisma.user.findMany({
    where: studentIdsMatchFilter(sisIds),
    select: { id: true, studentId: true },
  });

  const userByStudentId = new Map(
    users
      .map((user) => [readStoredStudentId(user.studentId), user.id] as const)
      .filter((entry): entry is [string, string] => entry[0] != null),
  );

  let linked = 0;

  for (const row of stagingRows) {
    const sisUserId = readStoredStudentId(row.sisUserId);
    if (!sisUserId) {
      continue;
    }

    const userId = userByStudentId.get(sisUserId);
    if (!userId) {
      continue;
    }

    await prisma.enrollment.upsert({
      where: {
        courseId_userId: { courseId, userId },
      },
      create: {
        courseId,
        userId,
        role: row.role,
        isActive: true,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: row.canvasUserId,
      },
      update: {
        role: row.role,
        isActive: true,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: row.canvasUserId,
      },
    });

    linked += 1;
  }

  return linked;
}

/**
 * Links all active staging rows for a user after studentId is set or updated.
 */
async function ensureUserStudentIdLookup(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studentId: true, studentIdLookup: true },
  });

  if (!user?.studentId || user.studentIdLookup) {
    return user;
  }

  const normalized = readStoredStudentId(user.studentId);
  if (!normalized) {
    return user;
  }

  const prepared = prepareStudentIdStorage(normalized);
  await prisma.user.update({
    where: { id: userId },
    data: prepared,
  });

  return prepared;
}

export async function resolveCanvasEnrollmentsForUser(userId: string): Promise<number> {
  const user = await ensureUserStudentIdLookup(userId);

  if (!user?.studentId && !user?.studentIdLookup) {
    return 0;
  }

  const stagingRows = await prisma.canvasRosterMember.findMany({
    where: {
      isActive: true,
      ...rosterSisUserIdMatchForUser(user),
    },
    select: {
      courseId: true,
      role: true,
      canvasUserId: true,
    },
  });

  let linked = 0;

  for (const row of stagingRows) {
    await prisma.enrollment.upsert({
      where: {
        courseId_userId: { courseId: row.courseId, userId },
      },
      create: {
        courseId: row.courseId,
        userId,
        role: row.role,
        isActive: true,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: row.canvasUserId,
      },
      update: {
        role: row.role,
        isActive: true,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: row.canvasUserId,
      },
    });
    linked += 1;
  }

  return linked;
}

/** Deactivates canvas-sourced enrollments for users no longer on the active roster. */
export async function deactivateDroppedCanvasEnrollments(courseId: string): Promise<number> {
  const activeStaging = await prisma.canvasRosterMember.findMany({
    where: { courseId, isActive: true },
    select: { sisUserId: true, canvasUserId: true },
  });

  const activeStudentIds = new Set(
    activeStaging
      .map((row) => readStoredStudentId(row.sisUserId))
      .filter((id): id is string => id != null),
  );

  const canvasEnrollments = await prisma.enrollment.findMany({
    where: {
      courseId,
      externalSource: CANVAS_EXTERNAL_SOURCE,
      isActive: true,
      role: { in: [EnrollmentRole.STUDENT, EnrollmentRole.TA] },
    },
    include: {
      user: { select: { studentId: true } },
    },
  });

  const toDeactivate = canvasEnrollments.filter((enrollment) => {
    const studentId = readStoredStudentId(enrollment.user.studentId);
    if (!studentId) {
      return false;
    }
    return !activeStudentIds.has(studentId);
  });

  if (toDeactivate.length === 0) {
    return 0;
  }

  await prisma.enrollment.updateMany({
    where: {
      id: { in: toDeactivate.map((enrollment) => enrollment.id) },
    },
    data: { isActive: false },
  });

  return toDeactivate.length;
}
