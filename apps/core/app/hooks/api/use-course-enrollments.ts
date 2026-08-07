import { useState, useEffect, useCallback } from 'react'

export interface CourseEnrollment {
  id: string
  courseId: string
  userId: string
  userEmail: string
  userName: string
  studentNumber: string | null
  role: 'INSTRUCTOR' | 'TA' | 'STUDENT'
  isActive: boolean
  enrolledAt: string | null
}

type ApiEnrollment = {
  id: string
  studentId: string
  studentEmail: string
  studentName: string
  studentNumber: string | null
  role: CourseEnrollment['role']
  isActive: boolean
  enrolledAt: string | null
}

function mapEnrollment(courseId: string, row: ApiEnrollment): CourseEnrollment {
  return {
    id: row.id,
    courseId,
    userId: row.studentId,
    userEmail: row.studentEmail,
    userName: row.studentName,
    studentNumber: row.studentNumber,
    role: row.role,
    isActive: row.isActive,
    enrolledAt: row.enrolledAt,
  }
}

/** Cursor "load more" roster (#1042) — bounded per page instead of one unbounded fetch. */
export function useCourseEnrollments(courseId: string) {
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const res = await fetch(`/api/courses/${courseId}/enrollments${query}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as {
      enrollments: ApiEnrollment[]
      nextCursor: string | null
      total: number
    }
  }, [courseId])

  const fetchEnrollments = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPage(null)
      setEnrollments(data.enrollments.map((row) => mapEnrollment(courseId, row)))
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch enrollments')
    } finally {
      setLoading(false)
    }
  }, [courseId, fetchPage])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const data = await fetchPage(nextCursor)
      setEnrollments((prev) => [...prev, ...data.enrollments.map((row) => mapEnrollment(courseId, row))])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more enrollments')
    } finally {
      setLoadingMore(false)
    }
  }, [courseId, fetchPage, nextCursor, loadingMore])

  useEffect(() => { fetchEnrollments() }, [fetchEnrollments])

  const enroll = useCallback(async (userId: string, role: CourseEnrollment['role']) => {
    const res = await fetch(`/api/courses/${courseId}/enrollments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to add enrollment')
    }
    await fetchEnrollments()
  }, [courseId, fetchEnrollments])

  const removeEnrollment = useCallback(async (enrollmentId: string) => {
    const res = await fetch(`/api/courses/${courseId}/enrollments/${enrollmentId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to remove enrollment')
    }
    setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId))
    setTotal((prev) => Math.max(0, prev - 1))
  }, [courseId])

  const updateRole = useCallback(async (enrollmentId: string, role: CourseEnrollment['role']) => {
    const res = await fetch(`/api/courses/${courseId}/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to update enrollment role')
    }
    await fetchEnrollments()
  }, [courseId, fetchEnrollments])

  return {
    enrollments,
    loading,
    error,
    total,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    enroll,
    removeEnrollment,
    updateRole,
    refetch: fetchEnrollments,
  }
}
