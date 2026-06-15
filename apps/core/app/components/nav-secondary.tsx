import * as React from "react"
import { Link, useLocation } from "react-router"
import { type Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@eduai/ui"

export interface NavSecondaryItem {
  title: string
  url: string
  icon: Icon
  external?: boolean
}

export type NavSecondaryProps = {
  items: NavSecondaryItem[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>

export function NavSecondary({
  items,
  ...props
}: NavSecondaryProps) {
  const { pathname } = useLocation()
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = !item.external && (pathname === item.url || pathname.startsWith(item.url + "/"))
            const linkClassName = "relative flex items-center gap-[10px] w-full px-[14px] py-[9px] rounded-[7px] text-[13.5px] outline-none select-none"
            const linkStyle = {
              background: isActive ? "oklch(0.248 0.055 259)" : "transparent",
              color: isActive ? "#fff" : "rgba(255,255,255,0.82)",
              fontWeight: isActive ? 500 : 400,
              transition: "background 120ms",
              paddingLeft: "16px",
            } as const
            const linkBody = (
              <>
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 rounded-[0_2px_2px_0] pointer-events-none"
                    style={{ top: "8px", bottom: "8px", width: "3px", background: "var(--gold)" }}
                  />
                )}
                <item.icon size={16} strokeWidth={1.75} />
                <span className="flex-1">{item.title}</span>
              </>
            )
            return (
              <SidebarMenuItem key={item.title}>
                {item.external ? (
                  <a
                    href={item.url}
                    className={linkClassName}
                    style={linkStyle}
                    rel="noopener noreferrer"
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background = "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background = "transparent"
                      }
                    }}
                  >
                    {linkBody}
                  </a>
                ) : (
                  <Link
                    to={item.url}
                    aria-current={isActive ? "page" : undefined}
                    className={linkClassName}
                    style={linkStyle}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background = "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background = "transparent"
                      }
                    }}
                  >
                    {linkBody}
                  </Link>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
