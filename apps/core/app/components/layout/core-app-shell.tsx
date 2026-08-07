import * as React from "react"
import { useLocation } from "react-router"

import { AppShell, CommandSearchButton, ThemeToggle, type AppSidebarProps } from "@eduai/ui"

import { useCoreSidebarProps, type UseCoreSidebarPropsOptions } from "~/components/app-sidebar"
import { AIServiceIndicators } from "~/components/ai/ai-service-indicators"
import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog"
import { CommandPalette, CORE_COMMAND_EVENT } from "~/components/command/command-palette"
import type { User } from "~/lib/auth/types"

/**
 * Route → header title fallback map, ported verbatim from the old bespoke
 * `~/components/site-header`'s `resolvedTitle` logic (issue #764 core-shell
 * parity). `CoreAppShell` always resolves a title through this before handing
 * it to the shared `AppShell`, so every route's visible/sr-only heading is
 * byte-for-byte unchanged from before the AppShell migration — routes that
 * used to rely on the fallback (e.g. `/settings` rendering a bare
 * `<SiteHeader />`) don't need to start passing an explicit `title`.
 */
const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/courses": "Courses",
  "/chat": "Course Chat",
  "/settings": "Settings",
  "/admin/users": "Users",
  "/admin/ai-models": "AI Models",
  "/admin/bug-reports": "Bug Reports",
  "/admin/chat": "Admin Chatbot",
}

/** Exported for unit tests — see `ROUTE_TITLES` doc comment above. */
export function resolveCoreHeaderTitle(pathname: string, title?: string): string {
  return (
    title ??
    ROUTE_TITLES[pathname] ??
    (pathname.startsWith("/courses/") ? "Course Detail" : "EduAI")
  )
}

/**
 * The header's fixed right-hand action bundle, identical across every Core
 * page: quick search, live AI-service status, theme toggle, and the bug
 * report trigger. `extraActions` renders BEFORE this bundle, for the rare
 * route that needs its own control there too (e.g. the chat page's mobile
 * history toggle) — mirrors the old bespoke SiteHeader's
 * `{actions}{CommandSearchButton}{AIServiceIndicators}{themeToggle}{BugReportSubmitDialog}`
 * order exactly.
 */
export function CoreHeaderActions({ extraActions }: { extraActions?: React.ReactNode }) {
  return (
    <>
      {extraActions}
      <CommandSearchButton eventName={CORE_COMMAND_EVENT} />
      <AIServiceIndicators />
      {/* Wrapper carries the dashboard tour's anchor — ThemeToggle itself only
          accepts `className`, so this follows the same pattern as
          AIServiceIndicators' own `data-tour` wrapper span. */}
      <span data-tour="theme-toggle" className="inline-flex">
        <ThemeToggle />
      </span>
      <BugReportSubmitDialog />
    </>
  )
}

export interface CoreAppShellProps {
  user: User
  /** Explicit header title override. Omit to use the route-derived fallback (see `ROUTE_TITLES`). */
  title?: string
  /** Breadcrumb trail rendered in place of the plain title — passed straight through from the route. */
  breadcrumbs?: React.ReactNode
  /** Route-specific header control(s) rendered before the common action bundle (e.g. chat's history toggle). */
  actions?: React.ReactNode
  /** Route-specific floating content mounted alongside the command palette (e.g. dashboard's ProductTour). */
  tour?: React.ReactNode
  /** Sidebar variant override — e.g. `"inset"` for the unit-chats and admin-chat pages. */
  sidebarVariant?: AppSidebarProps["variant"]
  /** Sidebar nav overrides, forwarded to `useCoreSidebarProps`. Unused by any route today; kept for parity with the old `AppSidebar` component's flexibility. */
  sidebarProps?: Omit<UseCoreSidebarPropsOptions, "user" | "variant">
  /**
   * Escape hatches for pages with non-standard scroll containment — currently
   * only the chat screen, which owns an internally-scrolling layout instead of
   * the standard page-scrolls `<main>`. See `AppShellProps` for details.
   */
  insetClassName?: string
  mainClassName?: string
  providerClassName?: string
  children: React.ReactNode
}

/**
 * Core's composition of the shared `@eduai/ui` `AppShell` (issue #764 core
 * parity) — the single place that assembles Core's sidebar (RBAC nav, logout),
 * header (search, AI status, theme, bug report), command palette, and
 * per-route breadcrumbs/tour, instead of every route hand-assembling
 * `SidebarProvider > AppSidebar + SidebarInset > SiteHeader`.
 */
export function CoreAppShell({
  user,
  title,
  breadcrumbs,
  actions,
  tour,
  sidebarVariant,
  sidebarProps,
  insetClassName,
  mainClassName,
  providerClassName,
  children,
}: CoreAppShellProps) {
  const { pathname } = useLocation()
  const sidebar = useCoreSidebarProps({
    user,
    variant: sidebarVariant,
    ...sidebarProps,
  })
  const resolvedTitle = resolveCoreHeaderTitle(pathname, title)

  return (
    <AppShell
      sidebar={sidebar}
      title={resolvedTitle}
      breadcrumbs={breadcrumbs}
      headerActions={<CoreHeaderActions extraActions={actions} />}
      commandPalette={
        <>
          <CommandPalette user={user} />
          {tour}
        </>
      }
      insetClassName={insetClassName}
      mainClassName={mainClassName}
      providerClassName={providerClassName}
    >
      {children}
    </AppShell>
  )
}
