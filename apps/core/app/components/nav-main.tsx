import { Link, useLocation } from "react-router"
import { type Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@eduai/ui"
import type { CronStatusColor } from "~/hooks/api/use-cron-job-status"

export interface NavMainItem {
  title: string
  url: string
  icon?: Icon
  external?: boolean
  badge?: CronStatusColor
  /** Render greyed-out and non-navigating with a tooltip (admin policy off — #807). */
  disabled?: boolean
  /** Tooltip text shown on a disabled item. */
  disabledReason?: string
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
            const isActive =
              !item.external &&
              (pathname === item.url || pathname.startsWith(item.url + "/"))
            const linkClassName =
              "relative flex items-center gap-[10px] w-full px-[14px] py-[9px] rounded-[7px] text-[13.5px] outline-none select-none"
            const linkStyle = {
              background: isActive ? "oklch(0.248 0.055 259)" : "transparent",
              color: isActive ? "#fff" : "rgba(255,255,255,0.82)",
              fontWeight: isActive ? 500 : 400,
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
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "transparent"
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
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "oklch(0.218 0.050 259)"
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        ;(e.currentTarget as HTMLAnchorElement).style.background =
                          "transparent"
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
