import {
  normalizeStudentId,
  normalizeRosterEmail,
  resolveCanvasEnrollmentsForUser,
} from "~/lib/canvas/enrollment-link.server";
import { isValidUbcStudentNumber, UBC_STUDENT_NUMBER_MESSAGE } from "~/lib/canvas/student-number";
import {
  isLegacyPlaintextStudentId,
  prepareStudentIdStorage,
  readStoredStudentId,
  rosterSisUserIdMatchFilter,
  studentIdMatchFilter,
} from "~/lib/canvas/student-id.server";
import { canLinkCanvasRoster, isCanvasLinkRosterRateLimited } from "~/lib/canvas/guards.server";
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

type LinkRosterOptions = {
  requireVerifiedRoster?: boolean;
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
 * Administrative linking path. Self-service callers must use
 * `linkCanvasRosterSelfService`, which requires a verified roster identity.
 */
export async function linkCanvasRoster(
  userId: string,
  studentNumber: string,
  options: LinkRosterOptions = {},
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
    select: { studentId: true, email: true, emailVerified: true },
  });

  if (!user) {
    throw new LinkRosterError("User not found", 404);
  }

  if (options.requireVerifiedRoster) {
    const email = normalizeRosterEmail(user.email);
    if (!user.emailVerified || !email) {
      auditLinkAttempt(userId, "failure", "verified_email_missing");
      throw new LinkRosterError("Verify your account email before linking Canvas", 403);
    }
    const verifiedMatch = await prisma.canvasRosterMember.findFirst({
      where: {
        isActive: true,
        ...rosterSisUserIdMatchFilter(normalized),
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (!verifiedMatch) {
      auditLinkAttempt(userId, "failure", "verified_roster_match_missing");
      throw new LinkRosterError(
        "Student number and verified email do not match an active Canvas roster. Contact your instructor or an administrator.",
        403,
      );
    }
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

  if (currentStudentId !== normalized || isLegacyPlaintextStudentId(user.studentId)) {
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

export async function linkCanvasRosterSelfService(
  userId: string,
  role: string | null | undefined,
  studentNumber: string,
): Promise<LinkRosterResult> {
  if (!canLinkCanvasRoster(role)) {
    throw new LinkRosterError("Forbidden: students and TAs only", 403);
  }
  if (isCanvasLinkRosterRateLimited(userId)) {
    throw new LinkRosterError("Too many link attempts. Please try again later.", 429);
  }
  return linkCanvasRoster(userId, studentNumber, { requireVerifiedRoster: true });
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
