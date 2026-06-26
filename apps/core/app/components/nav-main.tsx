import { useEffect, useState } from "react"
import { Link, useLocation } from "react-router"
import { type Icon, IconChevronDown } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@eduai/ui"
import type { CronStatusColor } from "~/hooks/api/use-cron-job-status"

export interface NavMainItem {
  title: string
  url: string
  icon?: Icon
  external?: boolean
  badge?: CronStatusColor
}

export interface NavGroupItem {
  title: string
  icon?: Icon
  children: NavMainItem[]
}

export interface NavMainProps {
  items: (NavMainItem | NavGroupItem)[]
}

function isGroup(item: NavMainItem | NavGroupItem): item is NavGroupItem {
  return "children" in item
}

function isActive(pathname: string, url: string) {
  return pathname === url || pathname.startsWith(url + "/")
}

function shouldAutoExpandGroup(item: NavGroupItem, pathname: string) {
  return item.children.some((child) => isActive(pathname, child.url))
}

export function NavMain({ items }: NavMainProps) {
  const { pathname } = useLocation()

  // Manual expand/collapse overrides. Cleared on navigation so route-based
  // auto-expand can take over without fighting stale toggle state.
  const [toggleOverrides, setToggleOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setToggleOverrides({})
  }, [pathname])

  function isGroupExpanded(item: NavGroupItem) {
    if (item.title in toggleOverrides) return toggleOverrides[item.title]
    return shouldAutoExpandGroup(item, pathname)
  }

  function toggleGroup(item: NavGroupItem) {
    const nextExpanded = !isGroupExpanded(item)
    setToggleOverrides((prev) => ({ ...prev, [item.title]: nextExpanded }))
  }

  const linkClassName =
    "relative flex items-center gap-[10px] w-full px-[14px] py-[9px] rounded-[7px] text-[13.5px] outline-none select-none"

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-0.5">
        <SidebarMenu>
          {items.map((item) => {
            if (isGroup(item)) {
              const groupExpanded = isGroupExpanded(item)

              return (
                <SidebarMenuItem key={item.title}>
                  <button
                    type="button"
                    aria-expanded={groupExpanded}
                    onClick={() => toggleGroup(item)}
                    className={linkClassName}
                    style={{
                      background: "transparent",
                      color: "rgba(255,255,255,0.82)",
                      fontWeight: 400,
                      transition: "background 120ms",
                      paddingLeft: "16px",
                      cursor: "pointer",
                      border: "none",
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background =
                        "oklch(0.218 0.050 259)"
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
                    }}
                  >
                    {item.icon && <item.icon size={16} strokeWidth={1.75} />}
                    <span className="flex-1 text-left">{item.title}</span>
                    <IconChevronDown
                      size={14}
                      strokeWidth={1.75}
                      style={{
                        transition: "transform 150ms",
                        transform: groupExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                    />
                  </button>
                  {groupExpanded && (
                    <SidebarMenu>
                      {item.children.map((child) => {
                        const childActive = isActive(pathname, child.url)
                        const badgeBg =
                          child.badge === "green"
                            ? "#22c55e"
                            : child.badge === "orange"
                              ? "#f97316"
                              : child.badge === "red"
                                ? "#ef4444"
                                : undefined

                        return (
                          <SidebarMenuItem key={child.title}>
                            <Link
                              to={child.url}
                              aria-current={childActive ? "page" : undefined}
                              className={linkClassName}
                              style={{
                                background: childActive ? "oklch(0.248 0.055 259)" : "transparent",
                                color: childActive ? "#fff" : "rgba(255,255,255,0.82)",
                                fontWeight: childActive ? 500 : 400,
                                transition: "background 120ms",
                                paddingLeft: "28px",
                              }}
                              onMouseEnter={(e) => {
                                if (!childActive) {
                                  ;(e.currentTarget as HTMLAnchorElement).style.background =
                                    "oklch(0.218 0.050 259)"
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!childActive) {
                                  ;(e.currentTarget as HTMLAnchorElement).style.background =
                                    "transparent"
                                }
                              }}
                            >
                              {childActive && (
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
                              {child.icon && <child.icon size={16} strokeWidth={1.75} />}
                              <span className="flex-1">{child.title}</span>
                              {badgeBg && (
                                <span
                                  aria-label={`Status: ${child.badge}`}
                                  className={child.badge === "orange" ? "animate-pulse" : undefined}
                                  style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    flexShrink: 0,
                                    background: badgeBg,
                                  }}
                                />
                              )}
                            </Link>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  )}
                </SidebarMenuItem>
              )
            }

            // Regular item
            const itemActive =
              !item.external && isActive(pathname, item.url)
            const linkStyle = {
              background: itemActive ? "oklch(0.248 0.055 259)" : "transparent",
              color: itemActive ? "#fff" : "rgba(255,255,255,0.82)",
              fontWeight: itemActive ? 500 : 400,
              transition: "background 120ms",
              paddingLeft: "16px",
            } as const

            const badgeBg =
              item.badge === "green"
                ? "#22c55e"
                : item.badge === "orange"
                  ? "#f97316"
                  : item.badge === "red"
                    ? "#ef4444"
                    : undefined

            const linkBody = (
              <>
                {itemActive && (
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
                {badgeBg && (
                  <span
                    aria-label={`Status: ${item.badge}`}
                    className={item.badge === "orange" ? "animate-pulse" : undefined}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: badgeBg,
                    }}
                  />
                )}
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
                      if (!itemActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!itemActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background = "transparent"
                      }
                    }}
                  >
                    {linkBody}
                  </a>
                ) : (
                  <Link
                    to={item.url}
                    aria-current={itemActive ? "page" : undefined}
                    className={linkClassName}
                    style={linkStyle}
                    onMouseEnter={(e) => {
                      if (!itemActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!itemActive) {
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
