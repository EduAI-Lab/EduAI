import { useState, useEffect, useCallback } from 'react'

export const STUB_ONLY = {
  editTopic: true, // pending #299 — no PATCH endpoint
} as const

export interface CourseTopic {
  id: string
  courseId: string
  name: string
  createdAt: string
  updatedAt: string
}

export function useCourseTopics(courseId: string) {
  const [topics, setTopics] = useState<CourseTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTopics = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/topics`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setTopics(data.topics)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch topics')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { fetchTopics() }, [fetchTopics])

  const createTopic = useCallback(async (name: string): Promise<CourseTopic> => {
    const res = await fetch(`/api/courses/${courseId}/topics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(await res.text())
    const topic = await res.json()
    setTopics((prev) => [...prev, topic])
    return topic
  }, [courseId])

  const deleteTopic = useCallback(async (topicId: string): Promise<void> => {
    const res = await fetch(`/api/courses/${courseId}/topics`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicId }),
    })
    if (!res.ok) throw new Error(await res.text())
    setTopics((prev) => prev.filter((t) => t.id !== topicId))
  }, [courseId])

  // STUB: PATCH /api/courses/:id/topics/:topicId not yet implemented (#299)
  const editTopic = useCallback(async (_topicId: string, _name: string): Promise<void> => {
    console.warn('editTopic is a stub — pending #299')
    throw new Error('Topic editing not yet available')
  }, [])

  return { topics, loading, error, createTopic, deleteTopic, editTopic, refetch: fetchTopics }
}
