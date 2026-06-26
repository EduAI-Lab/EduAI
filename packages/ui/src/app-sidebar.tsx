import * as React from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar"
import { NavMain, type NavMainItem } from "./nav-main"
import { NavSecondary, type NavSecondaryItem } from "./nav-secondary"
import { NavUser, type NavUserProps } from "./nav-user"

export interface AppSidebarProps
  extends React.ComponentProps<typeof Sidebar> {
  logo: React.ReactNode
  /** Destination the logo links to (default "/dashboard"). */
  logoHref?: string
  navMain: NavMainItem[]
  navSecondary?: NavSecondaryItem[]
  currentPath: string
  LinkComponent?: React.ElementType
  user: NavUserProps["user"]
  navUser?: Omit<NavUserProps, "user">
}

export function AppSidebar({
  logo,
  logoHref = "/dashboard",
  navMain,
  navSecondary = [],
  currentPath,
  LinkComponent = "a",
  user,
  navUser,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <LinkComponent to={logoHref} href={logoHref} className="flex items-center gap-[9px]">
                {logo}
              </LinkComponent>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMain}
          currentPath={currentPath}
          LinkComponent={LinkComponent}
        />
        {navSecondary.length > 0 && (
          <NavSecondary
            items={navSecondary}
            currentPath={currentPath}
            LinkComponent={LinkComponent}
            className="mt-auto"
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} LinkComponent={LinkComponent} {...navUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
