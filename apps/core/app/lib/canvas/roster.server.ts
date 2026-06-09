import { EnrollmentRole } from "@prisma/client";
import type { CanvasCourseUserApi, CanvasIntegrationCredentials } from "~/lib/canvas/client.server";
import {
  listCanvasCourseStudents,
  listCanvasCourseTas,
} from "~/lib/canvas/client.server";
import {
  normalizeRosterEmail,
  normalizeStudentId,
} from "~/lib/canvas/enrollment-link.server";
import prisma from "~/lib/prisma.server";

type RosterSyncInput = {
  credentials: CanvasIntegrationCredentials;
  coreCourseId: string;
  canvasCourseId: string;
  syncedByUserId: string;
  syncStartedAt: Date;
  fetchImpl?: typeof fetch;
};

function mapCanvasRole(enrollmentType: "student" | "ta"): EnrollmentRole {
  return enrollmentType === "ta" ? EnrollmentRole.TA : EnrollmentRole.STUDENT;
}

async function upsertRosterMembers(
  rows: CanvasCourseUserApi[],
  role: EnrollmentRole,
  input: RosterSyncInput,
): Promise<number> {
  let synced = 0;

  for (const row of rows) {
    await prisma.canvasRosterMember.upsert({
      where: {
        courseId_canvasUserId_role: {
          courseId: input.coreCourseId,
          canvasUserId: String(row.id),
          role,
        },
      },
      create: {
        courseId: input.coreCourseId,
        canvasUserId: String(row.id),
        sisUserId: normalizeStudentId(row.sis_user_id),
        email: normalizeRosterEmail(row.email),
        displayName: row.name?.trim() || null,
        role,
        syncedByUserId: input.syncedByUserId,
        isActive: true,
        lastSeenAt: input.syncStartedAt,
      },
      update: {
        sisUserId: normalizeStudentId(row.sis_user_id),
        email: normalizeRosterEmail(row.email),
        displayName: row.name?.trim() || null,
        syncedByUserId: input.syncedByUserId,
        isActive: true,
        lastSeenAt: input.syncStartedAt,
      },
    });
    synced += 1;
  }

  return synced;
}

/** Fetches Canvas roster and upserts staging rows for students and TAs. */
export async function syncCourseRoster(input: RosterSyncInput): Promise<number> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const [students, tas] = await Promise.all([
    listCanvasCourseStudents(input.credentials, input.canvasCourseId, fetchImpl),
    listCanvasCourseTas(input.credentials, input.canvasCourseId, fetchImpl),
  ]);

  const studentCount = await upsertRosterMembers(
    students,
    mapCanvasRole("student"),
    input,
  );
  const taCount = await upsertRosterMembers(tas, mapCanvasRole("ta"), input);

  await prisma.canvasRosterMember.updateMany({
    where: {
      courseId: input.coreCourseId,
      isActive: true,
      lastSeenAt: { lt: input.syncStartedAt },
    },
    data: { isActive: false },
  });

  return studentCount + taCount;
}

/** Deactivates all roster staging rows for a course. */
export async function deactivateCourseRoster(courseId: string): Promise<number> {
  const result = await prisma.canvasRosterMember.updateMany({
    where: { courseId, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}
