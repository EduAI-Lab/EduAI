import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useCourseTAs } from '~/hooks/api/use-course-tas'

const ta = {
  id: 'ta-1',
  courseId: 'course-1',
  userId: 'user-1',
  user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
  createdAt: '2025-01-01T00:00:00.000Z',
}

function tasResponse(tas: unknown[]) {
  return new Response(JSON.stringify({ tas }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

let mockFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useCourseTAs', () => {
  it('fetches the TA list for the course on mount', async () => {
    mockFetch.mockResolvedValueOnce(tasResponse([ta]))

    const { result } = renderHook(() => useCourseTAs('course-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tas).toEqual([ta])
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/tas')
  })

  it('surfaces a failed list read as an error and leaves the list empty', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }))

    const { result } = renderHook(() => useCourseTAs('course-1'))

    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.loading).toBe(false)
    expect(result.current.tas).toEqual([])
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    mockFetch.mockRejectedValueOnce('network down')

    const { result } = renderHook(() => useCourseTAs('course-1'))

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch TAs'))
    expect(result.current.loading).toBe(false)
  })

  it('addTA POSTs the new member then refetches the list', async () => {
    mockFetch
      .mockResolvedValueOnce(tasResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(tasResponse([ta]))

    const { result } = renderHook(() => useCourseTAs('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.addTA('user-1')
    })

    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/courses/course-1/tas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    })
    expect(mockFetch).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(result.current.tas).toEqual([ta]))
  })

  it('addTA throws the server error message on failure', async () => {
    mockFetch
      .mockResolvedValueOnce(tasResponse([]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'already a TA' }), { status: 409 }),
      )

    const { result } = renderHook(() => useCourseTAs('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.addTA('user-1')).rejects.toThrow('already a TA')
    // No refetch after a failed add.
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('addTA falls back to a default message when the error body has no error field', async () => {
    mockFetch
      .mockResolvedValueOnce(tasResponse([]))
      .mockResolvedValueOnce(new Response('not json', { status: 500 }))

    const { result } = renderHook(() => useCourseTAs('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.addTA('user-1')).rejects.toThrow('Failed to add TA')
  })

  it('removeTA DELETEs and filters the removed member out locally without a refetch', async () => {
    mockFetch
      .mockResolvedValueOnce(tasResponse([ta]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    const { result } = renderHook(() => useCourseTAs('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.removeTA('user-1')
    })

    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/courses/course-1/tas', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-1' }),
    })
    expect(result.current.tas).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('removeTA throws the server error message on failure and leaves the list untouched', async () => {
    mockFetch
      .mockResolvedValueOnce(tasResponse([ta]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'cannot remove owner' }), { status: 403 }),
      )

    const { result } = renderHook(() => useCourseTAs('course-1'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.removeTA('user-1')).rejects.toThrow('cannot remove owner')
    expect(result.current.tas).toEqual([ta])
  })
})
