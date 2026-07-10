import * as React from "react"
import { Form, Link, useLocation, useRouteLoaderData } from "react-router"
import {
  IconBooks,
  IconBrain,
  IconClockCog,
  IconDashboard,
  IconFileText,
  IconListCheck,
  IconLogout,
  IconMessageChatbot,
  IconReport,
  IconRobot,
  IconSettings,
  IconShieldLock,
  IconHelp,
  IconMail,
  IconUser,
  IconUsers,
  type Icon,
} from "@tabler/icons-react"

import {
  AppSidebar as SharedAppSidebar,
  Sidebar,
} from "@eduai/ui"
import type { NavGroupItem as NavMainGroupItem, NavMainItem, NavSecondaryItem } from "@eduai/ui"
import type { User } from "~/lib/auth/types"
import { CURRENT_APP_ID, getLauncherApps } from "~/lib/apps"
import {
  getNavForUser,
  getNavSecondaryForUser,
  type NavItemKey,
} from "~/lib/rbac"
import { usePolicyGate } from "~/components/policy/policy-gate"
import { useCronJobStatus, type CronStatusColor } from "~/hooks/api/use-cron-job-status"
import { CommandPalette } from "~/components/command/command-palette"

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "question-maker": IconListCheck,
  "admin-group": IconShieldLock,
  "admin-users": IconUsers,
  "admin-ai": IconBrain,
  "admin-bugs": IconReport,
  "admin-chat": IconRobot,
  "admin-invites": IconMail,
  "admin-settings": IconShieldLock,
  "admin-logs": IconFileText,
  "unitadmin-invites": IconMail,
  "admin-cron": IconClockCog,
  settings: IconSettings,
  help: IconHelp,
  "ai-tutor": IconMessageChatbot,
}

function toNavMainItems(
  items: ReturnType<typeof getNavForUser>,
  cronStatusColor?: CronStatusColor | null,
): (NavMainItem | NavMainGroupItem)[] {
  return items.map((item) => {
    if ("children" in item) {
      return {
        title: item.title,
        icon: NAV_ICONS[item.key],
        children: item.children.map((child) => ({
          title: child.title,
          url: child.url,
          icon: NAV_ICONS[child.key],
          external: child.external,
          disabled: child.disabled,
          disabledReason: child.disabledReason,
          badge:
            child.url === "/admin/cron-jobs" && cronStatusColor ? cronStatusColor : undefined,
        })),
      } satisfies NavMainGroupItem
    }
    return {
      title: item.title,
      url: item.url,
      icon: NAV_ICONS[item.key],
      external: item.external,
      disabled: item.disabled,
      disabledReason: item.disabledReason,
    } satisfies NavMainItem
  })
}

function toNavSecondaryItems(
  items: ReturnType<typeof getNavSecondaryForUser>,
): NavSecondaryItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }))
}

export type AppSidebarProps = {
  user: User
  navMain?: (NavMainItem | NavMainGroupItem)[]
  navSecondary?: NavSecondaryItem[]
} & React.ComponentProps<typeof Sidebar>

export function AppSidebar({
  user,
  navMain: navMainOverride,
  navSecondary: navSecondaryOverride,
  variant = "sidebar",
  ...props
}: AppSidebarProps) {
  const { isEnabled } = usePolicyGate()
  const { pathname } = useLocation()
  // Prefer the server-resolved flag from the root loader (authoritative,
  // default-aware, no paint flash). Fall back to the SSR-seeded policy gate only
  // if root data is somehow unavailable.
  const rootData = useRouteLoaderData("root") as { canInvite?: boolean } | undefined

  const cronStatusColor = useCronJobStatus(user.role === "ADMIN")

  // Policy-gated nav lives in getNavForUser: a UNIT_ADMIN only sees the
  // Invitations link when `unitAdmins.canInvite` is on (matches the route gate).
  const navItems = getNavForUser(user, {
    canInvite: rootData?.canInvite ?? isEnabled("unitAdmins.canInvite"),
  })
  const autoNav = toNavMainItems(navItems, cronStatusColor)
  const navMain = navMainOverride ?? autoNav
  const navSecondary =
    navSecondaryOverride ?? toNavSecondaryItems(getNavSecondaryForUser(user))

  const logo = (
    <>
      {/* Globe logo — same as login/signup page */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: "var(--primary)",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.75" strokeLinecap="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 3a9 9 0 0 1 0 18"/>
          <path d="M3 12h18"/>
          <path d="M12 3c2 2 3.5 5.5 3.5 9s-1.5 7-3.5 9"/>
        </svg>
      </div>
      <span className="text-base font-bold" style={{ letterSpacing: "-0.01em" }}>EduAI</span>
    </>
  )

  return (
    <>
      <CommandPalette user={user} />
      <SharedAppSidebar
        logo={logo}
        logoHref="/dashboard"
      navMain={navMain}
      navSecondary={navSecondary}
      currentPath={pathname}
      LinkComponent={Link}
      launcher={{
        apps: getLauncherApps(),
        currentAppId: CURRENT_APP_ID,
        role: user.role,
      }}
      user={user}
      navUser={{
        items: [
          {
            label: "Settings",
            icon: <IconSettings size={15} strokeWidth={1.75} />,
            href: "/settings",
          },
          // TODO: remove Account menu item (note carried over from the old Core
          // nav-user, which was extracted into @eduai/ui during the QM redesign).
          {
            label: "Account",
            icon: <IconUser size={15} strokeWidth={1.75} />,
            href: "/settings/account",
          },
        ],
        logoutElement: (
          <Form method="post" action="/auth/logout" replace className="w-full">
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
            >
              <IconLogout size={15} strokeWidth={1.75} />
              Log out
            </button>
          </Form>
        ),
      }}
        variant={variant}
        {...props}
      />
    </>
  )
}
