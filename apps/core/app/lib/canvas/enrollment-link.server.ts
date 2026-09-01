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

type EnrollmentLinkDb = {
  canvasRosterMember: typeof prisma.canvasRosterMember;
  user: typeof prisma.user;
  enrollment: typeof prisma.enrollment;
};

export function normalizeRosterEmail(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

type CanvasEnrollmentUpdate = {
  role?: EnrollmentRole;
  isActive?: boolean;
  externalSource?: string;
  externalId?: string;
};

type CanvasEnrollmentTarget = {
  courseId: string;
  userId: string;
  role: EnrollmentRole;
  externalId: string;
};

function enrollmentKey(courseId: string, userId: string): string {
  return `${courseId}|${userId}`;
}

/**
 * Writes every target enrollment in a constant number of queries instead of one
 * upsert per row (#1451): one read of the existing rows, one `createMany` for the
 * new ones, and one `updateMany` per distinct update payload. A re-sync that
 * changes nothing issues no writes at all.
 *
 * Targets are deduped by (courseId, userId) keeping the LAST entry, which is what
 * the per-row upsert loop used to do implicitly — `createMany({ skipDuplicates })`
 * keeps the first, so the dedupe has to be explicit.
 *
 * Atomicity: unlike the per-row upsert, the read and the writes are separate
 * statements, and the two call sites are not equally protected —
 * `linkEnrollmentsFromStagingForCourse` runs under the per-course advisory lock in
 * `syncSingleCanvasCourse`, while `resolveCanvasEnrollmentsForUser` runs unlocked
 * off the student's own link-roster flow. A row created concurrently between our
 * read and our `createMany` would be silently skipped, so the short-create replay
 * below re-applies those values as upserts.
 *
 * A target whose row already matches issues no write at all, so `Enrollment.updatedAt`
 * is no longer refreshed on every sync the way the old unconditional upsert `update`
 * block refreshed it. Nothing reads that field today, but it is no longer usable as a
 * "last verified against Canvas" heartbeat.
 *
 * Returns the number of distinct enrollments the targets resolved to.
 */
async function writeCanvasEnrollments(
  db: EnrollmentLinkDb,
  targets: CanvasEnrollmentTarget[],
): Promise<number> {
  const deduped = new Map<string, CanvasEnrollmentTarget>();
  for (const target of targets) {
    deduped.set(enrollmentKey(target.courseId, target.userId), target);
  }

  if (deduped.size === 0) {
    return 0;
  }

  const wanted = [...deduped.values()];

  // Reading with two `in` filters instead of an OR of pairs keeps this a single
  // indexed lookup. It can match pairs we did not ask for; those are ignored.
  const existing = await db.enrollment.findMany({
    where: {
      courseId: { in: [...new Set(wanted.map((target) => target.courseId))] },
      userId: { in: [...new Set(wanted.map((target) => target.userId))] },
    },
    select: {
      id: true,
      courseId: true,
      userId: true,
      role: true,
      isActive: true,
      externalId: true,
      externalSource: true,
    },
  });

  const existingByKey = new Map(
    existing.map((enrollment) => [
      enrollmentKey(enrollment.courseId, enrollment.userId),
      enrollment,
    ]),
  );

  const toCreate: CanvasEnrollmentTarget[] = [];
  const updateGroups = new Map<string, { data: CanvasEnrollmentUpdate; ids: string[] }>();

  for (const target of wanted) {
    const current = existingByKey.get(enrollmentKey(target.courseId, target.userId));

    if (!current) {
      toCreate.push(target);
      continue;
    }

    // Only the fields that actually drifted go into the payload. Grouping on the
    // whole row would key on `externalId`, which is per-user, so a roster-wide role
    // flip would still cost one query per row. The realistic drift is a role change
    // with the Canvas user id unchanged, and that collapses to a single group.
    const data: CanvasEnrollmentUpdate = {};
    if (current.role !== target.role) {
      data.role = target.role;
    }
    if (!current.isActive) {
      data.isActive = true;
    }
    if (current.externalSource !== CANVAS_EXTERNAL_SOURCE) {
      data.externalSource = CANVAS_EXTERNAL_SOURCE;
    }
    if (current.externalId !== target.externalId) {
      data.externalId = target.externalId;
    }

    const groupKey = JSON.stringify(data);
    if (groupKey === "{}") {
      continue;
    }

    const group = updateGroups.get(groupKey);
    if (group) {
      group.ids.push(current.id);
    } else {
      updateGroups.set(groupKey, { data, ids: [current.id] });
    }
  }

  if (toCreate.length > 0) {
    const created = await db.enrollment.createMany({
      data: toCreate.map((target) => ({
        courseId: target.courseId,
        userId: target.userId,
        role: target.role,
        isActive: true,
        externalSource: CANVAS_EXTERNAL_SOURCE,
        externalId: target.externalId,
      })),
      skipDuplicates: true,
    });

    // A short create means a concurrent writer inserted one of these rows between
    // our read and our write, and `skipDuplicates` dropped our values on the floor.
    // The per-row upsert this replaced could not lose a write that way, so replay
    // the batch as upserts to keep the old guarantee. Only reachable on an actual
    // race, so the steady-state query count is unchanged.
    if (created.count < toCreate.length) {
      for (const target of toCreate) {
        await db.enrollment.upsert({
          where: {
            courseId_userId: { courseId: target.courseId, userId: target.userId },
          },
          create: {
            courseId: target.courseId,
            userId: target.userId,
            role: target.role,
            isActive: true,
            externalSource: CANVAS_EXTERNAL_SOURCE,
            externalId: target.externalId,
          },
          update: {
            role: target.role,
            isActive: true,
            externalSource: CANVAS_EXTERNAL_SOURCE,
            externalId: target.externalId,
          },
        });
      }
    }
  }

  for (const group of updateGroups.values()) {
    await db.enrollment.updateMany({
      where: { id: { in: group.ids } },
      data: group.data,
    });
  }

  return deduped.size;
}

/**
 * Links active staging rows to Users with a matching studentId and upserts Enrollments.
 */
export async function linkEnrollmentsFromStagingForCourse(
  courseId: string,
  db: EnrollmentLinkDb = prisma,
): Promise<number> {
  const stagingRows = await db.canvasRosterMember.findMany({
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

  const users = await db.user.findMany({
    where: studentIdsMatchFilter(sisIds),
    select: { id: true, studentId: true },
  });

  const userByStudentId = new Map(
    users
      .map((user) => [readStoredStudentId(user.studentId), user.id] as const)
      .filter((entry): entry is [string, string] => entry[0] != null),
  );

  const targets: CanvasEnrollmentTarget[] = [];

  for (const row of stagingRows) {
    const sisUserId = readStoredStudentId(row.sisUserId);
    if (!sisUserId) {
      continue;
    }

    const userId = userByStudentId.get(sisUserId);
    if (!userId) {
      continue;
    }

    targets.push({
      courseId,
      userId,
      role: row.role,
      externalId: row.canvasUserId,
    });
  }

  return writeCanvasEnrollments(db, targets);
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

  return writeCanvasEnrollments(
    prisma,
    stagingRows.map((row) => ({
      courseId: row.courseId,
      userId,
      role: row.role,
      externalId: row.canvasUserId,
    })),
  );
}

/** Deactivates canvas-sourced enrollments for users no longer on the active roster. */
export async function deactivateDroppedCanvasEnrollments(
  courseId: string,
  db: EnrollmentLinkDb = prisma,
): Promise<number> {
  const activeStaging = await db.canvasRosterMember.findMany({
    where: { courseId, isActive: true },
    select: { sisUserId: true, canvasUserId: true },
  });

  const activeStudentIds = new Set(
    activeStaging
      .map((row) => readStoredStudentId(row.sisUserId))
      .filter((id): id is string => id != null),
  );

  const canvasEnrollments = await db.enrollment.findMany({
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

  await db.enrollment.updateMany({
    where: {
      id: { in: toDeactivate.map((enrollment) => enrollment.id) },
    },
    data: { isActive: false },
  });

  return toDeactivate.length;
}
