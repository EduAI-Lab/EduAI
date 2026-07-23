"use client"

import * as React from "react"
import { paletteColorAtIndex } from "./course-theme"
import { cn } from "./utils"

// ── Types ────────────────────────────────────────────────────────────────────

type QuickActionBase = {
  /** Short action title. */
  label: string
  /** One-line supporting description. */
  description: string
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

/** Navigating action: renders a link to `href`. Anchors can't be disabled. */
type QuickActionLink = QuickActionBase & {
  /** Destination path. Renders a link. */
  href: string
  onClick?: never
  disabled?: never
}

/** In-page action: renders a `<button>` that invokes `onClick`. */
type QuickActionButton = QuickActionBase & {
  /** In-page handler (opens a modal, switches a tab, ...). Renders a `<button>`. */
  onClick: () => void
  href?: never
  /** Greys out and disables the button. Only meaningful for button actions. */
  disabled?: boolean
}

/**
 * A quick action is either a link (`href`) or an in-page button (`onClick`) —
 * never both, never neither. Modelled as a union so an inert card (no target)
 * is a compile error, and `disabled` only exists where it's actually honoured.
 */
export type QuickAction = QuickActionLink | QuickActionButton

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
 * Each card is a tinted icon swatch + label + description linking to `href`
 * (or invoking `onClick` for in-page actions). Shared across Core, AI Tutor,
 * and Question Maker dashboards.
 */
export function QuickActionsPanel({ actions, LinkComponent, className }: QuickActionsPanelProps) {
  if (actions.length === 0) return null

  const LinkEl = (LinkComponent ?? "a") as React.ElementType<
    React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string; className?: string }
  >

  const cardClassName =
    "flex items-start gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 text-left shadow-[var(--shadow-2xs)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-[var(--shadow-2xs)]"

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {actions.map((action, index) => {
        const color = action.color ?? paletteColorAtIndex(index)
        const content = (
          <>
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
          </>
        )

        if (!action.href) {
          return (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={cardClassName}
            >
              {content}
            </button>
          )
        }

        const linkProps = LinkComponent ? { to: action.href } : { href: action.href }
        return (
          <LinkEl key={action.href + action.label} {...linkProps} className={cardClassName}>
            {content}
          </LinkEl>
        )
      })}
    </div>
  )
}
