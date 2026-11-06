import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
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
  PageHeading,
} from "@eduai/ui";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { notFound } from "~/lib/not-found.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getRequestSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    throw notFound(session.user);
  }

  return {
    user: session.user,
  };
}

export default function BugReportsPage() {
  const { user } = useLoaderData<typeof loader>();
  const { reports, total, isLoading, updateReportStatus, loadReportDetail } = useBugReports();
  const truncated = total !== null && total > reports.length;
  // The open report lives in the URL, so it can be linked and survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const openReportId = searchParams.get("report");
  const setOpenReportId = (reportId: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        if (reportId) next.set("report", reportId);
        else next.delete("report");
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Home</Link>
              </BreadcrumbLink>
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
      <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
        <PageHeading
          heading="Bug reports"
          subheading="Triage platform bug reports from every EduAI app."
        />
        <BugReportsAdminView
          hideHeader
          layout="panel"
          openReportId={openReportId}
          onOpenReportChange={setOpenReportId}
          reports={reports}
          isLoading={isLoading}
          onUpdateStatus={updateReportStatus}
          onLoadDetail={loadReportDetail}
          showSourceColumn
          notice={
            truncated ? `Showing the ${reports.length} most recent of ${total} reports.` : undefined
          }
        />
      </div>
    </CoreAppShell>
  );
}

export { RouteErrorState as ErrorBoundary } from "~/components/shared/route-error-state";
