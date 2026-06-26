import { Separator } from "./ui/separator"
import { SidebarTrigger } from "./ui/sidebar"

export interface SiteHeaderProps {
  title?: string
  actions?: React.ReactNode
  leadingActions?: React.ReactNode
  breadcrumbs?: React.ReactNode
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
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
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
