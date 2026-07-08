import { useState, useEffect, useCallback } from 'react'
import type { UserProviderSettings } from '~/lib/ai/providers'

export const STUB_ONLY = {
  deleteMaterial: true, // pending #300
} as const

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

export function useCourseMaterials(courseId: string) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMaterials = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/courses/${courseId}/materials`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setMaterials(data.materials)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch materials')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => { fetchMaterials() }, [fetchMaterials])

  const uploadMaterial = useCallback(async (file: File, apiKeys: UserProviderSettings): Promise<CourseMaterial> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('apiKeys', JSON.stringify(apiKeys))
    const res = await fetch(`/api/courses/${courseId}/materials`, {
      method: 'POST',
      body: formData,
    })
    if (!res.ok) throw new Error(await res.text())
    await fetchMaterials()
    const data = await res.json()
    return data
  }, [courseId, fetchMaterials])

  // STUB: DELETE /api/courses/:id/materials/:materialId not yet implemented (#300)
  const deleteMaterial = useCallback(async (_materialId: string): Promise<void> => {
    console.warn('deleteMaterial is a stub — pending #300')
    throw new Error('Material deletion not yet available')
  }, [])

  return { materials, loading, error, uploadMaterial, deleteMaterial, refetch: fetchMaterials }
}
