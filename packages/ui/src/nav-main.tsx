import * as React from "react"
import { useEffect, useState } from "react"
import { type Icon, IconChevronDown } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "./ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"

const SIDEBAR_ACTIVE_BG = "var(--color-sidebar-active)"
const SIDEBAR_HOVER_BG = "var(--color-sidebar-hover)"
const SIDEBAR_TEXT_MUTED = "rgba(255,255,255,0.82)"

export interface NavMainItem {
  title: string
  url: string
  icon?: Icon
  external?: boolean
  /** Optional status dot (e.g. cron-job health). Color is app-supplied; kept a
   * plain union so this shared component stays decoupled from any app hook. */
  badge?: "green" | "orange" | "red"
  /** Render greyed-out and non-navigating with a tooltip (admin policy off — #807). */
  disabled?: boolean
  /** Tooltip text shown on a disabled item. */
  disabledReason?: string
}

export interface NavGroupItem {
  title: string
  icon?: Icon
  children: NavMainItem[]
}

export interface NavMainProps {
  items: (NavMainItem | NavGroupItem)[]
  currentPath: string
  LinkComponent?: React.ElementType
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

export function NavMain({
  items,
  currentPath,
  LinkComponent = "a",
}: NavMainProps) {
  // Manual expand/collapse overrides. Cleared on navigation so route-based
  // auto-expand can take over without fighting stale toggle state.
  const [toggleOverrides, setToggleOverrides] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setToggleOverrides({})
  }, [currentPath])

  function isGroupExpanded(item: NavGroupItem) {
    if (item.title in toggleOverrides) return toggleOverrides[item.title]
    return shouldAutoExpandGroup(item, currentPath)
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
                      color: SIDEBAR_TEXT_MUTED,
                      fontWeight: 400,
                      transition: "background 120ms",
                      paddingLeft: "16px",
                      cursor: "pointer",
                      border: "none",
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background =
                        SIDEBAR_HOVER_BG
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
                        const childActive = isActive(currentPath, child.url)
                        const badgeBg =
                          child.badge === "green"
                            ? "var(--color-badge-green)"
                            : child.badge === "orange"
                              ? "var(--color-badge-orange)"
                              : child.badge === "red"
                                ? "var(--color-badge-red)"
                                : undefined

                        return (
                          <SidebarMenuItem key={child.title}>
                            <LinkComponent
                              to={child.url}
                              href={child.url}
                              aria-current={childActive ? "page" : undefined}
                              className={linkClassName}
                              style={{
                                background: childActive ? SIDEBAR_ACTIVE_BG : "transparent",
                                color: childActive ? "#fff" : SIDEBAR_TEXT_MUTED,
                                fontWeight: childActive ? 500 : 400,
                                transition: "background 120ms",
                                paddingLeft: "28px",
                              }}
                              onMouseEnter={(e: React.MouseEvent<HTMLElement>) => {
                                if (!childActive) {
                                  ;(e.currentTarget as HTMLElement).style.background =
                                    SIDEBAR_HOVER_BG
                                }
                              }}
                              onMouseLeave={(e: React.MouseEvent<HTMLElement>) => {
                                if (!childActive) {
                                  ;(e.currentTarget as HTMLElement).style.background =
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
                            </LinkComponent>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  )}
                </SidebarMenuItem>
              )
            }

            const itemActive =
              !item.external && isActive(currentPath, item.url)
            const linkStyle = {
              background: itemActive ? SIDEBAR_ACTIVE_BG : "transparent",
              color: itemActive ? "#fff" : SIDEBAR_TEXT_MUTED,
              fontWeight: itemActive ? 500 : 400,
              transition: "background 120ms",
              paddingLeft: "16px",
            } as const

            const badgeBg =
              item.badge === "green"
                ? "var(--color-badge-green)"
                : item.badge === "orange"
                  ? "var(--color-badge-orange)"
                  : item.badge === "red"
                    ? "var(--color-badge-red)"
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

            if (item.disabled) {
              return (
                <SidebarMenuItem key={item.title}>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          aria-disabled
                          className={`${linkClassName} cursor-not-allowed`}
                          style={{ ...linkStyle, opacity: 0.45 }}
                        >
                          {linkBody}
                        </div>
                      </TooltipTrigger>
                      {item.disabledReason && (
                        <TooltipContent side="right" className="max-w-[240px]">
                          <p>{item.disabledReason}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </SidebarMenuItem>
              )
            }

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
                          SIDEBAR_HOVER_BG
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
                  <LinkComponent
                    to={item.url}
                    href={item.url}
                    aria-current={itemActive ? "page" : undefined}
                    className={linkClassName}
                    style={linkStyle}
                    onMouseEnter={(e: React.MouseEvent<HTMLElement>) => {
                      if (!itemActive) {
                        ;(e.currentTarget as HTMLElement).style.background =
                          SIDEBAR_HOVER_BG
                      }
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLElement>) => {
                      if (!itemActive) {
                        ;(e.currentTarget as HTMLElement).style.background =
                          "transparent"
                      }
                    }}
                  >
                    {linkBody}
                  </LinkComponent>
                )}
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
