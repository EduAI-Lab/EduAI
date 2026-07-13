"use client"

import * as React from "react"
import { IconSearch, IconCalendarEvent, IconFilter, IconX } from "@tabler/icons-react"
import { cn } from "./utils"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { MultiSelect } from "./ui/combobox"
import { Skeleton } from "./ui/skeleton"
import {
  groupCoursesByTerm,
  termFromMonth,
  termLabel,
  termSortKey,
  type TermInfo,
} from "./lib/term"

/** One selectable value in a filter dimension. */
export interface CourseFilterOption {
  value: string
  label: string
}

/**
 * A declarative filter dimension (Status, Term, Department, …). The list view
 * owns the selected-state, the dropdown UI, and the predicate — an app just
 * declares how to read a course's value(s) for this dimension. Use the
 * `build*FilterGroup` helpers for the common ones so every surface reads the
 * same. A course matches a group when nothing is selected, or when at least one
 * of its values is selected (values within a group are OR'd; groups are AND'd).
 */
export interface CourseFilterGroup<T> {
  /** Stable id, unique across groups. */
  id: string
  /** Human label — used as the dropdown placeholder ("Status", "Term"…). */
  label: string
  /** Course's value(s) in this dimension. `null`/`undefined`/`[]` = no value. */
  getValue: (course: T) => string | string[] | null | undefined
  /** Explicit option list. When omitted, options are derived from the courses. */
  options?: CourseFilterOption[]
  /** Label for a derived option value (ignored when `options` is given). */
  optionLabel?: (value: string) => string
  /** Sort key for a derived option (defaults to alphabetical by label). */
  optionSortKey?: (value: string) => number | string
  /** Hide the control when the courses hold ≤1 distinct value (default true). */
  hideWhenSingle?: boolean
}

/**
 * The one course-list view shared by Core, AI Tutor, and Question Maker.
 *
 * It owns the parts that must read identically everywhere — the search box,
 * the filter toolbar (declared via `filterGroups`), term grouping (canonical
 * `@eduai/ui` term model), section layout, and the loading / empty / no-results
 * states. Everything app-specific — how a course card is rendered (link vs
 * click, publish/edit actions, badges, accent) and any extra bespoke control —
 * is injected via `renderCard` and the `filters` slot. Do not fork this per app.
 */
/** One renderable section in a course list. Omit `title` to render cards with no header. */
export interface CourseListSection<T> {
  key: string
  title?: string
  /** `term` = compact UBC term header; `simple` = muted text heading (e.g. date buckets). */
  headerVariant?: "term" | "simple"
  items: T[]
}

export interface CourseListViewProps<T> {
  /** Full course list for this role. Term grouping + search + filters run over it. */
  courses: T[]
  /** Render one course card. Owns navigation, actions, badges, wrappers. */
  renderCard: (course: T, index: number) => React.ReactNode
  /** Stable React key per course. */
  getKey: (course: T) => React.Key
  /** Extract canonical term info (term/year/startDate) for grouping + ordering. */
  getTermInfo: (course: T) => TermInfo
  /**
   * Optional override for how filtered courses are sectioned. When omitted, courses
   * are grouped by canonical term code (the default shared layout).
   */
  groupSections?: (courses: T[]) => CourseListSection<T>[]
  /** Haystack (e.g. `"title code"`) matched against the search query. */
  getSearchText: (course: T) => string
  /** Declarative filter dimensions rendered as dropdowns in the toolbar. */
  filterGroups?: CourseFilterGroup<T>[]
  /** Optional role-specific predicate (status, unit, …) applied before search. */
  matchesFilter?: (course: T) => boolean
  isLoading?: boolean
  /** Custom loading UI; defaults to a skeleton card grid. */
  loadingSlot?: React.ReactNode
  searchPlaceholder?: string
  searchAriaLabel?: string
  /** Extra bespoke control(s) rendered at the end of the toolbar. */
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

/** Normalize a group value to an array of present (non-empty) strings. */
function valuesOf<T>(group: CourseFilterGroup<T>, course: T): string[] {
  const raw = group.getValue(course)
  if (raw == null) return []
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null && v !== "")
}

/**
 * Resolve the option list a group's dropdown should show: the explicit list if
 * given, otherwise the distinct values present across the courses (labelled via
 * `optionLabel`, ordered via `optionSortKey` or alphabetically).
 */
function resolveOptions<T>(
  group: CourseFilterGroup<T>,
  courses: T[],
): CourseFilterOption[] {
  if (group.options) return group.options
  const seen = new Set<string>()
  for (const course of courses) {
    for (const v of valuesOf(group, course)) seen.add(v)
  }
  const opts = Array.from(seen).map((value) => ({
    value,
    label: group.optionLabel ? group.optionLabel(value) : value,
  }))
  opts.sort((a, b) => {
    if (group.optionSortKey) {
      const ka = group.optionSortKey(a.value)
      const kb = group.optionSortKey(b.value)
      if (ka < kb) return -1
      if (ka > kb) return 1
      return 0
    }
    return a.label.localeCompare(b.label)
  })
  return opts
}

export function CourseListView<T>({
  courses,
  renderCard,
  getKey,
  getTermInfo,
  groupSections,
  getSearchText,
  filterGroups,
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
  const [selected, setSelected] = React.useState<Record<string, string[]>>({})

  // Which groups are worth rendering. A group is dropped when the courses hold
  // no value for it, or (with `hideWhenSingle`, the default) only one distinct
  // value — so a student whose courses are all Published never sees a Status
  // dropdown with nothing to choose. The dropdown still lists the full option
  // set; only the *present* distinct count gates visibility.
  const activeGroups = React.useMemo(() => {
    if (!filterGroups?.length) return []
    return filterGroups
      .map((group) => {
        const present = new Set<string>()
        for (const course of courses) {
          for (const v of valuesOf(group, course)) present.add(v)
        }
        return { group, options: resolveOptions(group, courses), present: present.size }
      })
      .filter(({ group, present }) => {
        if (present === 0) return false
        const hide = group.hideWhenSingle ?? true
        return !(hide && present <= 1)
      })
  }, [filterGroups, courses])

  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return courses.filter((course) => {
      if (matchesFilter && !matchesFilter(course)) return false
      for (const { group } of activeGroups) {
        const picked = selected[group.id]
        if (!picked?.length) continue
        const vals = valuesOf(group, course)
        if (!vals.some((v) => picked.includes(v))) return false
      }
      if (!query) return true
      return getSearchText(course).toLowerCase().includes(query)
    })
  }, [courses, search, matchesFilter, getSearchText, activeGroups, selected])

  const termGroups = React.useMemo(
    () => groupCoursesByTerm(visible, getTermInfo),
    [visible, getTermInfo],
  )
  // "Current term" reflects the real calendar date (UBC term calendar:
  // Jan–Apr W2, May–Jun S1, Jul–Aug S2, Sep–Dec W1) — not whichever term
  // happens to hold the most recently added course. A group chronologically
  // after today is "Upcoming term"; before today, "Previous term".
  const nowSortKey = React.useMemo(() => {
    const now = new Date()
    const term = termFromMonth(now.getMonth())
    // `year` is the academic-session label (S1/S2/W1 share their calendar
    // year; W2 belongs to the *previous* label, since it falls in Jan–Apr of
    // the following calendar year — see lib/term.ts's TERM_RANK comment).
    const year = term === "W2" ? now.getFullYear() - 1 : now.getFullYear()
    return termSortKey({ term, year })
  }, [])
  const termRelative = React.useMemo(() => {
    const map = new Map<string, "current" | "upcoming" | "previous">()
    for (const group of termGroups) {
      if (group.items.length === 0) continue
      const sortKey = termSortKey(getTermInfo(group.items[0]))
      map.set(
        group.label,
        sortKey === nowSortKey ? "current" : sortKey > nowSortKey ? "upcoming" : "previous",
      )
    }
    return map
  }, [termGroups, getTermInfo, nowSortKey])
  // The current term always leads, even when a course has already been
  // created for a future term (which would otherwise sort above it).
  const orderedTermGroups = React.useMemo(() => {
    const currentIndex = termGroups.findIndex((g) => termRelative.get(g.label) === "current")
    if (currentIndex <= 0) return termGroups
    const rest = termGroups.filter((_, i) => i !== currentIndex)
    return [termGroups[currentIndex], ...rest]
  }, [termGroups, termRelative])
  const sections = React.useMemo<CourseListSection<T>[]>(() => {
    if (groupSections) return groupSections(visible)
    return orderedTermGroups.map((group) => ({
      key: group.label,
      title: group.label,
      headerVariant: "term" as const,
      items: group.items,
    }))
  }, [groupSections, visible, orderedTermGroups])

  const activeFilterCount =
    Object.values(selected).reduce((n, v) => n + (v?.length ?? 0), 0)
  const hasActiveQuery = search.trim().length > 0 || activeFilterCount > 0

  const clearAll = () => {
    setSearch("")
    setSelected({})
  }

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
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72 sm:shrink-0">
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

          {activeGroups.length > 0 || filters ? (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {activeGroups.map(({ group, options }) => (
                <MultiSelect
                  key={group.id}
                  className="w-full sm:w-auto sm:min-w-40"
                  options={options}
                  value={selected[group.id] ?? []}
                  onValueChange={(next) =>
                    setSelected((prev) => ({ ...prev, [group.id]: next }))
                  }
                  placeholder={group.label}
                  searchPlaceholder={`Filter ${group.label.toLowerCase()}…`}
                />
              ))}
              {filters}
            </div>
          ) : null}
        </div>

        {hasActiveQuery ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconFilter className="h-4 w-4" aria-hidden="true" />
            <span>
              {visible.length} of {courses.length}{" "}
              {courses.length === 1 ? "course" : "courses"}
            </span>
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" className="font-normal">
                {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={clearAll}
            >
              <IconX className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        noResultsState ?? emptyState
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.key}>
              {section.title ? (
                section.headerVariant === "simple" ? (
                  <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                    {section.title}
                  </h3>
                ) : (
                  <div className="mb-4 flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-muted text-muted-foreground"
                      aria-hidden="true"
                    >
                      <IconCalendarEvent size={18} />
                    </span>
                    <div className="min-w-0">
                      {/* We lead with the compact UBC code (e.g. "2026W2") and use the
                          relative word as the subtitle — the long form
                          ("Winter Term 2 2026") reads oddly as a heading. */}
                      <h3 className="truncate text-sm font-semibold leading-tight text-foreground">
                        {section.title}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {section.title && termRelative.get(section.title) === "current"
                          ? "Current term"
                          : section.title && termRelative.get(section.title) === "upcoming"
                            ? "Upcoming term"
                            : "Previous term"}{" "}
                        · {section.items.length}{" "}
                        {section.items.length === 1 ? "course" : "courses"}
                      </p>
                    </div>
                    <div
                      className="ml-1 h-px flex-1 bg-gradient-to-r from-border to-transparent"
                      aria-hidden="true"
                    />
                  </div>
                )
              ) : null}
              <div className={gridClassName}>
                {section.items.map((course) => (
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

/**
 * Status dimension (Published / Draft) built from an `isPublished` accessor.
 * Both options always render as the canonical vocabulary, but the control is
 * hidden when the role's courses are all one status (e.g. a student's list).
 */
export function buildStatusFilterGroup<T>(
  getIsPublished: (course: T) => boolean,
  opts?: { id?: string; label?: string; hideWhenSingle?: boolean },
): CourseFilterGroup<T> {
  return {
    id: opts?.id ?? "status",
    label: opts?.label ?? "Status",
    hideWhenSingle: opts?.hideWhenSingle ?? true,
    getValue: (course) => (getIsPublished(course) ? "published" : "draft"),
    options: [
      { value: "published", label: "Published" },
      { value: "draft", label: "Draft" },
    ],
  }
}

/**
 * Term dimension built from the same `getTermInfo` used for grouping. Options
 * are the terms actually present, labelled with the compact UBC code ("2026W2")
 * to match the section headings, ordered most-recent-first.
 */
export function buildTermFilterGroup<T>(
  getTermInfo: (course: T) => TermInfo,
  opts?: { id?: string; label?: string; hideWhenSingle?: boolean },
): CourseFilterGroup<T> {
  return {
    id: opts?.id ?? "term",
    label: opts?.label ?? "Term",
    hideWhenSingle: opts?.hideWhenSingle ?? true,
    getValue: (course) => {
      const { term, year } = getTermInfo(course)
      if (!term || year == null) return null
      return `${term}::${year}`
    },
    optionLabel: (value) => {
      const [term, year] = value.split("::")
      return termLabel(term, year)
    },
    // Negate so higher (more recent) term sort keys come first.
    optionSortKey: (value) => {
      const [term, year] = value.split("::")
      return -termSortKey({ term, year: Number(year) })
    },
  }
}

/**
 * Department/discipline dimension built from a department accessor. Options are
 * the departments present, alphabetical.
 */
export function buildDepartmentFilterGroup<T>(
  getDepartment: (course: T) => string | null | undefined,
  opts?: {
    id?: string
    label?: string
    hideWhenSingle?: boolean
    /** Friendly label for a department code (e.g. "COSC" → "Computer Science"). */
    optionLabel?: (code: string) => string
  },
): CourseFilterGroup<T> {
  return {
    id: opts?.id ?? "department",
    label: opts?.label ?? "Department",
    hideWhenSingle: opts?.hideWhenSingle ?? true,
    getValue: (course) => getDepartment(course) ?? null,
    optionLabel: opts?.optionLabel,
  }
}
