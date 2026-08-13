import { useCallback, useEffect, useRef, useState } from 'react'

export interface StudentCandidate {
  id: string
  name: string
  email: string
}

const SEARCH_DEBOUNCE_MS = 250

/**
 * Search-select backend for the "add student" / "add TA" pickers. It uses
 * the paginated users API rather than preloading the platform-wide STUDENT
 * list in the course loader.
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
        const params = new URLSearchParams({
          courseId,
          exclude,
          page: '1',
          pageSize: '25',
          role: 'STUDENT',
          isActive: 'true',
        })
        if (query.trim()) params.set('search', query.trim())
        const res = await fetch(`/api/users?${params}`)
        if (!res.ok) throw new Error(await res.text())
        const data = (await res.json()) as { data: StudentCandidate[] }
        if (requestId !== requestIdRef.current) return
        setCandidates(data.data)
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
