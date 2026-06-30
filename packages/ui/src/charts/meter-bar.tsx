/**
 * Labeled horizontal proportion bar. Used for readiness/coverage meters where a
 * single value-against-total reading makes sense. For multi-category composition
 * (e.g. difficulty mix) prefer StackedBar — separate meters leave every bar mostly
 * empty. Pass any CSS color/var for the fill.
 */
import { cn } from "../utils"

export interface MeterBarProps {
  label: string
  value: number
  total: number
  color?: string
  /** Show the raw "value / total" instead of a percentage. */
  showCount?: boolean
  className?: string
}

export function MeterBar({
  label,
  value,
  total,
  color = "var(--primary)",
  showCount = false,
  className,
}: MeterBarProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="truncate text-foreground">{label}</span>
        <span className="shrink-0 font-medium text-muted-foreground">
          {showCount ? `${value} / ${total}` : `${pct}%`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}
