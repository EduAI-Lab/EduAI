import type * as React from "react"

import {
  courseHeroBackgroundStyle,
  DEFAULT_COURSE_PALETTE,
  paletteColorAtIndex,
  type CourseAccentColor,
} from "./course-theme"

/**
 * Course accent swatches. `course-theme.ts` is the single owner of these
 * values — course colours are per-course content identity rather than theme,
 * they have no dark-mode variant, and they are consumed from TS far more than
 * from CSS. This previously mapped the palette only to discard every value and
 * emit `var(--color-course-N)` from a parallel copy in the stylesheets.
 */
export const COURSE_COLORS: readonly CourseAccentColor[] = DEFAULT_COURSE_PALETTE

export interface CourseColorBarProps {
  index: number
}

export function CourseColorBar({ index }: CourseColorBarProps) {
  return (
    <div
      style={
        {
          height: 4,
          "--course-bar": COURSE_COLORS[index % COURSE_COLORS.length],
          background: "var(--course-bar)",
        } as React.CSSProperties
      }
    />
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
