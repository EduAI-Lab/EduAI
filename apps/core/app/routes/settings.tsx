import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { isPasswordExpired, getPasswordChangedAt } from "~/lib/auth/password-expiry.server";

import { readStoredStudentId } from "~/lib/canvas/student-id.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { AppSidebar } from "~/components/app-sidebar";
import { SettingsView } from "~/components/settings/settings-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "@eduai/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return redirect("/auth/login");
  }

  let studentNumber: string | null = null;
  if (session.user.role === "STUDENT") {
    const row = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { studentId: true },
    });
    studentNumber = readStoredStudentId(row?.studentId);
  }

  const url = new URL(request.url);
  const passwordExpired =
    url.searchParams.get("expired") === "1" ||
    isPasswordExpired(await getPasswordChangedAt(session.user.id));

  return { user: session.user, studentNumber, passwordExpired };
}

export default function SettingsPage() {
  const { user, studentNumber, passwordExpired } = useLoaderData<typeof loader>();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar user={user} />
      <SidebarInset>
        <SiteHeader />
        <SettingsView
          role={user.role ?? undefined}
          studentNumber={studentNumber}
          passwordExpired={passwordExpired}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
