import { useState, useEffect, useCallback } from 'react'

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
  professorId: string
  department: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCourseInput {
  name: string
  code: string
  term: string
  year: number
  department?: string
  aiInstructions?: string
}

export interface UpdateCourseInput {
  name?: string
  code?: string
  term?: string
  year?: number
  aiInstructions?: string
  isPublished?: boolean
}

export function useCourses() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCourses = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/courses')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setCourses(data.courses)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch courses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCourses() }, [fetchCourses])

  const createCourse = useCallback(async (input: CreateCourseInput): Promise<Course> => {
    const formData = new FormData()
    formData.append('name', input.name)
    formData.append('code', input.code)
    formData.append('term', input.term)
    formData.append('year', String(input.year))
    if (input.department) formData.append('department', input.department)
    if (input.aiInstructions) formData.append('aiInstructions', input.aiInstructions)
    const res = await fetch('/api/courses', { method: 'POST', body: formData })
    if (!res.ok) throw new Error(await res.text())
    const course = await res.json()
    setCourses((prev) => [...prev, course])
    return course
  }, [])

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
    setCourses((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return { courses, loading, error, createCourse, updateCourse, deleteCourse, refetch: fetchCourses }
}
