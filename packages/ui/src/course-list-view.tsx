"use client"

import * as React from "react"
import { IconSearch } from "@tabler/icons-react"
import { cn } from "./utils"
import { Input } from "./ui/input"
import { Skeleton } from "./ui/skeleton"
import { groupCoursesByTerm, type TermInfo } from "./lib/term"

/**
 * The one course-list view shared by Core, AI Tutor, and Question Maker.
 *
 * It owns the parts that must read identically everywhere — the search box,
 * term grouping (canonical `@eduai/ui` term model), section layout, and the
 * loading / empty / no-results states. Everything app-specific — how a course
 * card is rendered (link vs click, publish/edit actions, badges, accent) and
 * any role-specific filter control — is injected via `renderCard`, the
 * `filters` slot, and `matchesFilter`. Do not fork this per app.
 */
export interface CourseListViewProps<T> {
  /** Full course list for this role. Term grouping + search run over it. */
  courses: T[]
  /** Render one course card. Owns navigation, actions, badges, wrappers. */
  renderCard: (course: T, index: number) => React.ReactNode
  /** Stable React key per course. */
  getKey: (course: T) => React.Key
  /** Extract canonical term info (term/year/startDate) for grouping + ordering. */
  getTermInfo: (course: T) => TermInfo
  /** Haystack (e.g. `"title code"`) matched against the search query. */
  getSearchText: (course: T) => string
  /** Optional role-specific predicate (status, unit, …) applied before search. */
  matchesFilter?: (course: T) => boolean
  isLoading?: boolean
  /** Custom loading UI; defaults to a skeleton card grid. */
  loadingSlot?: React.ReactNode
  searchPlaceholder?: string
  searchAriaLabel?: string
  /** Role-specific filter control(s) rendered at the end of the toolbar. */
  filters?: React.ReactNode
  /** Shown when the role has no courses at all. */
  emptyState?: React.ReactNode
  /** Shown when search/filter matches nothing; falls back to `emptyState`. */
  noResultsState?: React.ReactNode
  /** Override the responsive card grid classes. */
  gridClassName?: string
  className?: string
}

const DEFAULT_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"

function DefaultLoading({ gridClassName }: { gridClassName: string }) {
  return (
    <div className={gridClassName}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-44 rounded-[var(--radius-xl)]" />
      ))}
    </div>
  )
}

export function CourseListView<T>({
  courses,
  renderCard,
  getKey,
  getTermInfo,
  getSearchText,
  matchesFilter,
  isLoading = false,
  loadingSlot,
  searchPlaceholder = "Search courses by title or code",
  searchAriaLabel = "Search courses",
  filters,
  emptyState = null,
  noResultsState,
  gridClassName = DEFAULT_GRID,
  className,
}: CourseListViewProps<T>) {
  const [search, setSearch] = React.useState("")

  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return courses.filter((course) => {
      if (matchesFilter && !matchesFilter(course)) return false
      if (!query) return true
      return getSearchText(course).toLowerCase().includes(query)
    })
  }, [courses, search, matchesFilter, getSearchText])

  const groups = React.useMemo(
    () => groupCoursesByTerm(visible, getTermInfo),
    [visible, getTermInfo],
  )
  const multipleTerms = groups.length > 1

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        {loadingSlot ?? <DefaultLoading gridClassName={gridClassName} />}
      </div>
    )
  }

  // No courses at all for this role — no toolbar, just the empty state.
  if (courses.length === 0) {
    return <div className={cn("space-y-6", className)}>{emptyState}</div>
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm sm:flex-1">
          <IconSearch
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            aria-label={searchAriaLabel}
          />
        </div>
        {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
      </div>

      {visible.length === 0 ? (
        noResultsState ?? emptyState
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.label}>
              {multipleTerms ? (
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{group.labelLong}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {group.items.length}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <div className={gridClassName}>
                {group.items.map((course) => (
                  <React.Fragment key={getKey(course)}>
                    {renderCard(course, courses.indexOf(course))}
                  </React.Fragment>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
