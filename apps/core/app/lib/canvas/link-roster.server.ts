import {
  normalizeStudentId,
  resolveCanvasEnrollmentsForUser,
} from "~/lib/canvas/enrollment-link.server";
import {
  isValidUbcStudentNumber,
  UBC_STUDENT_NUMBER_MESSAGE,
} from "~/lib/canvas/schemas";
import {
  isLegacyPlaintextStudentId,
  prepareStudentIdStorage,
  readStoredStudentId,
  studentIdMatchFilter,
} from "~/lib/canvas/student-id.server";
import prisma from "~/lib/prisma.server";

export class LinkRosterError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "LinkRosterError";
    this.statusCode = statusCode;
  }
}

export type LinkRosterResult = {
  studentId: string;
  enrollmentsLinked: number;
};

function auditLinkAttempt(userId: string, outcome: "success" | "failure", detail?: string) {
  console.info(
    JSON.stringify({
      event: "canvas_link_roster",
      userId,
      outcome,
      detail,
      at: new Date().toISOString(),
    }),
  );
}

/**
 * Saves the user's studentId unconditionally (staging rows are optional — a
 * student may link before any instructor has synced Canvas) and then resolves
 * whatever staging rows happen to exist at that moment into enrollments. Rows
 * synced later are linked by the sync's own staging→enrollment matching.
 */
export async function linkCanvasRoster(
  userId: string,
  studentNumber: string,
): Promise<LinkRosterResult> {
  const normalized = normalizeStudentId(studentNumber);
  if (!normalized) {
    auditLinkAttempt(userId, "failure", "empty_student_number");
    throw new LinkRosterError("Student number is required", 400);
  }

  if (!isValidUbcStudentNumber(normalized)) {
    auditLinkAttempt(userId, "failure", "invalid_student_number_format");
    throw new LinkRosterError(UBC_STUDENT_NUMBER_MESSAGE, 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studentId: true },
  });

  if (!user) {
    throw new LinkRosterError("User not found", 404);
  }

  const currentStudentId = readStoredStudentId(user.studentId);

  const takenByOther = await prisma.user.findFirst({
    where: {
      ...studentIdMatchFilter(normalized),
      id: { not: userId },
    },
    select: { id: true },
  });

  if (takenByOther) {
    auditLinkAttempt(userId, "failure", "student_id_taken");
    throw new LinkRosterError(
      "This student number is already linked to another account. Contact an admin if you believe this is an error.",
      409,
    );
  }

  // We intentionally do NOT require a matching staging row here. A student may
  // link their number before any instructor has synced Canvas; the number is
  // saved now and the later sync's linkEnrollmentsFromStagingForCourse matches
  // them by studentId and enrolls them. See issue #725.

  if (
    currentStudentId &&
    currentStudentId !== normalized &&
    !isLegacyPlaintextStudentId(user.studentId)
  ) {
    auditLinkAttempt(userId, "failure", "student_id_reassign_blocked");
    throw new LinkRosterError(
      "Student number cannot be changed after linking. Contact an administrator.",
      409,
    );
  }

  if (
    currentStudentId !== normalized ||
    isLegacyPlaintextStudentId(user.studentId)
  ) {
    await prisma.user.update({
      where: { id: userId },
      data: prepareStudentIdStorage(normalized),
    });
  }

  const enrollmentsLinked = await resolveCanvasEnrollmentsForUser(userId);

  auditLinkAttempt(userId, "success", `linked_${enrollmentsLinked}`);

  return {
    studentId: normalized,
    enrollmentsLinked,
  };
}

/** Admin or profile flows that set studentId directly should call this after update. */
export async function applyStudentIdAndResolveEnrollments(
  userId: string,
  studentId: string | null | undefined,
): Promise<number> {
  const normalized = normalizeStudentId(studentId);
  if (!normalized) {
    return 0;
  }
  if (!isValidUbcStudentNumber(normalized)) {
    throw new LinkRosterError(UBC_STUDENT_NUMBER_MESSAGE, 400);
  }
  return resolveCanvasEnrollmentsForUser(userId);
}
