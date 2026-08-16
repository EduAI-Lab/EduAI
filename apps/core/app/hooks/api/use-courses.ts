import { useState, useEffect, useCallback, useRef } from 'react'

import {
  DEFAULT_PAGE_SIZE,
  initialPaginationState,
  paginationQuery,
  type PaginatedResponse,
  type PaginationState,
} from '~/hooks/api/pagination'

const SEARCH_DEBOUNCE_MS = 300

/** Filter-group ids the Core course list exposes (matches `build*FilterGroup` in @eduai/ui). */
export const COURSE_FILTER_KEYS = ["status", "term", "department"] as const
export type CourseFilterKey = (typeof COURSE_FILTER_KEYS)[number]
export type CourseFilters = Record<CourseFilterKey, string[]>

const EMPTY_FILTERS: CourseFilters = { status: [], term: [], department: [] }

export interface Course {
  id: string
  code: string
  name: string
  description: string | null
  term: string
  year: number
  isActive: boolean
  isPublished: boolean
  aiInstructions: string
  responseStyleTags?: string[]
  instructorId: string | null
  department: string | null
  startDate: string
  endDate: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCourseInput {
  name: string
  code: string
  section: string
  term: string
  year: number
  startDate: string
  department?: string
  aiInstructions?: string
  instructorUserIds: string[]
}

export interface UpdateCourseInput {
  name?: string
  code?: string
  term?: string
  year?: number
  department?: string | null
  aiInstructions?: string
  isPublished?: boolean
  instructorId?: string
}

export interface UseCoursesOptions {
  /** Rows per request. Callers that only need `total` should pass 1. */
  pageSize?: number
  /** Restrict to active/inactive courses; omit for both. */
  isActive?: boolean
}

/**
 * Server-paginated course list (#1041).
 *
 * `/api/courses` requires `page`/`pageSize`, so there is no "give me every
 * course" mode. Callers that need an aggregate read `total` instead of counting
 * the rows they were handed.
 */
export function useCourses(options: UseCoursesOptions = {}) {
  const { pageSize = DEFAULT_PAGE_SIZE, isActive } = options

  const [courses, setCourses] = useState<Course[]>([])
  const [total, setTotal] = useState(0)
  const [pagination, setPagination] = useState<PaginationState>(initialPaginationState(pageSize))
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedFilters, setSelectedFilters] = useState<CourseFilters>(EMPTY_FILTERS)
  const [availableValues, setAvailableValues] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // A new query (search or any filter) invalidates the current offset.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [debouncedSearch, selectedFilters])

  // Monotonic request id so a slower, older response never overwrites the state
  // a newer query already committed (rapid search/filter changes race otherwise).
  const requestSeq = useRef(0)

  const fetchCourses = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams(
        paginationQuery(pagination, {
          search: debouncedSearch,
          isActive: isActive === undefined ? undefined : String(isActive),
        }),
      )
      for (const key of COURSE_FILTER_KEYS) {
        for (const value of selectedFilters[key]) params.append(key, value)
      }
      const res = await fetch(`/api/courses?${params.toString()}`)
      if (!res.ok) throw new Error(await res.text())
      const body: PaginatedResponse<Course> = await res.json()
      if (seq !== requestSeq.current) return
      setCourses(body.data)
      setTotal(body.total)
      // A shrink in the filtered total (search/filter/delete) can strand the
      // current page past the end. Clamp to the last valid page; the changed
      // `pagination` triggers one refetch, and the guard prevents loops.
      setPagination((prev) => {
        const lastPageIndex = Math.max(0, Math.ceil(body.total / prev.pageSize) - 1)
        return prev.pageIndex > lastPageIndex ? { ...prev, pageIndex: lastPageIndex } : prev
      })
    } catch (e) {
      if (seq !== requestSeq.current) return
      setError(e instanceof Error ? e.message : 'Failed to fetch courses')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [pagination, debouncedSearch, isActive, selectedFilters])

  // Facets are best-effort metadata for the dropdowns: a failure must never
  // block the list, so errors are swallowed and the toolbar falls back to the
  // values already present on the loaded rows.
  const fetchFacets = useCallback(async () => {
    try {
      const res = await fetch('/api/courses/facets')
      if (!res.ok) return
      const body: CourseFilters = await res.json()
      setAvailableValues(body)
    } catch {
      // ignore — dropdowns derive from the current page in the worst case
    }
  }, [])

  useEffect(() => {
    fetchCourses()
    fetchFacets()
    const onCoursesChanged = () => {
      void fetchCourses()
      void fetchFacets()
    }
    window.addEventListener('eduai:courses-changed', onCoursesChanged)
    return () => window.removeEventListener('eduai:courses-changed', onCoursesChanged)
  }, [fetchCourses, fetchFacets])

  const setFilter = useCallback((key: CourseFilterKey, values: string[]) => {
    setSelectedFilters((prev) => ({ ...prev, [key]: values }))
  }, [])

  const clearFilters = useCallback(() => {
    setSelectedFilters(EMPTY_FILTERS)
  }, [])

  const createCourse = useCallback(async (input: CreateCourseInput): Promise<Course> => {
    const formData = new FormData()
    formData.append('name', input.name)
    formData.append('code', input.code)
    formData.append('section', input.section)
    formData.append('term', input.term)
    formData.append('year', String(input.year))
    formData.append('startDate', input.startDate)
    if (input.department) formData.append('department', input.department)
    if (input.aiInstructions) formData.append('aiInstructions', input.aiInstructions)
    input.instructorUserIds.forEach((id) => formData.append('instructorUserIds', id))
    const res = await fetch('/api/courses', { method: 'POST', body: formData })
    if (!res.ok) throw new Error(await res.text())
    const course = await res.json()
    // Where the new row lands depends on the current sort/page, so refetch.
    // A new course can also add a term/department the dropdowns haven't seen.
    await fetchCourses()
    await fetchFacets()
    return course
  }, [fetchCourses, fetchFacets])

  const updateCourse = useCallback(async (id: string, input: UpdateCourseInput): Promise<Course> => {
    const res = await fetch(`/api/courses/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setCourses((prev) => prev.map((c) => (c.id === id ? updated : c)))
    return updated
  }, [])

  const deleteCourse = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/courses/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await res.text())
    // Removing a row pulls the next page's first row into this one, and can
    // remove a facet value entirely.
    await fetchCourses()
    await fetchFacets()
  }, [fetchCourses, fetchFacets])

  return {
    courses,
    total,
    pagination,
    setPagination,
    search,
    setSearch,
    selectedFilters,
    setFilter,
    clearFilters,
    availableValues,
    loading,
    error,
    createCourse,
    updateCourse,
    deleteCourse,
    refetch: fetchCourses,
  }
}
