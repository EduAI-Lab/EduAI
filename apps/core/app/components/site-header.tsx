import { Separator } from "~/components/ui/separator"
import { SidebarTrigger } from "~/components/ui/sidebar"
import { cn } from "~/lib/utils"

export interface SiteHeaderProps {
  title?: string
  actions?: React.ReactNode
}

export function SiteHeader({ title = "Dashboard", actions }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center border-b transition-[width,height] ease-linear",
        actions
          ? "min-h-[var(--header-height)] py-3"
          : "h-[var(--header-height)]",
      )}
    >
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        {actions ? (
          <div className="ml-auto flex items-center gap-3 sm:gap-4">{actions}</div>
        ) : null}
      </div>
    </header>
  )
}
