import { useLocation } from "react-router"
import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog";
import { Separator } from "~/components/ui/separator"
import { SidebarTrigger } from "~/components/ui/sidebar"

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/courses": "Courses",
  "/chat": "Chat",
  "/settings": "Settings",
  "/admin/users": "Users",
  "/admin/ai-models": "AI Models",
  "/admin/bug-reports": "Bug Reports",
}

export interface SiteHeaderProps {
  title?: string
  actions?: React.ReactNode
  breadcrumbs?: React.ReactNode
}

export function SiteHeader({ title, actions, breadcrumbs }: SiteHeaderProps) {
  const { pathname } = useLocation()
  const resolvedTitle = title
    ?? ROUTE_TITLES[pathname]
    ?? (pathname.startsWith("/courses/") ? "Course Detail" : "EduAI")
  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center border-b">
      <div className="flex h-full w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        {breadcrumbs ?? <h1 className="text-base font-medium">{resolvedTitle}</h1>}
        <div className="ml-auto flex h-full items-center gap-3 sm:gap-4">
          {actions}
          <BugReportSubmitDialog />
        </div>
      </div>
    </header>
  );
}
