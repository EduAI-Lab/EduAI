import React from "react";
import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  PageHeading,
} from "@eduai/ui"

import { AppSidebar } from "~/components/app-sidebar";
import { CanvasDashboardCard } from "~/components/canvas/canvas-dashboard-card";
import { DashboardAdminView } from "~/components/dashboard/dashboard-admin-view";
import { DashboardInstructorView } from "~/components/dashboard/dashboard-instructor-view";
import { DashboardStudentView } from "~/components/dashboard/dashboard-student-view";
import { DashboardTaView } from "~/components/dashboard/dashboard-ta-view";
import { DashboardUnitAdminView } from "~/components/dashboard/dashboard-unit-admin-view";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "@eduai/ui";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { usePolicies } from "~/hooks/api/use-policies";
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

  // A TA is a STUDENT-platform user holding an Enrollment(role=TA). Surface that
  // so the dashboard can show the TA experience instead of the student one.
  const isTA =
    session.user.role === "STUDENT" &&
    (await prisma.enrollment.count({
      where: { userId: session.user.id, role: "TA", isActive: true },
    })) > 0;

  return {
    user: session.user,
    isTA,
  };
}

const CANVAS_SYNC_ROLES = new Set(["INSTRUCTOR", "ADMIN"]);

function DashboardHero({ user, isTA }: { user: User; isTA: boolean }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = (user.name ?? "").split(" ");
  const firstName = (name.length == 3 && name[0].endsWith('.') ? name[1] : name[0])
  const heroTitle =
    user.role === "ADMIN" ? "Platform overview" :
    user.role === "UNIT_ADMIN" ? `Welcome back, ${firstName}.` :
    user.role === "INSTRUCTOR" ? `Welcome back, ${firstName}.` :
    `${greeting}, ${firstName}.`;
  const heroSub =
    user.role === "ADMIN" ? "EduAI platform health and usage at a glance." :
    user.role === "UNIT_ADMIN" ? "Your unit courses and administration." :
    user.role === "INSTRUCTOR" ? "Your courses and teaching activity." :
    isTA ? "Your assigned courses and student activity." :
    "Your AI-powered learning companion.";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="px-4 lg:px-6 pt-6 pb-4">
      <PageHeading
        heading={heroTitle}
        subheading={`${dateStr} · ${heroSub}`}
      />
    </div>
  );
}

function DashboardContent({ user, isTA }: { user: User; isTA: boolean }) {
  const { policies } = usePolicies();
  // §807: roles that qualify for Canvas keep the sync card visible but greyed
  // when the policy is off, instead of the card vanishing. ADMIN is unaffected.
  // Mirrors the `instructors.canManageCanvasIntegration` gate on the Canvas API
  // (canvas.$.ts) and the Settings Canvas tab.
  const canvasPolicyOk =
    user.role === "ADMIN" ||
    (policies["instructors.canManageCanvasIntegration"] ?? true);
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
    case "STUDENT":
    default:
      // STUDENT-platform users who hold a TA enrollment get the TA dashboard.
      view = isTA ? <DashboardTaView /> : <DashboardStudentView />;
      break;
  }

  return (
    <>
      <DashboardHero user={user} isTA={isTA} />
      {view}
      {showCanvasSync && (
        <div className="px-4 lg:px-6 pb-6 w-auto">
          <CanvasDashboardCard disabled={!canvasPolicyOk} />
        </div>
      )}
    </>
  );
}

export default function Page() {
  const { user, isTA } = useLoaderData<typeof loader>();

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
                  <BreadcrumbPage>Home</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          }
        />
        <DashboardContent user={user} isTA={isTA} />
      </SidebarInset>
    </SidebarProvider>
  );
}
