import * as React from "react"
import {
  IconCamera,
  IconChartBar,
  IconDatabase,
  IconDashboard,
  IconFileAi,
  IconFileDescription,
  IconFileWord,
  IconFolder,
  IconHelp,
  IconInnerShadowTop,
  IconBooks,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
  IconMessageCircle,
  IconRobot,
  IconBrain,
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

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: IconDashboard,
    },
    {
      title: "Courses",
      url: "/courses",
      icon: IconBooks,
    },
    {
      title: "AI Management",
      url: "/admin/ai-models",
      icon: IconBrain,
    },
    {
      title: "User Management",
      url: "/admin/users",
      icon: IconUsers,
    },
    {
      title: "Chatbot",
      url: "/chat",
      icon: IconRobot,
    },
    {
      title: "Analytics",
      url: "#",
      icon: IconCamera,
    },
    {
      title: "Reports",
      url: "#",
      icon: IconReport,
    },
  ],
  navDocs: [
    {
      title: "Documents",
      icon: IconFileDescription,
      url: "#",
      items: [
        {
          title: "Recent",
          url: "#",
        },
        {
          title: "Shared",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Users",
      icon: IconUsers,
      url: "#",
      items: [
        {
          title: "All Users",
          url: "#",
        },
        {
          title: "Roles",
          url: "#",
        },
        {
          title: "Permissions",
          url: "#",
        },
      ],
    },
    {
      title: "Projects",
      icon: IconFolder,
      url: "#",
      items: [
        {
          title: "Active",
          url: "#",
        },
        {
          title: "Completed",
          url: "#",
        },
      ],
    },
    {
      title: "Prompts",
      icon: IconFileAi,
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "/settings",
      icon: IconSettings,
    },
    {
      title: "Get Help",
      url: "#",
      icon: IconHelp,
    },
    {
      title: "Search",
      url: "#",
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: IconDatabase,
    },
    {
      name: "Reports",
      url: "#",
      icon: IconReport,
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: IconFileWord,
    },
  ],
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
  navMain = data.navMain,
  navSecondary = data.navSecondary,
  documents = data.documents,
  showDocuments = false,
  ...props
}: AppSidebarProps) {
  const visibleNavMain = navMain.filter(
    (item) =>
      (item.title !== "AI Management" && item.title !== "User Management") ||
      user.role === "ADMIN"
  )

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="#">
                <IconInnerShadowTop className="!size-5" />
                <span className="text-base font-semibold">EduAI</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={visibleNavMain} />
        {showDocuments && <NavDocuments items={documents} />}
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
