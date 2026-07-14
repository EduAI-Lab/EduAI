import * as React from "react"

import { AppSidebar, type AppSidebarProps } from "./app-sidebar"
import { SiteHeader } from "./site-header"
import { SidebarProvider, SidebarInset } from "./ui/sidebar"

export interface AppShellProps {
  /**
   * Full sidebar configuration, forwarded as-is to the shared AppSidebar
   * (logo, navMain, navSecondary, launcher, user, navUser, ...Sidebar props).
   * Grouped into one object — rather than this shell re-exposing every
   * AppSidebar prop individually — so sidebar and header props never collide
   * (both would otherwise want e.g. a `user` or `actions` name).
   */
  sidebar: AppSidebarProps
  /** Header title. Rendered as a visible heading, or an sr-only one when `breadcrumbs` is set. */
  title?: string
  /** Breadcrumb trail rendered in place of the plain title. */
  breadcrumbs?: React.ReactNode
  /** Right-aligned header controls (forwarded to SiteHeader's `actions`). */
  headerActions?: React.ReactNode
  /** Main content — e.g. a router `<Outlet />` or page-level JSX. */
  children: React.ReactNode
  /**
   * Floating/global elements that need to live inside the SidebarProvider
   * tree, rendered as a sibling after SidebarInset — a command palette, a
   * product tour, app-scoped dialogs, etc. Pass a fragment for more than one.
   */
  commandPalette?: React.ReactNode
  /** CSS value for the `--sidebar-width` custom property. */
  sidebarWidth?: string
  /** CSS value for the `--header-height` custom property. */
  headerHeight?: string
  /**
   * Escape hatch that REPLACES `SidebarInset`'s default className
   * (`"min-w-0"`) when provided. Most pages should leave this alone — it
   * exists for pages with non-standard scroll containment (e.g. an
   * internally-scrolling chat layout that needs `min-h-0` instead of
   * `min-w-0`). `SidebarInset` itself always keeps its own base flex classes
   * regardless of what's passed here.
   */
  insetClassName?: string
  /**
   * Escape hatch that REPLACES the wrapping `<main>`'s default className
   * (`"min-w-0 flex-1 overflow-auto"`) when provided. Pair with
   * `insetClassName` when a page owns its own internal scroll region and the
   * default `overflow-auto` main would fight it.
   */
  mainClassName?: string
}

/**
 * Shared app chrome: SidebarProvider → AppSidebar → SidebarInset → SiteHeader
 * → main → optional floating slot. One composition of the shell shape shared
 * by Core, Question Maker, and AI Tutor (#764), instead of each app — or, in
 * Core's case, each route — re-implementing it. Every app-specific concern
 * (nav items, header actions, auth gating, dialogs, the logout flow) arrives
 * via props/slots; this component owns none of it.
 */
export function AppShell({
  sidebar,
  title,
  breadcrumbs,
  headerActions,
  children,
  commandPalette,
  sidebarWidth = "calc(var(--spacing) * 72)",
  headerHeight = "calc(var(--spacing) * 12)",
  insetClassName,
  mainClassName,
}: AppShellProps) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": sidebarWidth,
          "--header-height": headerHeight,
        } as React.CSSProperties
      }
    >
      <AppSidebar {...sidebar} />
      <SidebarInset className={insetClassName ?? "min-w-0"}>
        <SiteHeader title={title} breadcrumbs={breadcrumbs} actions={headerActions} />
        <main className={mainClassName ?? "min-w-0 flex-1 overflow-auto"}>{children}</main>
      </SidebarInset>
      {commandPalette}
    </SidebarProvider>
  )
}
