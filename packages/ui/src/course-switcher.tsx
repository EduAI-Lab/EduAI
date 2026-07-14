/**
 * Inline course switcher for the workspace breadcrumb, shared across Core,
 * QuestionMaker, and AI Tutor (issue #764). Jump between courses without leaving
 * the current view — GitHub-repo-switcher style. Presentational: the host app
 * supplies the course options and the navigation callbacks, so the look and
 * interaction are identical everywhere while routing stays app-specific.
 */
import * as React from "react"
import { IconChevronDown, IconCheck, IconLayoutGrid } from "@tabler/icons-react"

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "./ui/dropdown-menu"
import { cn } from "./utils"

export type CourseSwitcherId = string | number

export interface CourseSwitcherOption {
  id: CourseSwitcherId
  /** Primary label (course code, or name when there's no code). */
  label: string
  /** Secondary label (full course name), shown under the label. */
  sublabel?: string
}

export interface CourseSwitcherProps {
  courses: CourseSwitcherOption[]
  currentId: CourseSwitcherId
  onSelect: (id: CourseSwitcherId) => void
  /**
   * Click the course name to open the current course's overview. When provided,
   * the name renders as its own clickable control, split from the dropdown arrow
   * so the two actions (open vs. switch) are separate hit targets.
   */
  onOpenCurrent?: () => void
  /** Renders a trailing "view all" row when provided (e.g. go to /courses). */
  onViewAll?: () => void
  viewAllLabel?: string
  listLabel?: string
  className?: string
}

export function CourseSwitcher({
  courses,
  currentId,
  onSelect,
  onOpenCurrent,
  onViewAll,
  viewAllLabel = "All courses",
  listLabel = "Your courses",
  className,
}: CourseSwitcherProps) {
  const current = courses.find((c) => c.id === currentId) ?? null
  const label = current?.label ?? "Select course"

  return (
    <div
      className={cn(
        "inline-flex max-w-[16rem] items-center rounded-md text-sm font-semibold text-foreground",
        className,
      )}
    >
      {onOpenCurrent ? (
        <button
          type="button"
          onClick={() => onOpenCurrent()}
          className="min-w-0 truncate rounded-md px-2 py-1 outline-none transition-colors hover:bg-muted hover:underline focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 truncate px-2 py-1">{label}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch course"
          className="inline-flex shrink-0 items-center rounded-md px-1 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <IconChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{listLabel}</DropdownMenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {courses.map((c) => {
              const active = c.id === currentId
              return (
                <DropdownMenuItem
                  key={c.id}
                  onSelect={() => {
                    if (c.id !== currentId) onSelect(c.id)
                  }}
                  className="flex items-start gap-2"
                >
                  <IconCheck
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      active ? "text-primary opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{c.label}</span>
                    {c.sublabel && c.sublabel !== c.label && (
                      <span className="truncate text-xs text-muted-foreground">{c.sublabel}</span>
                    )}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </div>
          {onViewAll && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onViewAll()} className="gap-2">
                <IconLayoutGrid className="size-4" />
                {viewAllLabel}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
