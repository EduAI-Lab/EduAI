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
  // Same enrollment lookup the dashboard uses: TA status lives in
  // Enrollment.role, not the platform role. Needed so HelpView can show
  // the materials topic to TAs who can actually upload (#1466 review).
  const isTA =
    session.user.role === "STUDENT"
      ? (await prisma.enrollment.count({
          where: { userId: session.user.id, role: "TA", isActive: true },
        })) > 0
      : false;
  return { user: session.user, isTA };
}

export default function HelpPage() {
  const { user, isTA } = useLoaderData<typeof loader>();

  return (
    <CoreAppShell user={user} title="Help & guide">
      <HelpView role={user.role ?? undefined} isTA={isTA} />
    </CoreAppShell>
  );
}
