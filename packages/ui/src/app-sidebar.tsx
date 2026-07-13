import * as React from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "./ui/sidebar"
import { NavMain, type NavGroupItem, type NavMainItem } from "./nav-main"
import { NavSecondary, type NavSecondaryItem } from "./nav-secondary"
import { NavUser, type NavUserProps } from "./nav-user"
import { AppSwitcher, type BrandSwitcherProps } from "./app-launcher"

export interface AppSidebarProps
  extends React.ComponentProps<typeof Sidebar> {
  logo: React.ReactNode
  /** Destination the logo links to (default "/dashboard"). */
  logoHref?: string
  navMain: (NavMainItem | NavGroupItem)[]
  navSecondary?: NavSecondaryItem[]
  currentPath: string
  LinkComponent?: React.ElementType
  user: NavUserProps["user"]
  navUser?: Omit<NavUserProps, "user">
  /**
   * When provided, a dedicated "Switch app" button is added to the sidebar
   * footer (above the user menu): it opens a menu of the EduAI apps the current
   * role can access. The header brand stays a plain home link either way.
   */
  launcher?: Pick<BrandSwitcherProps, "apps" | "currentAppId" | "role">
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
  launcher,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <SidebarMenu className="flex-1 min-w-0">
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
          {/* Collapse toggle, visible while the sidebar is expanded (desktop).
              When collapsed/mobile the SiteHeader shows the expand trigger instead. */}
          <SidebarTrigger className="hidden shrink-0 md:inline-flex text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
        </div>
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
        {launcher && <AppSwitcher {...launcher} />}
        <NavUser user={user} LinkComponent={LinkComponent} {...navUser} />
      </SidebarFooter>
    </Sidebar>
  )
}
