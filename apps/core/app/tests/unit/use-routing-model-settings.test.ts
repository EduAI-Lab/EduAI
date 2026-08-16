import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRoutingModelSettings } from '~/hooks/api/use-routing-model-settings'
import { defaultRoutingModelSettings, routingModelSettingDefinitions } from '~/lib/routing-model-settings'

const definitions = routingModelSettingDefinitions()

function settingsResponse(settings: Record<string, boolean>) {
  return new Response(JSON.stringify({ settings, definitions }), {
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

describe('useRoutingModelSettings', () => {
  it('loads the routing model settings and their definitions on mount', async () => {
    mockFetch.mockResolvedValueOnce(
      settingsResponse({ autoLlmEnabled: false, autoRulesEnabled: true }),
    )

    const { result } = renderHook(() => useRoutingModelSettings())

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.settings).toEqual({
      autoLlmEnabled: false,
      autoRulesEnabled: true,
    })
    expect(result.current.definitions).toEqual(definitions)
    expect(result.current.error).toBeNull()
  })

  it('surfaces a failed load as an error and keeps the default settings', async () => {
    mockFetch.mockResolvedValueOnce(new Response('server exploded', { status: 500 }))

    const { result } = renderHook(() => useRoutingModelSettings())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('server exploded')
    expect(result.current.settings).toEqual(defaultRoutingModelSettings())
  })

  it('falls back to a generic message when the thrown value is not an Error', async () => {
    mockFetch.mockRejectedValueOnce('offline')

    const { result } = renderHook(() => useRoutingModelSettings())

    await waitFor(() =>
      expect(result.current.error).toBe('Failed to fetch routing model settings'),
    )
    expect(result.current.isLoading).toBe(false)
  })

  it('setEnabled PATCHes the flag and adopts the server-returned settings', async () => {
    mockFetch
      .mockResolvedValueOnce(
        settingsResponse({ autoLlmEnabled: true, autoRulesEnabled: false }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            settings: { autoLlmEnabled: false, autoRulesEnabled: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )

    const { result } = renderHook(() => useRoutingModelSettings())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.setEnabled('autoRulesEnabled', true)
    })

    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/routing-model-settings', {
      method: 'PATCH',
      headers: expect.any(Headers),
      body: JSON.stringify({ key: 'autoRulesEnabled', value: true }),
    })
    expect(result.current.settings).toEqual({
      autoLlmEnabled: false,
      autoRulesEnabled: true,
    })
  })

  it('setEnabled propagates the server error instead of swallowing it', async () => {
    mockFetch
      .mockResolvedValueOnce(
        settingsResponse({ autoLlmEnabled: true, autoRulesEnabled: false }),
      )
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }))

    const { result } = renderHook(() => useRoutingModelSettings())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(
      result.current.setEnabled('autoRulesEnabled', true),
    ).rejects.toThrow('forbidden')
  })

  it('refresh re-fetches the settings on demand', async () => {
    mockFetch
      .mockResolvedValueOnce(
        settingsResponse({ autoLlmEnabled: true, autoRulesEnabled: false }),
      )
      .mockResolvedValueOnce(
        settingsResponse({ autoLlmEnabled: false, autoRulesEnabled: false }),
      )

    const { result } = renderHook(() => useRoutingModelSettings())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.current.settings.autoLlmEnabled).toBe(false)
  })
})
