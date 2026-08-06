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
  /**
   * Opt into a search box above the list (#1143). Presentational only: the host
   * app owns the query and re-fetches `courses` itself, so this component never
   * filters — it renders exactly what it is given. Callers that page a large
   * course list server-side need this, since the dropdown otherwise only ever
   * shows the first page. Omit it and the switcher renders as before.
   */
  onQueryChange?: (query: string) => void
  searchPlaceholder?: string
  /** Shown in place of the list when `courses` is empty and search is enabled. */
  emptyLabel?: string
  /**
   * Trigger label to fall back to when `currentId` isn't in `courses`. Required
   * for search-driven hosts: once the result set narrows to something the
   * current course doesn't match, deriving the label from the list alone drops
   * the breadcrumb to "Select course" while the user is still sitting on that
   * course.
   */
  currentLabel?: string
  /**
   * A search request is in flight, so an empty `courses` means "not known yet",
   * not "nothing matched". Without this the only signal the list has is its own
   * emptiness, so a host that clears rows while fetching would flash
   * `emptyLabel` ("No courses match") on every keystroke — the exact false
   * negative server-side search exists to remove. Purely presentational: the
   * host owns the pending state, same as it owns the query.
   */
  loading?: boolean
  /** Shown in place of the list while `loading` and no rows are held. */
  loadingLabel?: string
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
  onQueryChange,
  searchPlaceholder = "Search courses…",
  emptyLabel = "No courses found",
  currentLabel,
  loading = false,
  loadingLabel = "Searching…",
}: CourseSwitcherProps) {
  const current = courses.find((c) => c.id === currentId) ?? null
  const label = current?.label ?? currentLabel ?? "Select course"
  const searchable = Boolean(onQueryChange)
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Clear the query when the menu closes so reopening doesn't show a stale
  // result set under an empty-looking box.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next && searchable && query !== "") {
      setQuery("")
      onQueryChange?.("")
    }
  }

  // Radix focuses the first menu item on open, which would send typing to the
  // menu's own typeahead. Take focus back once it has settled.
  React.useEffect(() => {
    if (!open || !searchable) return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open, searchable])

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
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          aria-label="Switch course"
          className="inline-flex shrink-0 items-center rounded-md px-1 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <IconChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {searchable && (
            <div className="px-2 pt-1 pb-2">
              <input
                ref={inputRef}
                type="text"
                role="searchbox"
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  onQueryChange?.(e.target.value)
                }}
                // Radix's menu typeahead swallows printable keys, and its
                // arrow/Home/End handling would move focus out of the input.
                onKeyDown={(e) => e.stopPropagation()}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
              />
            </div>
          )}
          <DropdownMenuLabel className="text-xs text-muted-foreground">{listLabel}</DropdownMenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {searchable && courses.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                {loading ? loadingLabel : emptyLabel}
              </p>
            )}
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
                      active ? "text-primary-text opacity-100" : "opacity-0",
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
