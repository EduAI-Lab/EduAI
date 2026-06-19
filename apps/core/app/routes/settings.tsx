import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { readStoredStudentId } from "~/lib/canvas/student-id.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { AppSidebar } from "~/components/app-sidebar";
import { SettingsView } from "~/components/settings/settings-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "@eduai/ui";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);
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

  return { user: session.user, studentNumber };
}

export default function SettingsPage() {
  const { user, studentNumber } = useLoaderData<typeof loader>();

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
        <SettingsView role={user.role ?? undefined} studentNumber={studentNumber} />
      </SidebarInset>
    </SidebarProvider>
  );
}
