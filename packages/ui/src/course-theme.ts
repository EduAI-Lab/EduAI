import type * as React from "react"

/** Default palette — matches `--color-course-*` tokens in app.css (OKLCH, both modes). */
export const DEFAULT_COURSE_PALETTE = [
  "oklch(0.56 0.20 255)",
  "oklch(0.56 0.18 145)",
  "oklch(0.60 0.18 300)",
  "oklch(0.58 0.18 48)",
  "oklch(0.55 0.16 25)",
  "oklch(0.52 0.17 210)",
] as const

/** Student-selectable swatches — moderate chroma, readable white label on hero. */
export const COURSE_COLOR_PRESETS = [
  "oklch(0.55 0.16 25)",
  "oklch(0.58 0.18 48)",
  "oklch(0.56 0.18 145)",
  "oklch(0.52 0.17 210)",
  "oklch(0.56 0.20 255)",
  "oklch(0.60 0.18 300)",
  "oklch(0.54 0.17 330)",
  "oklch(0.53 0.14 280)",
  "oklch(0.57 0.15 195)",
  "oklch(0.50 0.12 250)",
  "oklch(0.48 0.10 260)",
  "oklch(0.56 0.14 170)",
  "oklch(0.54 0.15 85)",
  "oklch(0.52 0.13 55)",
  "oklch(0.50 0.11 240)",
] as const

export type CourseAccentColor = string

export function defaultColorIndexForCourse(courseId: string): number {
  let hash = 0
  for (let i = 0; i < courseId.length; i++) {
    hash = (hash * 31 + courseId.charCodeAt(i)) >>> 0
  }
  return hash % DEFAULT_COURSE_PALETTE.length
}

export function paletteColorAtIndex(index: number): CourseAccentColor {
  return DEFAULT_COURSE_PALETTE[index % DEFAULT_COURSE_PALETTE.length]
}

export function resolvePaletteAccent(
  courseId: string,
  colorIndex?: number,
  customColor?: string,
): CourseAccentColor {
  if (customColor?.trim()) return customColor.trim()
  if (colorIndex !== undefined && colorIndex >= 0) {
    return paletteColorAtIndex(colorIndex)
  }
  return paletteColorAtIndex(defaultColorIndexForCourse(courseId))
}

/**
 * CSS custom properties for a course accent. The card body stays a neutral
 * surface (`var(--card)`) so it reads clean in light mode — the accent lives in
 * the hero, the border, and a barely-there hover tint, not a full-body wash.
 */
export function courseThemeVars(accent: CourseAccentColor): React.CSSProperties {
  return {
    "--course-accent": accent,
    "--course-surface": `var(--card)`,
    "--course-surface-strong": `color-mix(in oklch, var(--foreground) 4%, var(--card))`,
    "--course-border": `color-mix(in oklch, ${accent} 16%, var(--border))`,
    "--course-muted": `color-mix(in oklch, ${accent} 12%, transparent)`,
    "--course-glow": `color-mix(in oklch, ${accent} 28%, transparent)`,
  } as React.CSSProperties
}

export function courseHeroBackgroundStyle(accent: CourseAccentColor): React.CSSProperties {
  return {
    background: [
      `linear-gradient(`,
      `138deg,`,
      `${accent} 0%,`,
      `color-mix(in oklch, ${accent} 72%, black) 48%,`,
      `color-mix(in oklch, ${accent} 52%, black) 100%`,
      `)`,
    ].join(" "),
  }
}
