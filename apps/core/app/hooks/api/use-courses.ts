import { useState, useEffect, useCallback, useRef } from 'react'

import {
  DEFAULT_PAGE_SIZE,
  initialPaginationState,
  paginationQuery,
  type PaginatedResponse,
  type PaginationState,
} from '~/hooks/api/pagination'

const SEARCH_DEBOUNCE_MS = 300

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // A new query invalidates the current offset.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
  }, [debouncedSearch])

  const fetchCourses = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = paginationQuery(pagination, {
        search: debouncedSearch,
        isActive: isActive === undefined ? undefined : String(isActive),
      })
      const res = await fetch(`/api/courses?${query}`)
      if (!res.ok) throw new Error(await res.text())
      const body: PaginatedResponse<Course> = await res.json()
      setCourses(body.data)
      setTotal(body.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch courses')
    } finally {
      setLoading(false)
    }
  }, [pagination, debouncedSearch, isActive])

  useEffect(() => {
    fetchCourses()
    const onCoursesChanged = () => { void fetchCourses() }
    window.addEventListener('eduai:courses-changed', onCoursesChanged)
    return () => window.removeEventListener('eduai:courses-changed', onCoursesChanged)
  }, [fetchCourses])

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
    await fetchCourses()
    return course
  }, [fetchCourses])

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
    // Removing a row pulls the next page's first row into this one.
    await fetchCourses()
  }, [fetchCourses])

  return {
    courses,
    total,
    pagination,
    setPagination,
    search,
    setSearch,
    loading,
    error,
    createCourse,
    updateCourse,
    deleteCourse,
    refetch: fetchCourses,
  }
}
