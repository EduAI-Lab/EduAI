/** Standard titled content card used across dashboard + course analytics panels. */
import type { ReactNode } from "react"
import { cn } from "../utils"

export interface PanelCardProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

export function PanelCard({ title, action, children, className }: PanelCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] border border-border bg-card p-5 shadow-[var(--shadow-2xs)]",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}
