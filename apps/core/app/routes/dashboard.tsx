import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "~/components/ui/breadcrumb"

import { AppSidebar } from "~/components/app-sidebar";
import { DashboardAdminView } from "~/components/dashboard/dashboard-admin-view";
import { DashboardInstructorView } from "~/components/dashboard/dashboard-instructor-view";
import { DashboardStudentView } from "~/components/dashboard/dashboard-student-view";
import { DashboardTaView } from "~/components/dashboard/dashboard-ta-view";
import { DashboardUnitAdminView } from "~/components/dashboard/dashboard-unit-admin-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { auth } from "~/lib/auth/server";
import type { User } from "~/lib/auth/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  return {
    user: session.user,
  };
}

function DashboardContent({ user }: { user: User }) {
  switch (user.role) {
    case "ADMIN":
      return <DashboardAdminView />;
    case "UNIT_ADMIN":
      return <DashboardUnitAdminView />;
    case "INSTRUCTOR":
      return <DashboardInstructorView />;
    case "TA":
      return <DashboardTaView />;
    case "STUDENT":
    default:
      return <DashboardStudentView />;
  }
}

export default function Page() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader
          breadcrumbs={
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Home</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <DashboardContent user={user} />
      </SidebarInset>
    </SidebarProvider>
  );
}
