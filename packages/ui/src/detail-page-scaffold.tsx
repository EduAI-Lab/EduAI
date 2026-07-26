import type * as React from "react"

/**
 * The 3 observed outer-wrapper variants across the 8 detail surfaces
 * (Core manager/ta/student, QM CourseDetailPage, ai-tutor course/module
 * routes). "none" keeps the bare Core wrapper (no page padding — Core's
 * shell already pads), "qm" and "app" mirror the two extensions' route
 * padding.
 */
const PADDING_CLASSES = {
  none: "flex flex-col gap-6",
  qm: "flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6",
  app: "flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6",
} as const

export interface DetailPageScaffoldProps {
  /** The page's hero — CourseHeroCard, ModuleHero, etc. Scaffold does not own it. */
  hero: React.ReactNode
  /** Everything else: tab shells, content grids, sibling dialogs/modals. */
  children: React.ReactNode
  /** Selects the outer wrapper classes. Defaults to "none". */
  padding?: keyof typeof PADDING_CLASSES
  /** Passthrough for e.g. Core student view's `courseThemeVars(accentColor)`. */
  style?: React.CSSProperties
  /** Rendered before the hero — e.g. QM's `CourseNoAccessAlert`. */
  beforeHero?: React.ReactNode
}

export function DetailPageScaffold({
  hero,
  children,
  padding = "none",
  style,
  beforeHero,
}: DetailPageScaffoldProps) {
  return (
    <div className={PADDING_CLASSES[padding]} style={style}>
      {beforeHero}
      {hero}
      {children}
    </div>
  )
}
