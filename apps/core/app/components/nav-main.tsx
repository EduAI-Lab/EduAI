import { Link, useLocation } from "react-router"
import { type Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar"

export interface NavMainItem {
  title: string
  url: string
  icon?: Icon
}

export interface NavMainProps {
  items: NavMainItem[]
}

export function NavMain({ items }: NavMainProps) {
  const { pathname } = useLocation()
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => {
            const isActive = pathname === item.url || pathname.startsWith(item.url + "/")
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                  <Link
                    to={item.url}
                    aria-current={isActive ? "page" : undefined}
                    className="flex items-center gap-2 w-full"
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
