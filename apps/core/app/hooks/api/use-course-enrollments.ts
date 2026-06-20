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

export function useCourseEnrollments(courseId: string) {
  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchEnrollments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/enrollments`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { enrollments: ApiEnrollment[] }
      setEnrollments(data.enrollments.map((row) => mapEnrollment(courseId, row)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch enrollments')
    } finally {
      setLoading(false)
    }
  }, [courseId])

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
    enroll,
    removeEnrollment,
    updateRole,
    refetch: fetchEnrollments,
  }
}
