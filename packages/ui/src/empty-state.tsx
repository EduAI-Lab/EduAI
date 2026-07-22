import type * as React from "react"
import { cn } from "./utils"

export interface EmptyStateProps {
  /** Icon element rendered inside a muted circular chip, e.g. <IconFolders size={22} />. */
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  /** Slot for a call-to-action, typically a <Button>. */
  action?: React.ReactNode
  /** Optional extra content rendered under the action (e.g. a tips list). */
  children?: React.ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, children, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-12 text-center", className)}>
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
      {children}
    </div>
  )
}
