import { Link, useLocation } from "react-router"
import { type Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@eduai/ui"

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
      <SidebarGroupContent className="flex flex-col gap-0.5">
        <SidebarMenu>
          {items.map((item) => {
            const isActive = pathname === item.url || pathname.startsWith(item.url + "/")
            return (
              <SidebarMenuItem key={item.title}>
                <Link
                  to={item.url}
                  aria-current={isActive ? "page" : undefined}
                  className="relative flex items-center gap-[10px] w-full px-[14px] py-[9px] rounded-[7px] text-[13.5px] outline-none select-none"
                  style={{
                    background: isActive
                      ? "oklch(0.248 0.055 259)"
                      : "transparent",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.82)",
                    fontWeight: isActive ? 500 : 400,
                    transition: "background 120ms",
                    paddingLeft: "16px",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLAnchorElement).style.background = "oklch(0.218 0.050 259)"
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLAnchorElement).style.background = "transparent"
                    }
                  }}
                >
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 rounded-[0_2px_2px_0] pointer-events-none"
                      style={{
                        top: "8px",
                        bottom: "8px",
                        width: "3px",
                        background: "var(--gold)",
                      }}
                    />
                  )}
                  {item.icon && <item.icon size={16} strokeWidth={1.75} />}
                  <span className="flex-1">{item.title}</span>
                </Link>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
