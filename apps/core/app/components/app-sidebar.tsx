import * as React from "react"
import {
  IconBooks,
  IconBrain,
  IconDashboard,
  IconFileText,
  IconListCheck,
  IconMessageChatbot,
  IconReport,
  IconRobot,
  IconSettings,
  IconShieldLock,
  IconMail,
  IconUsers,
  type Icon,
} from "@tabler/icons-react"

import { NavDocuments } from "~/components/nav-documents"
import type { NavDocumentItem } from "~/components/nav-documents"
import { NavMain } from "~/components/nav-main"
import type { NavMainItem } from "~/components/nav-main"
import { NavSecondary } from "~/components/nav-secondary"
import type { NavSecondaryItem } from "~/components/nav-secondary"
import { NavUser } from "~/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@eduai/ui"
import type { User } from "~/lib/auth/types"
import {
  getNavForUser,
  getNavSecondaryForUser,
  type NavItemKey,
} from "~/lib/rbac"
import { usePolicies } from "~/hooks/api/use-policies"

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "question-maker": IconListCheck,
  "admin-users": IconUsers,
  "admin-ai": IconBrain,
  "admin-bugs": IconReport,
  "admin-invites": IconMail,
  "admin-settings": IconShieldLock,
  "admin-logs": IconFileText,
  "unitadmin-invites": IconMail,
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
  documents?: NavDocumentItem[]
  showDocuments?: boolean
} & React.ComponentProps<typeof Sidebar>

export function AppSidebar({
  user,
  navMain: navMainOverride,
  navSecondary: navSecondaryOverride,
  documents = [],
  showDocuments = false,
  variant = "sidebar",
  ...props
}: AppSidebarProps) {
  const { policies } = usePolicies()

  // Policy-gated nav lives in getNavForUser: a UNIT_ADMIN only sees the
  // Invitations link when `unitAdmins.canInvite` is on (matches the route gate).
  const navItems = getNavForUser(user, {
    canInvite: Boolean(policies["unitAdmins.canInvite"]),
  })
  const navMain = navMainOverride ?? toNavMainItems(navItems)
  const navSecondary =
    navSecondaryOverride ?? toNavSecondaryItems(getNavSecondaryForUser(user))

  return (
    <Sidebar variant={variant} collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/dashboard" className="flex items-center gap-[9px]">
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
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        {showDocuments && <NavDocuments items={documents} />}
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
