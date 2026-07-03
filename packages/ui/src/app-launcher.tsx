import * as React from "react"
import { IconApps, IconArrowUpRight } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar"
import { cn } from "./utils"

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
  /** One-line description shown under the name in the switcher grid. */
  description?: string
  /**
   * Brand accent for this app as a CSS color (e.g. "var(--accent)"). Tints the
   * icon tile and highlights the current app. Falls back to the theme accent.
   */
  color?: string
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

/**
 * One colorful app card. Spreads `...rest` onto its root element so Radix
 * `asChild` (DropdownMenuItem) can merge in its className/handlers — that shared
 * root keeps the active (current) and hover (other) rows exactly the same box.
 */
function AppCard({
  app,
  isCurrent,
  className,
  style,
  ...rest
}: {
  app: LauncherApp
  isCurrent: boolean
} & React.HTMLAttributes<HTMLElement>) {
  const brand = app.color ?? "var(--accent)"

  const inner = (
    <>
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm transition-transform duration-150 group-hover:scale-105 [&_svg]:!text-white"
        style={{ backgroundColor: "var(--brand)" }}
      >
        {app.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold leading-tight text-foreground">
          {app.name}
        </span>
        {app.description && (
          <span className="truncate text-xs leading-tight text-muted-foreground">
            {app.description}
          </span>
        )}
      </span>
      {isCurrent ? (
        <span
          className="ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: "var(--brand)" }}
        >
          Now
        </span>
      ) : (
        <IconArrowUpRight className="ml-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </>
  )

  const merged = cn(
    className,
    "group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors",
    isCurrent ? "cursor-default bg-muted" : "hover:bg-muted",
  )
  const mergedStyle = { "--brand": brand, ...style } as React.CSSProperties

  // Both states render the SAME <a> element so the box is identical; the current
  // app just drops its href (non-navigating) and is marked aria-current.
  return (
    <a
      href={isCurrent ? undefined : app.url}
      aria-current={isCurrent ? "page" : undefined}
      className={merged}
      style={mergedStyle}
      {...rest}
    >
      {inner}
    </a>
  )
}

/** Switcher popover body: header + a card per accessible app. */
function AppSwitcherGrid({
  apps,
  currentAppId,
}: {
  apps: LauncherApp[]
  currentAppId: string
}) {
  return (
    <div className="flex w-full flex-col items-stretch gap-1">
      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Switch app
      </p>
      {apps.map((app) => (
        <DropdownMenuItem
          key={app.id}
          asChild
          disabled={app.id === currentAppId}
          className="w-full p-0 data-[highlighted]:bg-muted data-[disabled]:opacity-100"
        >
          <AppCard app={app} isCurrent={app.id === currentAppId} />
        </DropdownMenuItem>
      ))}
    </div>
  )
}

export interface BrandSwitcherProps {
  /** The app brand (logo icon + name) rendered inside the trigger. */
  logo: React.ReactNode
  /** Where the brand logo links — the current app's home (default "/"). */
  logoHref?: string
  /** Link component for the brand home link (default "a"). */
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
 * Sidebar-header brand + app switcher. The logo+name is a plain link to the
 * current app's home (one click to /dashboard); a separate app-grid ("waffle")
 * button beside it opens a colorful popover to jump to the other EduAI apps the
 * current role may access.
 *
 * When only one app is accessible there's nothing to switch to, so the waffle
 * button is omitted and only the home link renders.
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
      <SidebarMenuItem className="flex w-full items-center gap-1">
        <SidebarMenuButton
          asChild
          className="min-w-0 flex-1 data-[slot=sidebar-menu-button]:!p-1.5"
        >
          <LinkComponent
            to={logoHref}
            href={logoHref}
            className="flex min-w-0 items-center gap-[9px]"
          >
            {logo}
          </LinkComponent>
        </SidebarMenuButton>

        {accessible.length >= 2 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Switch app"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <IconApps className="size-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              style={{ maxWidth: "calc(100vw - 1.5rem)" }}
              className="w-80 rounded-xl p-2"
            >
              <AppSwitcherGrid apps={accessible} currentAppId={currentAppId} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
