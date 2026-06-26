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
  IconMail,
  IconUser,
  IconUsers,
  type Icon,
} from "@tabler/icons-react"

import {
  AppSidebar as SharedAppSidebar,
  Sidebar,
} from "@eduai/ui"
import type { NavMainItem, NavSecondaryItem } from "@eduai/ui"
import type { User } from "~/lib/auth/types"
import {
  getNavForUser,
  getNavSecondaryForUser,
  type NavItemKey,
} from "~/lib/rbac"
import { usePolicies } from "~/hooks/api/use-policies"
import { useCronJobStatus } from "~/hooks/api/use-cron-job-status"

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "question-maker": IconListCheck,
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
  "ai-tutor": IconMessageChatbot,
}

function toNavMainItems(items: ReturnType<typeof getNavForUser>): NavMainItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }))
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
  navMain?: NavMainItem[]
  navSecondary?: NavSecondaryItem[]
} & React.ComponentProps<typeof Sidebar>

export function AppSidebar({
  user,
  navMain: navMainOverride,
  navSecondary: navSecondaryOverride,
  variant = "sidebar",
  ...props
}: AppSidebarProps) {
  const { pathname } = useLocation()
  const { policies } = usePolicies()
  // Prefer the server-resolved flag from the root loader (authoritative,
  // default-aware, no paint flash). Fall back to the client policy fetch only
  // if root data is somehow unavailable.
  const rootData = useRouteLoaderData("root") as { canInvite?: boolean } | undefined

  const cronStatusColor = useCronJobStatus(user.role === "ADMIN")

  // Policy-gated nav lives in getNavForUser: a UNIT_ADMIN only sees the
  // Invitations link when `unitAdmins.canInvite` is on (matches the route gate).
  const navItems = getNavForUser(user, {
    canInvite: rootData?.canInvite ?? Boolean(policies["unitAdmins.canInvite"]),
  })
  const autoNav = toNavMainItems(navItems).map((item) =>
    item.url === "/admin/cron-jobs" && cronStatusColor
      ? { ...item, badge: cronStatusColor }
      : item,
  )
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
    <SharedAppSidebar
      logo={logo}
      logoHref="/dashboard"
      navMain={navMain}
      navSecondary={navSecondary}
      currentPath={pathname}
      LinkComponent={Link}
      user={user}
      navUser={{
        items: [
          {
            label: "Settings",
            icon: <IconSettings size={15} strokeWidth={1.75} />,
            href: "/settings",
          },
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
  )
}
