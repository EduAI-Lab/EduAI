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
  /** `sm` for in-panel emptiness, `default` (default) for full-page. */
  size?: "sm" | "default"
  /**
   * Render without the dashed card chrome — for slots that already sit inside
   * a bordered container (e.g. a tab panel). Defaults to `true` to keep the
   * original chrome-less look of this component; pass `bare={false}` to opt
   * into the dashed-card treatment (mirrors Question Maker's local variant).
   */
  bare?: boolean
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  size = "default",
  bare = true,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        size === "default" ? "gap-3 py-12" : "gap-2.5 py-8",
        !bare && "rounded-[var(--radius-xl)] border border-dashed border-border bg-card/40 px-6",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted text-muted-foreground",
            size === "default" ? "size-12" : "size-10",
          )}
        >
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className={cn("font-semibold text-foreground", size === "default" ? "text-lg" : "text-base")}>
          {title}
        </h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
      {children}
    </div>
  )
}
