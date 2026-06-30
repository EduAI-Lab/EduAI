import { useLocation } from "react-router"
import { useTheme, SiteHeader as SharedSiteHeader, ThemeToggle, BugReportDialog } from "@eduai/ui"
import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog"

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/courses": "Courses",
  "/chat": "Chat",
  "/settings": "Settings",
  "/admin/users": "Users",
  "/admin/ai-models": "AI Models",
  "/admin/bug-reports": "Bug Reports",
  "/admin/chat": "Admin Chatbot",
}

export interface SiteHeaderProps {
  title?: string
  actions?: React.ReactNode
  /** Renders after breadcrumbs on the left (e.g. chat "New chat" on Week 7 #659). */
  leadingActions?: React.ReactNode
  breadcrumbs?: React.ReactNode
}

export function SiteHeader({ title, actions, leadingActions, breadcrumbs }: SiteHeaderProps) {
  const { pathname } = useLocation()
  const resolvedTitle = title
    ?? ROUTE_TITLES[pathname]
    ?? (pathname.startsWith("/courses/") ? "Course Detail" : "EduAI")

  return (
    <SharedSiteHeader
      title={resolvedTitle}
      leadingActions={leadingActions}
      breadcrumbs={breadcrumbs}
      actions={
        <>
          {actions}
          <ThemeToggle />
          <BugReportSubmitDialog />
        </>
      }
    />
  )
}
