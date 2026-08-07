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
import {
  clearRosterSisUserIdStorage,
  prepareRosterSisUserIdStorage,
} from "~/lib/canvas/student-id.server";
import prisma from "~/lib/prisma.server";

type RosterDb = Pick<typeof prisma, "canvasRosterMember">;

type RosterSyncInput = {
  credentials: CanvasIntegrationCredentials;
  coreCourseId: string;
  canvasCourseId: string;
  syncedByUserId: string;
  syncStartedAt: Date;
  fetchImpl?: typeof fetch;
  /** Optional transaction client so callers can hold a course sync lock. */
  db?: RosterDb;
};

function mapCanvasRole(enrollmentType: "student" | "ta"): EnrollmentRole {
  return enrollmentType === "ta" ? EnrollmentRole.TA : EnrollmentRole.STUDENT;
}

function rosterUpsertError(error: unknown, canvasUserId: string): Error {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("sisUserIdLookup") || message.includes("Unknown argument")) {
      return new Error(
        `Roster sync failed for Canvas user ${canvasUserId}: the app database client is out of date. Run npx prisma migrate deploy and npx prisma generate, then restart the dev server.`,
      );
    }
    return new Error(`Roster sync failed for Canvas user ${canvasUserId}: ${message}`);
  }
  return new Error(`Roster sync failed for Canvas user ${canvasUserId}`);
}

async function upsertRosterMembers(
  rows: CanvasCourseUserApi[],
  role: EnrollmentRole,
  input: RosterSyncInput,
  db: RosterDb,
): Promise<number> {
  let synced = 0;

  for (const row of rows) {
    const normalizedSisUserId = normalizeStudentId(row.sis_user_id);
    const sisUserIdStorage = normalizedSisUserId
      ? prepareRosterSisUserIdStorage(normalizedSisUserId)
      : clearRosterSisUserIdStorage();
    const seenAt = new Date();

    try {
      await db.canvasRosterMember.upsert({
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
          ...sisUserIdStorage,
          email: normalizeRosterEmail(row.email),
          displayName: row.name?.trim() || null,
          role,
          syncedByUserId: input.syncedByUserId,
          isActive: true,
          lastSeenAt: seenAt,
        },
        update: {
          ...sisUserIdStorage,
          email: normalizeRosterEmail(row.email),
          displayName: row.name?.trim() || null,
          syncedByUserId: input.syncedByUserId,
          isActive: true,
          lastSeenAt: seenAt,
        },
      });
    } catch (error) {
      throw rosterUpsertError(error, String(row.id));
    }
    synced += 1;
  }

  return synced;
}

/**
 * Fetches Canvas roster and upserts staging rows for students and TAs.
 *
 * CANVAS-01 (#225 / #1195): a *successful* empty roster response must not wipe
 * a previously non-empty staging table (false-empty Canvas responses). When the
 * fetch returns zero members but active staging rows already exist, we throw
 * instead of running the deactivation sweep.
 */
export async function syncCourseRoster(input: RosterSyncInput): Promise<number> {
  const db = input.db ?? prisma;
  const fetchImpl = input.fetchImpl ?? fetch;
  const [students, tas] = await Promise.all([
    listCanvasCourseStudents(input.credentials, input.canvasCourseId, fetchImpl),
    listCanvasCourseTas(input.credentials, input.canvasCourseId, fetchImpl),
  ]);

  const studentCount = await upsertRosterMembers(
    students,
    mapCanvasRole("student"),
    input,
    db,
  );
  const taCount = await upsertRosterMembers(tas, mapCanvasRole("ta"), input, db);
  const syncedCount = studentCount + taCount;

  console.info(
    JSON.stringify({
      event: "canvas_roster_sync",
      courseId: input.coreCourseId,
      canvasCourseId: input.canvasCourseId,
      studentsFetched: students.length,
      tasFetched: tas.length,
      rosterMembersSynced: syncedCount,
      at: new Date().toISOString(),
    }),
  );

  if (syncedCount === 0) {
    const priorActive = await db.canvasRosterMember.count({
      where: { courseId: input.coreCourseId, isActive: true },
    });
    if (priorActive > 0) {
      throw new Error(
        `Canvas returned an empty roster for course ${input.canvasCourseId}, but ${priorActive} active staging members already exist. Refusing to wipe the roster — retry the sync or check Canvas API permissions.`,
      );
    }
    return 0;
  }

  await db.canvasRosterMember.updateMany({
    where: {
      courseId: input.coreCourseId,
      isActive: true,
      lastSeenAt: { lt: input.syncStartedAt },
    },
    data: { isActive: false },
  });

  return syncedCount;
}

/** Deactivates all roster staging rows for a course. */
export async function deactivateCourseRoster(courseId: string): Promise<number> {
  const result = await prisma.canvasRosterMember.updateMany({
    where: { courseId, isActive: true },
    data: { isActive: false },
  });
  return result.count;
}
