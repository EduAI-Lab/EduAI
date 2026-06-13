import * as React from "react"
import {
  IconBooks,
  IconBrain,
  IconDashboard,
  IconInnerShadowTop,
  IconReport,
  IconRobot,
  IconSettings,
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
} from "~/components/ui/sidebar"
import type { User } from "~/lib/auth/types"
import {
  getNavForUser,
  getNavSecondaryForUser,
  type NavItemKey,
} from "~/lib/rbac"

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  chat: IconRobot,
  "admin-users": IconUsers,
  "admin-ai": IconBrain,
  "admin-bugs": IconReport,
  "admin-chat": IconRobot,
  settings: IconSettings,
}

function toNavMainItems(items: ReturnType<typeof getNavForUser>): NavMainItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    icon: NAV_ICONS[item.key],
  }))
}

function toNavSecondaryItems(
  items: ReturnType<typeof getNavSecondaryForUser>,
): NavSecondaryItem[] {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    icon: NAV_ICONS[item.key],
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
  ...props
}: AppSidebarProps) {
  const navMain = navMainOverride ?? toNavMainItems(getNavForUser(user))
  const navSecondary =
    navSecondaryOverride ?? toNavSecondaryItems(getNavSecondaryForUser(user))

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/dashboard">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">EduAI</span>
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
