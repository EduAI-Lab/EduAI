import type { CSSProperties } from "react"

export interface StatCardProps {
  /** Metric label e.g. "Active Students" */
  label: string
  /** Displayed value e.g. "4,532" */
  value: string | number
  /** Percentage change (positive or negative number) */
  trend?: number
  /** Trend description e.g. "vs last month" */
  trendLabel?: string
  style?: CSSProperties
}

export function StatCard({ label, value, trend, trendLabel, style }: StatCardProps) {
  const isPositive = trend !== undefined && trend > 0
  const isNegative = trend !== undefined && trend < 0

  return (
    <div
      className="flex flex-col rounded-[var(--radius-lg)] border border-border overflow-hidden shadow-[var(--shadow-2xs)]"
      style={{
        background:
          "linear-gradient(to bottom, oklch(from var(--primary) l c h / 0.05), var(--card))",
        ...style,
      }}
    >
      <div className={`flex flex-col gap-1 px-5 pt-5 ${trendLabel ? "" : "pb-5"}`}>
        <div className="text-sm text-muted-foreground leading-normal">{label}</div>
        <div className="flex items-center justify-between">
          <div className="text-2xl font-semibold text-card-foreground tracking-normal">
            {value}
          </div>
          {trend !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-semibold px-[7px] py-0.5 rounded-full"
              style={{
                background: isPositive
                  ? "var(--color-success-100)"
                  : isNegative
                    ? "var(--color-error-100)"
                    : "var(--muted)",
                color: isPositive
                  ? "var(--color-success-700)"
                  : isNegative
                    ? "var(--destructive)"
                    : "var(--muted-foreground)",
              }}
            >
              {isPositive ? "↑" : isNegative ? "↓" : "—"} {Math.abs(trend)}%
            </span>
          )}
        </div>
      </div>
      {trendLabel && (
        <div className="px-5 pt-2 pb-4">
          <span className="text-xs text-muted-foreground">{trendLabel}</span>
        </div>
      )}
    </div>
  )
}
