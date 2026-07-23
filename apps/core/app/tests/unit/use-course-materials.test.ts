import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCourseMaterials } from '~/hooks/api/use-course-materials'

const material = {
  id: 'mat-1',
  courseId: 'course-1',
  title: 'Week 1 slides',
  mimeType: 'application/pdf',
  fileSize: 1024,
  status: 'READY',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  processedAt: '2025-01-01T00:00:00.000Z',
}

function materialsResponse(materials: unknown[]) {
  return new Response(JSON.stringify({ materials }), { status: 200 })
}

describe('useCourseMaterials.deleteMaterial', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('DELETEs the material and refetches the list', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(materialsResponse([]))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.materials).toHaveLength(1)

    await act(async () => {
      await result.current.deleteMaterial('mat-1')
    })

    expect(fetch).toHaveBeenNthCalledWith(2, '/api/courses/course-1/materials/mat-1', {
      method: 'DELETE',
    })
    await waitFor(() => expect(result.current.materials).toEqual([]))
  })

  it('throws the API error body and leaves the list untouched', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.deleteMaterial('mat-1')).rejects.toThrow('Forbidden')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.materials).toHaveLength(1)
  })
})
