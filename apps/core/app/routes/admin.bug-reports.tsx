import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { useBugReports } from "~/hooks/api/use-bug-reports";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BugReportsAdminView,
} from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

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
  const { reports, total, isLoading, updateReportStatus, loadReportDetail } = useBugReports();
  const truncated = total !== null && total > reports.length;

  return (
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild><Link to="/dashboard">Home</Link></BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Admin</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Bug Reports</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
    >
      <BugReportsAdminView
        reports={reports}
        isLoading={isLoading}
        onUpdateStatus={updateReportStatus}
        onLoadDetail={loadReportDetail}
        showSourceColumn
        description="Triage platform bug reports from every EduAI app."
        notice={
          truncated
            ? `Showing the ${reports.length} most recent of ${total} reports.`
            : undefined
        }
      />
    </CoreAppShell>
  );
}
