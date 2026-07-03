"use client"

import * as React from "react"
import {
  IconCalendar,
  IconDotsVertical,
  IconEdit,
  IconTrash,
  IconWorldOff,
  IconWorldUpload,
} from "@tabler/icons-react"
import { CourseCardHero } from "./course-color-bar"
import { courseThemeVars, paletteColorAtIndex, type CourseAccentColor } from "./course-theme"
import { StatusBadge } from "./status-badge"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu"
import { cn } from "./utils"

// ── Types ────────────────────────────────────────────────────────────────────

export interface CourseCardAction {
  /** If true, show the publish/unpublish toggle item */
  showPublish?: boolean
  /** Current published state; required when showPublish is true */
  isPublished?: boolean
  /** Called when publish/unpublish is clicked */
  onPublishToggle?: () => void
  /** Render the publish item greyed-out and non-clickable (e.g. an admin policy
   * turned it off) instead of hiding it. `publishDisabledReason` is shown beneath. */
  publishDisabled?: boolean
  /** Muted explanation shown under a disabled publish item. */
  publishDisabledReason?: string
  /** If true, show an "Edit course" item */
  showEdit?: boolean
  /** Called when edit is clicked */
  onEdit?: () => void
  /** If true, show a destructive "Delete course" item */
  showDelete?: boolean
  /** Called when delete is clicked */
  onDelete?: () => void
  /** Render the delete item greyed-out and non-clickable instead of hiding it. */
  deleteDisabled?: boolean
  /** Muted explanation shown under a disabled delete item. */
  deleteDisabledReason?: string
}

export interface CourseCardProps {
  id: string
  code: string
  name: string
  description?: string | null
  term: string
  year?: number | string | null
  isPublished: boolean
  department?: string | null
  /** Pre-formatted department label (e.g. "Computer Science (CPSC)") */
  departmentLabel?: string | null
  /** Extra badge labels to show below the meta row (e.g. "Enrolled") */
  extraBadges?: string[]
  /** Card colour index — used when no accentColor is passed */
  colorIndex?: number
  /** Resolved accent colour (dashboard + detail should share this). */
  accentColor?: CourseAccentColor
  /** @deprecated Use accentColor */
  heroColor?: CourseAccentColor
  /** Optional display name override (e.g. student nickname) */
  displayName?: string
  /** Optional hero top-right action (e.g. customize menu) */
  heroAction?: React.ReactNode
  /** The link destination when the card title is clicked */
  href: string
  /**
   * Link component to use for navigation. Defaults to a plain <a>.
   * Pass React Router's Link to get client-side navigation:
   *   import { Link } from 'react-router'; <CourseCard LinkComponent={Link} ... />
   */
  LinkComponent?: React.ElementType<{ to: string; className?: string; children?: React.ReactNode }>
  /** Action menu configuration; pass undefined to hide the menu */
  actions?: CourseCardAction
  className?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Accent-tinted pill for course metadata */
function AccentPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full leading-none border border-[var(--course-border)] bg-[var(--course-muted)] text-foreground/80">
      {children}
    </span>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function CourseCard({
  code,
  name,
  description,
  term,
  year,
  isPublished,
  department,
  departmentLabel,
  extraBadges = [],
  colorIndex = 0,
  accentColor,
  heroColor,
  displayName,
  heroAction,
  href,
  LinkComponent,
  actions,
  className,
}: CourseCardProps) {
  const cardTitle = displayName?.trim() || name
  const resolvedAccent: CourseAccentColor =
    accentColor ?? heroColor ?? paletteColorAtIndex(colorIndex)
  const hasMenu =
    actions &&
    (actions.showPublish || actions.showEdit || actions.showDelete)

  const hasBadges =
    departmentLabel ||
    department ||
    extraBadges.length > 0

  // Render the link overlay as a React Router <Link> when provided, otherwise a plain <a>
  const titleLinkProps = LinkComponent
    ? { to: href }
    : { href }
  const TitleEl = (LinkComponent ?? "a") as React.ElementType<React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string; className?: string }>

  return (
    <div
      className={cn(
        "group/card relative flex flex-col overflow-hidden rounded-[var(--radius-xl)]",
        "border border-[var(--course-border)] bg-[var(--course-surface)]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        "transition-[transform,box-shadow,background-color] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_10px_24px_var(--course-glow)] hover:bg-[var(--course-surface-strong)]",
        className,
      )}
      style={{
        minHeight: 220,
        ...courseThemeVars(resolvedAccent),
      }}
    >
      <CourseCardHero
        index={colorIndex}
        code={code}
        accentColor={resolvedAccent}
        action={heroAction}
        className="relative"
      />

      {/* Stretched-link overlay — makes the entire card clickable */}
      <TitleEl
        {...titleLinkProps}
        className="absolute inset-0 z-0"
        aria-label={`${code} ${cardTitle}`}
      />

      {/* Card body — pointer-events-none so clicks fall through to the overlay */}
      <div className="flex flex-col flex-1 p-4 gap-3 pointer-events-none">
        {/* ── Header row: code + name + optional menu ── */}
        <div className="flex items-start gap-2">
          {/* Title text — visually styled but non-interactive (overlay handles nav) */}
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold leading-tight text-foreground line-clamp-2">
              {cardTitle}
            </div>
          </div>

          {/* Three-dot action menu — pointer-events-auto re-enables interaction above the overlay */}
          {hasMenu && (
            <div
              className="relative z-10 shrink-0 -mt-0.5 -mr-1 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Course actions"
                    className={cn(
                      // min touch target 44 × 44 px per design rules
                      "flex items-center justify-center w-11 h-11 rounded-[var(--radius-md)]",
                      "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <IconDotsVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px]">
                  {actions.showPublish && (
                    <DropdownMenuItem
                      onClick={actions.publishDisabled ? undefined : actions.onPublishToggle}
                      disabled={actions.publishDisabled}
                      className={cn(
                        "gap-2",
                        actions.publishDisabled && actions.publishDisabledReason && "flex-col items-start gap-0.5",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {actions.isPublished ? (
                          <>
                            <IconWorldOff size={15} className="text-muted-foreground" />
                            Unpublish course
                          </>
                        ) : (
                          <>
                            <IconWorldUpload size={15} className="text-[oklch(0.418_0.171_257)]" />
                            Publish course
                          </>
                        )}
                      </span>
                      {actions.publishDisabled && actions.publishDisabledReason && (
                        <span className="pl-[23px] text-[11px] text-muted-foreground">
                          {actions.publishDisabledReason}
                        </span>
                      )}
                    </DropdownMenuItem>
                  )}
                  {actions.showEdit && (
                    <DropdownMenuItem
                      onClick={actions.onEdit}
                      className="gap-2"
                    >
                      <IconEdit size={15} className="text-muted-foreground" />
                      Edit course
                    </DropdownMenuItem>
                  )}
                  {(actions.showPublish || actions.showEdit) && actions.showDelete && (
                    <DropdownMenuSeparator />
                  )}
                  {actions.showDelete && (
                    <DropdownMenuItem
                      onClick={actions.deleteDisabled ? undefined : actions.onDelete}
                      disabled={actions.deleteDisabled}
                      className={cn(
                        "gap-2 text-destructive focus:text-destructive",
                        actions.deleteDisabled && "text-muted-foreground focus:text-muted-foreground",
                        actions.deleteDisabled && actions.deleteDisabledReason && "flex-col items-start gap-0.5",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <IconTrash size={15} />
                        Delete course
                      </span>
                      {actions.deleteDisabled && actions.deleteDisabledReason && (
                        <span className="pl-[23px] text-[11px] text-muted-foreground">
                          {actions.deleteDisabledReason}
                        </span>
                      )}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* ── Description row — always occupies space ── */}
        <p
          className={cn(
            "text-[12px] leading-relaxed line-clamp-2 flex-1",
            description
              ? "text-muted-foreground"
              : "text-muted-foreground/50 italic",
          )}
        >
          {description ?? "No description yet"}
        </p>

        {/* ── Footer: term + status + optional badges ── */}
        <div className="flex flex-col gap-1.5 mt-auto">
          {/* Term + published status on the same row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <IconCalendar size={13} />
              {term} {year ?? ""}
            </span>
            <StatusBadge
              active={isPublished}
              activeLabel="Published"
              inactiveLabel="Draft"
            />
          </div>

          {/* Badges row — own dedicated row, wraps cleanly */}
          {hasBadges && (
            <div className="flex flex-wrap gap-1">
              {(departmentLabel ?? department) && (
                <AccentPill>{departmentLabel ?? department}</AccentPill>
              )}
              {extraBadges.map((label) => (
                <AccentPill key={label}>{label}</AccentPill>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
