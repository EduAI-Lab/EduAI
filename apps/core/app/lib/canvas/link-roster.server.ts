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
  studentIdMatchFilter,
  type StoredStudentId,
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
 * Administrative linking path — an admin vouching for the number, so it is
 * stored already corroborated. Self-service callers must use
 * `linkCanvasRosterSelfService`, which additionally requires a verified account
 * email and stores the number as an uncorroborated claim.
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
    select: { studentId: true, email: true, emailVerified: true, studentIdVerifiedAt: true },
  });

  if (!user) {
    throw new LinkRosterError("User not found", 404);
  }

  // The account's own email must still be verified before a student may claim a
  // number — that is what ties the claim to a real, reachable identity. The
  // roster row that corroborates the claim is NOT required here any more:
  // demanding one up front made registration a dead end for every student whose
  // instructor had not synced their course yet. The claim is instead stored
  // uncorroborated and settled by `resolveCanvasEnrollmentsForUser` (now, if the
  // roster is already there) or by the instructor's next sync (later). Until
  // then it grants no enrollments, so the identity guarantee is unchanged — it
  // moved from "reject the signup" to "withhold the enrollments".
  if (options.requireVerifiedRoster) {
    const email = normalizeRosterEmail(user.email);
    if (!user.emailVerified || !email) {
      auditLinkAttempt(userId, "failure", "verified_email_missing");
      throw new LinkRosterError("Verify your account email before linking Canvas", 403);
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

  const needsStudentIdWrite =
    currentStudentId !== normalized || isLegacyPlaintextStudentId(user.studentId);
  // The administrative path vouches for the number itself, so it lands
  // corroborated and keeps matching roster rows on the number alone — the
  // behaviour admins had before claims existed. Self-service claims stay
  // uncorroborated until a roster row backs them.
  const adminVouches = !options.requireVerifiedRoster;
  const stampsNow = adminVouches && user.studentIdVerifiedAt == null;
  const clearsStamp = !adminVouches && needsStudentIdWrite && user.studentIdVerifiedAt != null;

  if (needsStudentIdWrite || stampsNow || clearsStamp) {
    const data: Partial<StoredStudentId> & { studentIdVerifiedAt?: Date | null } = {};
    if (needsStudentIdWrite) {
      const stored = prepareStudentIdStorage(normalized);
      data.studentId = stored.studentId;
      data.studentIdLookup = stored.studentIdLookup;
    }
    if (stampsNow) {
      data.studentIdVerifiedAt = new Date();
    } else if (clearsStamp) {
      data.studentIdVerifiedAt = null;
    }
    await prisma.user.update({ where: { id: userId }, data });
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
  // The number was just written by an administrator, who is vouching for it —
  // stamp it corroborated so it resolves roster rows on the number alone, the
  // way it did before uncorroborated claims existed. Without this, an admin
  // fixing up a student's number would silently stop linking their courses.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studentIdVerifiedAt: true },
  });
  if (user && user.studentIdVerifiedAt == null) {
    await prisma.user.update({
      where: { id: userId },
      data: { studentIdVerifiedAt: new Date() },
    });
  }
  return resolveCanvasEnrollmentsForUser(userId);
}
