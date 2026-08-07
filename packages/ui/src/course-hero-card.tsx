import type * as React from "react"
import type { CourseAccentColor } from "./course-theme"
import { HERO_GLASS_STYLE, HeroShell } from "./hero-shell"
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
  /**
   * Optional action rendered at the right end of the topics row (bottom of the
   * hero), beside the topic chips — e.g. a topic sync/create control.
   */
  topicsAction?: React.ReactNode
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
  topicsAction,
  className,
}: CourseHeroCardProps) {
  return (
    <HeroShell accentColor={accentColor} className={`mb-4${className ? ` ${className}` : ""}`}>
      {headerAction && (
        <div className="absolute top-3 right-3 z-10 pointer-events-auto">{headerAction}</div>
      )}

      {/* Top row: code/term left, role badges right. Reserve right space only
          when the absolute headerAction is present, so badges align to the
          card's normal right padding otherwise. */}
      <div className={`flex items-start justify-between gap-4 mb-1${headerAction ? " pr-8" : ""}`}>
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

      {/* Headline is the course name alone — the code already reads in the
          eyebrow above, so no "CODE: Name" repetition/separator is needed. */}
      <h1 className="text-xl font-bold mb-2 leading-snug tracking-tight">{name}</h1>

      {description && (
        <p className="text-[13px] opacity-90 leading-relaxed max-w-[560px]">{description}</p>
      )}

      {(topics.length > 0 || topicsAction) && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <span
                key={t}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full backdrop-blur-sm"
                style={HERO_GLASS_STYLE}
              >
                {t}
              </span>
            ))}
          </div>
          {topicsAction && <div className="ml-auto flex-shrink-0">{topicsAction}</div>}
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
    </HeroShell>
  )
}
