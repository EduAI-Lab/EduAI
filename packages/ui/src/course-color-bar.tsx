import type * as React from "react"

import {
  courseHeroBackgroundStyle,
  DEFAULT_COURSE_PALETTE,
  paletteColorAtIndex,
  type CourseAccentColor,
} from "./course-theme"

export const COURSE_COLORS = DEFAULT_COURSE_PALETTE.map(
  (_, index) => `var(--color-course-${index + 1})`,
)

export interface CourseColorBarProps {
  index: number
}

export function CourseColorBar({ index }: CourseColorBarProps) {
  return (
    <div style={{ height: 4, background: COURSE_COLORS[index % COURSE_COLORS.length] }} />
  )
}

export function courseHeroGradientStyle(color: CourseAccentColor): React.CSSProperties {
  return courseHeroBackgroundStyle(color)
}

export interface CourseCardHeroProps {
  index: number
  code: string
  /** Resolved accent colour (always pass from `resolvePaletteAccent`). */
  accentColor?: CourseAccentColor
  className?: string
  /** Optional top-right slot (e.g. student customize menu). */
  action?: React.ReactNode
}

/** Visual header band for course cards — colour ties to course detail hero. */
export function CourseCardHero({
  index,
  code,
  accentColor,
  className,
  action,
}: CourseCardHeroProps) {
  const resolved = accentColor ?? paletteColorAtIndex(index)
  return (
    <div
      data-testid="course-card-hero"
      className={className}
      style={{
        height: 56,
        ...courseHeroBackgroundStyle(resolved),
      }}
    >
      {action && (
        <div className="absolute top-1 right-1 z-20 pointer-events-auto">{action}</div>
      )}
      <div className="relative flex h-full items-end px-4 pb-2.5">
        <span className="text-sm font-bold tracking-tight text-white drop-shadow-sm">{code}</span>
      </div>
    </div>
  )
}
