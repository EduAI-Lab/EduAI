import type * as React from "react"
import { courseHeroBackgroundStyle, courseThemeVars, type CourseAccentColor } from "./course-theme"

/**
 * Shared "hero" surface used by every course/module/lesson-tier banner
 * (`CourseHeroCard`, ai-tutor's `ModuleHero`, etc.): the solid course-accent
 * gradient, white text, `radius-xl` corners, `p-6` padding, and the
 * accent-tinted glow shadow. Callers own everything inside — eyebrow,
 * headline, badges, watermark, whatever makes that tier distinct.
 */
export interface HeroShellProps {
  /** Resolved accent — must match the course card on the dashboard. */
  accentColor: CourseAccentColor
  /** Extra classes appended after the shell's own (e.g. spacing overrides). */
  className?: string
  children?: React.ReactNode
}

export function HeroShell({ accentColor, className, children }: HeroShellProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-[var(--radius-xl)] p-6 text-white shadow-[0_8px_28px_var(--course-glow)]${className ? ` ${className}` : ""}`}
      style={{
        ...courseThemeVars(accentColor),
        ...courseHeroBackgroundStyle(accentColor),
      }}
    >
      {children}
    </div>
  )
}

/** Translucent-white glass, used for badges/chips laid over the hero shell. */
export const HERO_GLASS_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.16)",
  border: "1px solid rgba(255,255,255,0.28)",
}
