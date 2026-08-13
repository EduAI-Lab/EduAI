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

function materialsResponse(materials: unknown[], nextCursor: string | null = null) {
  return new Response(JSON.stringify({ materials, nextCursor }), { status: 200 })
}

describe('useCourseMaterials.fetchMaterials', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not fetch when courseId is empty and stays loading', async () => {
    const { result } = renderHook(() => useCourseMaterials(''))

    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(true)
  })

  it('loads the first page on mount and exposes hasMore from nextCursor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], 'cursor-2'))

    const { result } = renderHook(() => useCourseMaterials('course-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.materials).toEqual([material])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.error).toBeNull()
    expect(fetch).toHaveBeenCalledWith('/api/courses/course-1/materials')
  })

  it('hasMore is false once the server returns a null cursor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], null))

    const { result } = renderHook(() => useCourseMaterials('course-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(false)
  })

  it('surfaces the server error text and clears loading on a failed initial fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Not found', { status: 404 }))

    const { result } = renderHook(() => useCourseMaterials('course-1'))

    await waitFor(() => expect(result.current.error).toBe('Not found'))
    expect(result.current.loading).toBe(false)
    expect(result.current.materials).toEqual([])
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce('offline')

    const { result } = renderHook(() => useCourseMaterials('course-1'))

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch materials'))
  })

  it('refetch reloads the list via the exposed refetch alias', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material]))
      .mockResolvedValueOnce(materialsResponse([]))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.materials).toHaveLength(1)

    await act(async () => {
      await result.current.refetch()
    })

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.current.materials).toEqual([])
  })
})

describe('useCourseMaterials.loadMore', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('appends the next page and updates the cursor', async () => {
    const material2 = { ...material, id: 'mat-2' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material], 'cursor-2'))
      .mockResolvedValueOnce(materialsResponse([material2], null))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasMore).toBe(true)

    await act(async () => {
      await result.current.loadMore()
    })

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/courses/course-1/materials?cursor=cursor-2',
    )
    expect(result.current.materials).toEqual([material, material2])
    expect(result.current.hasMore).toBe(false)
    expect(result.current.loadingMore).toBe(false)
  })

  it('is a no-op when there is no next cursor', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(materialsResponse([material], null))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.loadMore()
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('sets an error and clears loadingMore when the next page fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([material], 'cursor-2'))
      .mockResolvedValueOnce(new Response('server error', { status: 500 }))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.loadMore()
    })

    expect(result.current.error).toBe('server error')
    expect(result.current.loadingMore).toBe(false)
    // The already-loaded page is left in place.
    expect(result.current.materials).toEqual([material])
  })
})

describe('useCourseMaterials.uploadMaterial', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs the file as FormData, refetches, and resolves with the created row', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([]))
      .mockResolvedValueOnce(new Response(JSON.stringify(material), { status: 201 }))
      .mockResolvedValueOnce(materialsResponse([material]))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const file = new File(['content'], 'slides.pdf', { type: 'application/pdf' })
    let uploaded: unknown
    await act(async () => {
      uploaded = await result.current.uploadMaterial(file)
    })

    const [url, init] = vi.mocked(fetch).mock.calls[1]
    expect(url).toBe('/api/courses/course-1/materials')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).body).toBeInstanceOf(FormData)
    expect(uploaded).toEqual(material)
    expect(result.current.materials).toEqual([material])
  })

  it('throws the server error text and does not refetch on failure', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(materialsResponse([]))
      .mockResolvedValueOnce(new Response('File too large', { status: 413 }))

    const { result } = renderHook(() => useCourseMaterials('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const file = new File(['content'], 'slides.pdf', { type: 'application/pdf' })
    await expect(result.current.uploadMaterial(file)).rejects.toThrow('File too large')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

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
