import { redirect } from "react-router";

import prisma from "~/lib/prisma.server";
import { readStoredStudentId } from "~/lib/canvas/student-id.server";

export const STUDENT_ID_ONBOARDING_ROLES = new Set(["STUDENT", "TA"]);

export async function userNeedsStudentIdOnboarding(
  userId: string,
  role: string | null | undefined,
): Promise<boolean> {
  if (!STUDENT_ID_ONBOARDING_ROLES.has(role ?? "")) {
    return false;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { studentId: true },
  });

  return readStoredStudentId(user?.studentId) == null;
}

/** Redirects students/TAs without a linked student number to onboarding. */
export async function redirectToStudentIdOnboardingIfNeeded(
  userId: string,
  role: string | null | undefined,
  _request: Request,
) {
  if (await userNeedsStudentIdOnboarding(userId, role)) {
    return redirect("/onboarding/student-id");
  }

  return null;
}
