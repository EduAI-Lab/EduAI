import { useCallback, useEffect, useRef, useState } from 'react'

export interface StudentCandidate {
  id: string
  name: string
  email: string
}

const SEARCH_DEBOUNCE_MS = 250

/**
 * Search-select backend for the "add student" / "add TA" pickers (#1042).
 * Backed by `GET /api/courses/:courseId/student-candidates`, which bounds
 * results to a small `limit` instead of the platform-wide STUDENT list this
 * used to preload.
 */
export function useStudentCandidates(courseId: string | undefined, exclude: 'enrolled' | 'ta') {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<StudentCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Guards against an in-flight request from a stale keystroke resolving after
  // a newer one and clobbering fresher results (#1042 review).
  const requestIdRef = useRef(0)

  const search = useCallback((next: string) => {
    setQuery(next)
  }, [])

  useEffect(() => {
    if (!courseId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      try {
        const params = new URLSearchParams({ exclude })
        if (query.trim()) params.set('q', query.trim())
        const res = await fetch(`/api/courses/${courseId}/student-candidates?${params}`)
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as { candidates: StudentCandidate[] }
        if (requestId !== requestIdRef.current) return
        setCandidates(data.candidates)
      } catch {
        if (requestId !== requestIdRef.current) return
        setCandidates([])
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [courseId, exclude, query])

  return { candidates, loading, search }
}
