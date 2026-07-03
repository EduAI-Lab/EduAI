import * as React from "react"
import {
  IconApps,
  IconCheck,
  IconExternalLink,
  IconSelector,
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

/** A launchable EduAI app / extension (Core, AI Tutor, Question Maker, …). */
export interface LauncherApp {
  /** Stable id used to mark the current app (e.g. "core", "ai-tutor", "question-maker"). */
  id: string
  name: string
  /** Short tagline shown under the name in the menu. */
  description?: string
  /** Absolute URL to the app. Ignored for the current app. */
  url: string
  icon?: React.ReactNode
}

export interface AppLauncherProps {
  apps: LauncherApp[]
  /** Marks which entry is the app currently being viewed. */
  currentAppId: string
  /** Trigger label above the current app name (default "Extensions"). */
  label?: string
}

/**
 * Bottom-of-sidebar launcher that lists every EduAI app so users can jump
 * between Core and the extensions from one place, instead of a single
 * back-to-Core link. The current app is shown checked and non-navigating.
 */
export function AppLauncher({
  apps,
  currentAppId,
  label = "Extensions",
}: AppLauncherProps) {
  const { isMobile } = useSidebar()
  const current = apps.find((app) => app.id === currentAppId)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={label}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
                {current?.icon ?? <IconApps className="size-4" />}
              </span>
              <div className="flex min-w-0 flex-col leading-none">
                <span className="truncate text-xs font-medium text-sidebar-foreground/60">
                  {label}
                </span>
                <span className="truncate text-sm font-semibold">
                  {current?.name ?? "Apps"}
                </span>
              </div>
              <IconSelector className="ml-auto size-4 shrink-0 text-sidebar-foreground/60" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
            className="min-w-60 rounded-lg"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Switch app
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {apps.map((app) => {
              const isCurrent = app.id === currentAppId
              const inner = (
                <>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    {app.icon ?? <IconApps className="size-4" />}
                  </span>
                  <div className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{app.name}</span>
                    {app.description && (
                      <span className="truncate text-xs text-muted-foreground">
                        {app.description}
                      </span>
                    )}
                  </div>
                  {isCurrent ? (
                    <IconCheck className="ml-auto size-4 shrink-0 text-primary" />
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
                    <a
                      href={app.url}
                      className="flex w-full items-center gap-2"
                    >
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
