import { redirect } from "react-router";

import prisma from "~/lib/prisma.server";
import { readStoredStudentId } from "~/lib/canvas/student-id.server";

export const STUDENT_ID_ONBOARDING_ROLES = new Set(["STUDENT", "TA"]);
export const STUDENT_ID_ONBOARDING_SKIP_COOKIE = "eduai_student_id_onboarding_skipped";
const SKIP_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hasSkippedStudentIdOnboarding(request: Request): boolean {
  const cookie = request.headers.get("Cookie") ?? "";
  return cookie.includes(`${STUDENT_ID_ONBOARDING_SKIP_COOKIE}=1`);
}

export function studentIdOnboardingSkipCookieHeader(): string {
  return `${STUDENT_ID_ONBOARDING_SKIP_COOKIE}=1; Path=/; Max-Age=${SKIP_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

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
  request: Request,
) {
  if (hasSkippedStudentIdOnboarding(request)) {
    return null;
  }

  if (await userNeedsStudentIdOnboarding(userId, role)) {
    return redirect("/onboarding/student-id");
  }

  return null;
}
