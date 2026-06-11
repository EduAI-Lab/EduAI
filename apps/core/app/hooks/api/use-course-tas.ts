import { useState, useEffect, useCallback } from 'react'

export interface CourseTA {
  id: string
  courseId: string
  userId: string
  user: { id: string; name: string; email: string }
  createdAt: string
}

export function useCourseTAs(courseId: string) {
  const [tas, setTAs] = useState<CourseTA[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTAs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/tas`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setTAs(data.tas)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch TAs')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { fetchTAs() }, [fetchTAs])

  const addTA = useCallback(async (userId: string) => {
    const res = await fetch(`/api/courses/${courseId}/tas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to add TA')
    }
    await fetchTAs()
  }, [courseId, fetchTAs])

  const removeTA = useCallback(async (userId: string) => {
    const res = await fetch(`/api/courses/${courseId}/tas`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to remove TA')
    }
    setTAs((prev) => prev.filter((ta) => ta.userId !== userId))
  }, [courseId])

  return { tas, loading, error, addTA, removeTA, refetch: fetchTAs }
}
