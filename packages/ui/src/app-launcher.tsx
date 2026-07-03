import * as React from "react"
import { IconChevronDown, IconExternalLink } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar"

/**
 * Platform roles allowed to open Question Maker. Mirrors the Core nav gate
 * (rbac-matrix §4) so every app's switcher agrees on who sees QM. Export it so
 * each consumer builds its app list from the same source of truth.
 */
export const QUESTION_MAKER_ROLES = ["INSTRUCTOR", "ADMIN", "UNIT_ADMIN"] as const

/** A launchable EduAI app / extension (Core, AI Tutor, Question Maker, …). */
export interface LauncherApp {
  /** Stable id used to mark the current app (e.g. "core", "ai-tutor", "question-maker"). */
  id: string
  name: string
  /** Absolute URL to the app. Ignored for the current app. */
  url: string
  icon?: React.ReactNode
  /**
   * Platform roles allowed to see/open this app. Omit to allow every role.
   * The switcher hides entries the current role isn't permitted (RBAC).
   */
  roles?: readonly string[]
}

/** Apps the given role may access (RBAC gate). */
function visibleFor(apps: LauncherApp[], role?: string | null): LauncherApp[] {
  return apps.filter(
    (app) => !app.roles || (role != null && app.roles.includes(role)),
  )
}

/** Shared dropdown body: header label + one row per accessible app. */
function AppSwitcherMenu({
  apps,
  currentAppId,
}: {
  apps: LauncherApp[]
  currentAppId: string
}) {
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">
        Switch app
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {apps.map((app) => {
        const isCurrent = app.id === currentAppId
        const inner = (
          <>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              {app.icon}
            </span>
            <span className="truncate text-sm font-medium">{app.name}</span>
            {isCurrent ? (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                now
              </span>
            ) : (
              <IconExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground" />
            )}
          </>
        )
        return (
          <DropdownMenuItem
            key={app.id}
            asChild={!isCurrent}
            disabled={isCurrent}
            className="gap-2 py-2"
          >
            {isCurrent ? (
              <div className="flex w-full items-center gap-2">{inner}</div>
            ) : (
              <a href={app.url} className="flex w-full items-center gap-2">
                {inner}
              </a>
            )}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

export interface BrandSwitcherProps {
  /** The app brand (logo icon + name) rendered inside the trigger. */
  logo: React.ReactNode
  /** Where the brand links when there's nothing to switch to (solo fallback). */
  logoHref?: string
  /** Link component for the solo fallback (default "a"). */
  LinkComponent?: React.ElementType
  apps: LauncherApp[]
  /** Marks which entry is the app currently being viewed. */
  currentAppId: string
  /** Current user's platform role — used to hide apps they can't access. */
  role?: string | null
  /** Applied to the root SidebarMenu (e.g. flex-1 for header layout). */
  className?: string
}

/**
 * Sidebar-header brand that doubles as the app switcher (Slack/Linear/Vercel
 * pattern): the logo+name is the current app's identity, and clicking it opens
 * a menu to jump to the other EduAI apps the current role may access.
 *
 * When only one app is accessible there's nothing to switch to, so it renders
 * as a plain home link instead of a dead dropdown.
 */
export function BrandSwitcher({
  logo,
  logoHref = "/",
  LinkComponent = "a",
  apps,
  currentAppId,
  role,
  className,
}: BrandSwitcherProps) {
  const accessible = visibleFor(apps, role)

  return (
    <SidebarMenu className={className}>
      <SidebarMenuItem>
        {accessible.length <= 1 ? (
          <SidebarMenuButton
            asChild
            className="data-[slot=sidebar-menu-button]:!p-1.5"
          >
            <LinkComponent
              to={logoHref}
              href={logoHref}
              className="flex items-center gap-[9px]"
            >
              {logo}
            </LinkComponent>
          </SidebarMenuButton>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                aria-label="Switch app"
                className="data-[slot=sidebar-menu-button]:!p-1.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                {logo}
                <IconChevronDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/60" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="start"
              sideOffset={4}
              className="min-w-56 rounded-lg"
            >
              <AppSwitcherMenu apps={accessible} currentAppId={currentAppId} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
