import type * as React from "react"
import { courseHeroBackgroundStyle, courseThemeVars, type CourseAccentColor } from "./course-theme"
import { termLabel } from "./lib/term"

export interface CourseHeroCardProps {
  code: string
  term: string
  year?: string | number | null
  name: string
  description?: string | null
  badges?: string[]
  topRightBadges?: string[]
  topics?: string[]
  /** Resolved accent — must match the course card on the dashboard. */
  accentColor: CourseAccentColor
  /** Optional top-right slot (customize menu, etc.). */
  headerAction?: React.ReactNode
  className?: string
}

export function CourseHeroCard({
  code,
  term,
  year,
  name,
  description,
  badges = [],
  topRightBadges = [],
  topics = [],
  accentColor,
  headerAction,
  className,
}: CourseHeroCardProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius-xl)] p-6 text-white mb-4 shadow-[0_8px_28px_var(--course-glow)]${className ? ` ${className}` : ""}`}
      style={{
        ...courseThemeVars(accentColor),
        ...courseHeroBackgroundStyle(accentColor),
      }}
    >
      {headerAction && (
        <div className="absolute top-3 right-3 z-10 pointer-events-auto">{headerAction}</div>
      )}

      {/* Top row: code/term left, role badges right */}
      <div className="flex items-start justify-between gap-4 mb-1 pr-8">
        <div className="text-[11px] opacity-80 font-semibold uppercase tracking-widest">
          {code} · {termLabel(term, year)}
        </div>
        {topRightBadges.length > 0 && (
          <div className="flex gap-2 flex-shrink-0">
            {topRightBadges.map((label) => (
              <span
                key={label}
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full backdrop-blur-sm"
                style={{ background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.28)" }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <h1 className="text-xl font-bold mb-2 leading-snug tracking-tight">{code}: {name}</h1>

      {description && (
        <p className="text-[13px] opacity-90 leading-relaxed max-w-[560px]">{description}</p>
      )}

      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-4">
          {topics.map((t) => (
            <span
              key={t}
              className="text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur-sm"
              style={{ background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {badges.length > 0 && (
        <div className="flex gap-2 mt-4">
          {badges.map((label) => (
            <span
              key={label}
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
