import { redirect } from "react-router"
import type { LoaderFunctionArgs } from "react-router"
import { useLoaderData } from "react-router"

import { AppSidebar } from "~/components/app-sidebar"
import { CanvasDashboardCard } from "~/components/canvas/CanvasDashboardCard"
import { SiteHeader } from "~/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "~/components/ui/sidebar"

import { redirectToStudentIdOnboardingIfNeeded } from "~/lib/canvas/onboarding.server"
import { auth } from "~/lib/auth/server"

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)

  if (!session?.user) {
    return redirect("/auth/login")
  }

  const onboardingRedirect = await redirectToStudentIdOnboardingIfNeeded(
    session.user.id,
    session.user.role,
    request,
  )
  if (onboardingRedirect) {
    return onboardingRedirect
  }

  return {
    user: session.user,
  }
}

const CANVAS_SYNC_ROLES = new Set(["INSTRUCTOR", "ADMIN"])

export default function Page() {
  const { user } = useLoaderData<typeof loader>()
  const showCanvasSync = CANVAS_SYNC_ROLES.has(user.role ?? "")

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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6 space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Welcome to EduAI</h2>
                  <p className="text-muted-foreground">
                    Your AI-powered learning platform
                  </p>
                </div>
                {showCanvasSync && <CanvasDashboardCard />}
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
