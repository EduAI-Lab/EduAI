import * as React from "react"
import {
  IconArrowsExchange,
  IconChevronDown,
  IconExternalLink,
} from "@tabler/icons-react"
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
 * (rbac-matrix §4) so every app's launcher agrees on who sees QM. Export it so
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
   * The launcher hides entries the current role isn't permitted (RBAC).
   */
  roles?: readonly string[]
}

export interface AppLauncherProps {
  apps: LauncherApp[]
  /** Marks which entry is the app currently being viewed. */
  currentAppId: string
  /** Current user's platform role — used to hide apps they can't access. */
  role?: string | null
  /** Trigger label (default "Switch app"). */
  label?: string
}

/**
 * Bottom-of-sidebar app switcher. The trigger reads "Switch app" (rather than
 * masquerading as a form field showing the current app) so its purpose is
 * obvious; the menu lists every app the current role may access, with the
 * current one checked and non-navigating and the rest opening in place.
 *
 * Role gating is enforced here: apps whose `roles` don't include the current
 * role are never rendered — a student never sees a Question Maker entry.
 */
export function AppLauncher({
  apps,
  currentAppId,
  role,
  label = "Switch app",
}: AppLauncherProps) {
  const { isMobile } = useSidebar()

  const visibleApps = apps.filter(
    (app) => !app.roles || (role != null && app.roles.includes(role)),
  )

  // A lone entry (only the current app is permitted) makes the switcher a no-op;
  // hide it entirely so the footer isn't cluttered with a dead control.
  if (visibleApps.length <= 1) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={label}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <IconArrowsExchange className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
              <IconChevronDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Switch app
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {visibleApps.map((app) => {
              const isCurrent = app.id === currentAppId
              const inner = (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    {app.icon ?? <IconArrowsExchange className="size-4" />}
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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
