import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  PageHeading,
} from "@eduai/ui"

import { CoreAppShell } from "~/components/layout/core-app-shell";
import { CanvasDashboardCard } from "~/components/canvas/canvas-dashboard-card";
import {
  DASHBOARD_CONFIG,
  DashboardAdminBody,
  DashboardStandardBody,
  type EffectiveRole,
} from "~/components/dashboard/dashboard-view-config";
import { ProductTour } from "~/components/tour/product-tour";
import { DASHBOARD_TOUR_STEPS, DASHBOARD_TOUR_STORAGE_KEY } from "~/components/tour/tour-steps";
import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { usePolicyGate } from "~/components/policy/policy-gate";
import type { User } from "~/lib/auth/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession({ headers: request.headers });

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

/**
 * `user.role` is `better-auth`'s loosely-typed `string | undefined` — narrow
 * it to a `DASHBOARD_CONFIG` key, falling back to "STUDENT" (its historical
 * default) for anything unrecognized, then swap in "TA" when the enrollment
 * lookup says so.
 */
function resolveEffectiveRole(user: User, isTA: boolean): EffectiveRole {
  if (isTA) return "TA";
  switch (user.role) {
    case "ADMIN":
    case "UNIT_ADMIN":
    case "INSTRUCTOR":
      return user.role;
    default:
      return "STUDENT";
  }
}

function DashboardHero({ user, effectiveRole }: { user: User; effectiveRole: EffectiveRole }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = (user.name ?? "").split(" ");
  const firstName = (name.length == 3 && name[0].endsWith('.') ? name[1] : name[0])
  const { heading, subheading } = DASHBOARD_CONFIG[effectiveRole].heroCopy(firstName, greeting);
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="px-4 lg:px-6 pt-6 pb-4" data-tour="dashboard-hero">
      <PageHeading
        heading={heading}
        subheading={`${dateStr} · ${subheading}`}
      />
    </div>
  );
}

function DashboardContent({ user, isTA }: { user: User; isTA: boolean }) {
  const { isEnabled } = usePolicyGate();
  // §807: roles that qualify for Canvas keep the sync card visible but greyed
  // when the policy is off, instead of the card vanishing. ADMIN is unaffected.
  // Mirrors the `instructors.canManageCanvasIntegration` gate on the Canvas API
  // (canvas.$.ts) and the Settings Canvas tab.
  const canvasPolicyOk =
    user.role === "ADMIN" ||
    isEnabled("instructors.canManageCanvasIntegration");
  const showCanvasSync = CANVAS_SYNC_ROLES.has(user.role ?? "");

  // STUDENT-platform users who hold a TA enrollment get the TA dashboard.
  const effectiveRole = resolveEffectiveRole(user, isTA);

  return (
    <>
      <DashboardHero user={user} effectiveRole={effectiveRole} />
      {effectiveRole === "ADMIN" ? (
        <DashboardAdminBody />
      ) : (
        <DashboardStandardBody effectiveRole={effectiveRole} />
      )}
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
    <CoreAppShell
      user={user}
      breadcrumbs={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Home</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      tour={<ProductTour steps={DASHBOARD_TOUR_STEPS} storageKey={DASHBOARD_TOUR_STORAGE_KEY} />}
    >
      <DashboardContent user={user} isTA={isTA} />
    </CoreAppShell>
  );
}
