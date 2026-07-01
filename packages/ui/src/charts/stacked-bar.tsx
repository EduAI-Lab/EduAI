/**
 * Single horizontal stacked proportion bar with a counted legend. Each segment's
 * width is its share of the summed total, so the bar always fills — unlike per-
 * category meters where every bar sits mostly empty. Used for difficulty mix and
 * any small composition breakdown. Robust to all-zero data (renders empty track).
 */
import { cn } from "../utils"

export interface StackedSegment {
  label: string
  value: number
  color: string
}

export interface StackedBarProps {
  data: StackedSegment[]
  className?: string
}

export function StackedBar({ data, className }: StackedBarProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className={cn("flex flex-col gap-3 pt-1", className)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          data.map((seg, i) =>
            seg.value > 0 ? (
              <div
                key={i}
                className="h-full transition-[width] duration-500"
                style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }}
              />
            ) : null,
          )}
      </div>

      <ul className="flex min-w-0 flex-col gap-2">
        {data.map((seg, i) => {
          const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0
          return (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: seg.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-foreground">{seg.label}</span>
              <span className="shrink-0 font-medium text-foreground">{seg.value}</span>
              <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">{pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
