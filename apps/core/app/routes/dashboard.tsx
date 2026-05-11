import { redirect } from "react-router"
import type { LoaderFunctionArgs } from "react-router"
import { useLoaderData } from "react-router"

import { AppSidebar } from "~/components/app-sidebar"
import { SiteHeader } from "~/components/site-header"
import {
  SidebarInset,
  SidebarProvider,
} from "~/components/ui/sidebar"

import { auth } from "~/lib/auth/server"

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request)

  if (!session?.user) {
    return redirect("/auth/login")
  }

  return {
    user: session.user,
  }
}

export default function Page() {
  const { user } = useLoaderData<typeof loader>()

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
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <div className="px-4 lg:px-6">
                <h2 className="text-2xl font-bold">Welcome to EduAI</h2>
                <p className="text-muted-foreground">
                  Your AI-powered learning platform
                </p>
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
