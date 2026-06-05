import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { BugReportsAdminView } from "~/components/admin/bug-reports-admin-view";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { useBugReports } from "~/hooks/api/use-bug-reports";
import { auth } from "~/lib/auth/server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  return {
    user: session.user,
  };
}

export default function BugReportsPage() {
  const { user } = useLoaderData<typeof loader>();
  const { reports, isLoading, isStubbed, updateReportStatus } = useBugReports();

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
        <SiteHeader user={user} />
        <BugReportsAdminView
          reports={reports}
          isLoading={isLoading}
          isStubbed={isStubbed}
          onUpdateStatus={updateReportStatus}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}
