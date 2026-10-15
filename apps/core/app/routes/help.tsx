import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { HelpView } from "~/components/help/help-view";
import { getRequestSession } from "~/lib/auth/request-session.server";
import prisma from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return redirect("/auth/login");
  }
  // TA and course-instructor status live in Enrollment.role, not the platform
  // role, so HelpView needs them to show the course topics those users can act
  // on (#1466 review) and that their HelpHints link to (#1053).
  const courseRoles =
    session.user.role === "STUDENT"
      ? await prisma.enrollment.findMany({
          where: { userId: session.user.id, role: { in: ["TA", "INSTRUCTOR"] }, isActive: true },
          select: { role: true },
          distinct: ["role"],
        })
      : [];
  return {
    user: session.user,
    isTA: courseRoles.some((e) => e.role === "TA"),
    isCourseInstructor: courseRoles.some((e) => e.role === "INSTRUCTOR"),
  };
}

export default function HelpPage() {
  const { user, isTA, isCourseInstructor } = useLoaderData<typeof loader>();

  return (
    <CoreAppShell user={user} title="Help & guide">
      <HelpView role={user.role ?? undefined} isTA={isTA} isCourseInstructor={isCourseInstructor} />
    </CoreAppShell>
  );
}
