import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePolicies } from '~/hooks/api/use-policies'

const definitions = [
  { key: 'ai_tutor', label: 'AI Tutor', description: 'Allow AI tutoring', default: true },
]

function policiesResponse(policies: Record<string, boolean>) {
  return new Response(JSON.stringify({ policies, definitions }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

let mockFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  mockFetch = vi.fn()
  vi.stubGlobal('fetch', mockFetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('usePolicies', () => {
  it('loads the policy flags and their definitions on mount', async () => {
    mockFetch.mockResolvedValueOnce(policiesResponse({ ai_tutor: true }))

    const { result } = renderHook(() => usePolicies())

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.policies).toEqual({ ai_tutor: true })
    expect(result.current.definitions).toEqual(definitions)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a failed load as an error and leaves policies empty', async () => {
    mockFetch.mockResolvedValueOnce(new Response('server exploded', { status: 500 }))

    const { result } = renderHook(() => usePolicies())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('server exploded')
    expect(result.current.policies).toEqual({})
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    mockFetch.mockRejectedValueOnce('offline')

    const { result } = renderHook(() => usePolicies())

    await waitFor(() => expect(result.current.error).toBe('Failed to fetch policies'))
    expect(result.current.isLoading).toBe(false)
  })

  it('setPolicy optimistically flips the flag then reconciles with the server response', async () => {
    mockFetch
      .mockResolvedValueOnce(policiesResponse({ ai_tutor: false }))
      .mockResolvedValueOnce(policiesResponse({ ai_tutor: true }))

    const { result } = renderHook(() => usePolicies())
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.policies).toEqual({ ai_tutor: false });

    await act(async () => {
      await result.current.setPolicy('ai_tutor', true)
    })

    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/policies', {
      method: 'PATCH',
      headers: expect.any(Headers),
      body: JSON.stringify({ key: 'ai_tutor', value: true }),
    })
    expect(result.current.policies).toEqual({ ai_tutor: true })
  })

  it('setPolicy rolls back to the prior value and records the error on failure', async () => {
    mockFetch
      .mockResolvedValueOnce(policiesResponse({ ai_tutor: false }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

    const { result } = renderHook(() => usePolicies())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.setPolicy('ai_tutor', true)
    })

    expect(result.current.policies).toEqual({ ai_tutor: false })
    expect(result.current.error).toBe('forbidden')
  })

  it('refresh re-fetches the policy list on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(policiesResponse({ ai_tutor: false }))
      .mockResolvedValueOnce(policiesResponse({ ai_tutor: true }))

    const { result } = renderHook(() => usePolicies())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.current.policies).toEqual({ ai_tutor: true })
  })
})
