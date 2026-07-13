import { useEffect, useState } from "react"

import { Separator } from "./ui/separator"
import { SidebarTrigger, useSidebar } from "./ui/sidebar"

export interface SiteHeaderProps {
  title?: string
  actions?: React.ReactNode
  leadingActions?: React.ReactNode
  breadcrumbs?: React.ReactNode
}

/**
 * True while `<html data-assistive-focus-mode>` is set — an app-defined
 * attribute (e.g. Core's chat "focus mode") that CSS uses to visually hide the
 * nav rail while keeping its collapsed *state* "expanded". No app currently
 * setting this attribute wants the header's expand/collapse trigger to
 * disappear along with it, so this stays a plain attribute watch rather than
 * routing through SidebarContext. Apps that never set the attribute (the
 * common case) get `false` forever — zero behavior change for them.
 */
function useAssistiveFocusModeActive(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setActive(root.hasAttribute("data-assistive-focus-mode"))
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-assistive-focus-mode"],
    })
    return () => observer.disconnect()
  }, [])

  return active
}

/**
 * Sidebar toggle shown only when the sidebar is collapsed (desktop), on
 * mobile, or when an app-level "focus mode" has hidden the nav rail via CSS
 * while its state remains "expanded" — the trigger must stay reachable so the
 * user can exit focus mode or navigate away. When the sidebar is expanded (and
 * focus mode is off) it carries its own header trigger, so showing one here
 * too would be redundant.
 */
function HeaderSidebarTrigger() {
  const { isMobile, state } = useSidebar()
  const focusModeActive = useAssistiveFocusModeActive()
  if (!isMobile && state === "expanded" && !focusModeActive) {
    return null
  }
  return (
    <>
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mx-2 data-[orientation=vertical]:h-4"
      />
    </>
  )
}

export function SiteHeader({
  title,
  actions,
  leadingActions,
  breadcrumbs,
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height)] shrink-0 items-center border-b bg-background">
      <div className="flex h-full w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <HeaderSidebarTrigger />
        {breadcrumbs ? (
          <>
            {title ? <h1 className="sr-only">{title}</h1> : null}
            <div
              className="min-w-0 flex-1 overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to right, black calc(100% - 3rem), transparent)",
              }}
            >
              {breadcrumbs}
            </div>
          </>
        ) : (
          <h1 className="text-sm font-normal text-foreground">{title}</h1>
        )}
        {leadingActions ? (
          <div className="flex h-full shrink-0 items-center gap-1.5">
            {leadingActions}
          </div>
        ) : null}
        <div className="ml-auto flex h-full items-center gap-3 sm:gap-4">
          {actions}
        </div>
      </div>
    </header>
  )
}
