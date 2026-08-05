import { useState, useEffect, useCallback } from 'react'

export interface CourseMaterial {
  id: string
  courseId: string
  title: string
  mimeType: string
  fileSize: number
  status: 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
  updatedAt: string
  processedAt: string | null
  chunkCount?: number
  // uploadedBy will be available after #300 schema update
  uploadedBy?: string
  /** Student-visibility gate (staff-only field). See #839. */
  visibleToStudents?: boolean
  /** Scheduled reveal timestamp (ISO) or null. Staff-only. See #839. */
  availableAt?: string | null
}

/** Cursor "load more" course materials (#1042) — bounded per page instead of one unbounded fetch. */
export function useCourseMaterials(courseId: string) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const res = await fetch(`/api/courses/${courseId}/materials${query}`)
    if (!res.ok) throw new Error(await res.text())
    return (await res.json()) as { materials: CourseMaterial[]; nextCursor: string | null }
  }, [courseId])

  const fetchMaterials = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPage(null)
      setMaterials(data.materials)
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch materials')
    } finally {
      setLoading(false)
    }
  }, [courseId, fetchPage])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(nextCursor)
      setMaterials((prev) => [...prev, ...data.materials])
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more materials')
    } finally {
      setLoadingMore(false)
    }
  }, [fetchPage, nextCursor, loadingMore])

  useEffect(() => { fetchMaterials() }, [fetchMaterials])

  const uploadMaterial = useCallback(async (file: File): Promise<CourseMaterial> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`/api/courses/${courseId}/materials`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) throw new Error(await res.text())
    await fetchMaterials()
    const data = await res.json()
    return data
  }, [courseId, fetchMaterials])

  const deleteMaterial = useCallback(async (materialId: string): Promise<void> => {
    const res = await fetch(`/api/courses/${courseId}/materials/${materialId}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(await res.text())
    await fetchMaterials()
  }, [courseId, fetchMaterials])

  return {
    materials,
    loading,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    uploadMaterial,
    deleteMaterial,
    refetch: fetchMaterials,
  }
}
