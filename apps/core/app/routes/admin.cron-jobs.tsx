import { Link, redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { AppSidebar } from "~/components/app-sidebar";
import { CronJobsAdminView } from "~/components/admin/cron-jobs-admin-view";
import { SiteHeader } from "~/components/site-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SidebarInset,
  SidebarProvider,
} from "@eduai/ui";
import { auth } from "~/lib/auth/server";
import { listCronJobStatuses } from "~/lib/db.cron-jobs.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }
  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  const jobs = await listCronJobStatuses();
  return { user: session.user, jobs };
}

export default function AdminCronJobsRoute() {
  const { user, jobs } = useLoaderData<typeof loader>();

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
        <SiteHeader
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
                  <BreadcrumbPage>Cron Jobs</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <CronJobsAdminView jobs={jobs} />
      </SidebarInset>
    </SidebarProvider>
  );
}
