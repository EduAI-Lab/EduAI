import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { CanvasDashboardCard } from "~/components/canvas/CanvasDashboardCard";
import { DashboardAdminView } from "~/components/dashboard/dashboard-admin-view";
import { DashboardInstructorView } from "~/components/dashboard/dashboard-instructor-view";
import { DashboardStudentView } from "~/components/dashboard/dashboard-student-view";
import { DashboardTaView } from "~/components/dashboard/dashboard-ta-view";
import { DashboardUnitAdminView } from "~/components/dashboard/dashboard-unit-admin-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { auth } from "~/lib/auth/server";
import type { User } from "~/lib/auth/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  const onboardingRedirect = await redirectToStudentIdOnboardingIfNeeded(
    session.user.id,
    session.user.role,
    request,
  );
  if (onboardingRedirect) {
    return onboardingRedirect;
  }

  return {
    user: session.user,
  };
}

const CANVAS_SYNC_ROLES = new Set(["INSTRUCTOR", "ADMIN"]);

function DashboardContent({ user }: { user: User }) {
  const showCanvasSync = CANVAS_SYNC_ROLES.has(user.role ?? "");

  let view;
  switch (user.role) {
    case "ADMIN":
      view = <DashboardAdminView />;
      break;
    case "UNIT_ADMIN":
      view = <DashboardUnitAdminView />;
      break;
    case "INSTRUCTOR":
      view = <DashboardInstructorView />;
      break;
    case "TA":
      view = <DashboardTaView />;
      break;
    case "STUDENT":
    default:
      view = <DashboardStudentView />;
      break;
  }

  return (
    <>
      {view}
      {showCanvasSync && (
        <div className="px-4 lg:px-6 pb-6">
          <CanvasDashboardCard />
        </div>
      )}
    </>
  );
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
        <SiteHeader title="Dashboard" />
        <DashboardContent user={user} />
      </SidebarInset>
    </SidebarProvider>
  );
}
