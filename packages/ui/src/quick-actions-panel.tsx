"use client"

import * as React from "react"
import { paletteColorAtIndex } from "./course-theme"
import { cn } from "./utils"

// ── Types ────────────────────────────────────────────────────────────────────

export type QuickAction = {
  /** Short action title. */
  label: string
  /** One-line supporting description. */
  description: string
  /** Destination path. */
  href: string
  /** Pre-rendered icon element (e.g. a Tabler icon). Rendered inside the swatch. */
  icon: React.ReactNode
  /**
   * Optional accent colour override (any CSS colour — hex, `oklch(...)`, or a
   * `var(--...)` token). The icon sits on a tinted swatch of this colour and
   * inherits it via `currentColor`. When omitted, a canonical colour is picked
   * from the shared course palette by position, so every app looks identical.
   */
  color?: string
}

export interface QuickActionsPanelProps {
  actions: QuickAction[]
  /**
   * Link component to use for navigation. Defaults to a plain `<a>`.
   * Pass React Router's Link to get client-side navigation:
   *   import { Link } from 'react-router'; <QuickActionsPanel LinkComponent={Link} ... />
   */
  LinkComponent?: React.ElementType<{ to: string; className?: string; children?: React.ReactNode }>
  className?: string
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Responsive grid of quick-action cards (1 column, 2 columns from `sm`).
 * Each card is a tinted icon swatch + label + description linking to `href`.
 * Shared across Core, AI Tutor, and Question Maker dashboards.
 */
export function QuickActionsPanel({ actions, LinkComponent, className }: QuickActionsPanelProps) {
  if (actions.length === 0) return null

  const LinkEl = (LinkComponent ?? "a") as React.ElementType<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string; className?: string }
  >

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {actions.map((action, index) => {
        const linkProps = LinkComponent ? { to: action.href } : { href: action.href }
        const color = action.color ?? paletteColorAtIndex(index)
        return (
          <LinkEl
            key={action.href + action.label}
            {...linkProps}
            className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 text-left shadow-[var(--shadow-2xs)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div
              className="flex size-9 flex-shrink-0 items-center justify-center rounded-lg"
              style={{ background: `color-mix(in oklch, ${color} 15%, transparent)`, color }}
            >
              {action.icon}
            </div>
            <div>
              <div className="text-[13px] font-semibold text-foreground">{action.label}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {action.description}
              </div>
            </div>
          </LinkEl>
        )
      })}
    </div>
  )
}
