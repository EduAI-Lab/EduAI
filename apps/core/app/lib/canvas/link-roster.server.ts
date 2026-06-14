import prisma from "~/lib/prisma.server";
import {
  normalizeStudentId,
  resolveCanvasEnrollmentsForUser,
} from "~/lib/canvas/enrollment-link.server";
import {
  isLegacyPlaintextStudentId,
  prepareStudentIdStorage,
  readStoredStudentId,
  studentIdMatchFilter,
} from "~/lib/canvas/student-id.server";

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
 * Sets the user's studentId and links active Canvas staging rows to enrollments.
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
      "This student number is already linked to another account.",
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
  return resolveCanvasEnrollmentsForUser(userId);
}
