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

import { NavMain } from "~/components/nav-main"
import { NavSecondary } from "~/components/nav-secondary"
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
  settings: IconSettings,
}

function toNavMainItems(items: ReturnType<typeof getNavForUser>) {
  return items.map((item) => ({
    title: item.title,
    url: item.url,
    icon: NAV_ICONS[item.key],
  }))
}

export function AppSidebar({
  user,
  ...props
}: {
  user: User
} & React.ComponentProps<typeof Sidebar>) {
  const navMain = toNavMainItems(getNavForUser(user))
  const navSecondary = toNavMainItems(getNavSecondaryForUser(user))

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
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
