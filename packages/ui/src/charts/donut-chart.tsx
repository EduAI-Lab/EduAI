/**
 * Dependency-free donut chart (SVG). Themeable via caller-supplied colors (pass
 * CSS vars or oklch strings). Used for composition breakdowns on dashboards and
 * course overviews. No external chart library — keeps bundle lean and on-brand.
 *
 * Container-responsive: stacks donut over a full-width legend on narrow cards and
 * sits side-by-side once the container is wide enough, so legend labels never clip.
 */
import { cn } from "../utils"

export interface DonutSegment {
  label: string
  value: number
  color: string
}

export interface DonutChartProps {
  data: DonutSegment[]
  size?: number
  thickness?: number
  centerValue?: string | number
  centerLabel?: string
  showLegend?: boolean
  className?: string
}

export function DonutChart({
  data,
  size = 132,
  thickness = 18,
  centerValue,
  centerLabel,
  showLegend = true,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const radius = (size - thickness) / 2
  const circ = 2 * Math.PI * radius
  const center = size / 2

  let offset = 0

  return (
    <div
      className={cn(
        "@container flex flex-col items-center gap-4 @[17rem]:flex-row @[17rem]:gap-5",
        className,
      )}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--muted)"
            strokeWidth={thickness}
          />
          {total > 0 &&
            data.map((seg, i) => {
              if (seg.value <= 0) return null
              const dash = (seg.value / total) * circ
              const el = (
                <circle
                  key={i}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${circ - dash}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              )
              offset += dash
              return el
            })}
        </svg>
        {(centerValue !== undefined || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue !== undefined && (
              <span className="text-xl font-semibold leading-none text-foreground">{centerValue}</span>
            )}
            {centerLabel && (
              <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {centerLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {showLegend && (
        <ul className="flex w-full min-w-0 flex-1 flex-col gap-2 @[17rem]:w-auto">
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
      )}
    </div>
  )
}
