/**
 * #1333: useBugReportCapture used to run html2canvas on a 10s setInterval for
 * every authenticated user on every page, forever. The fix drops the timer
 * entirely — capture now only runs when captureScreenshot() is called
 * (dialog open) — so these tests pin the on-demand behavior plus the
 * concurrent-call dedup and teardown that made the on-demand switch safe.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBugReportCapture } from '../../hooks/useBugReportCapture';

const toDataURL = vi.fn(() => 'data:image/jpeg;base64,MOCK');
const html2canvas = vi.fn(async () => ({ toDataURL }));

vi.mock('html2canvas', () => ({
  default: (...args: unknown[]) => html2canvas(...args),
}));

describe('useBugReportCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    html2canvas.mockClear();
    toDataURL.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never calls html2canvas on its own — no interval, no initial timeout', async () => {
    renderHook(() => useBugReportCapture(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(html2canvas).not.toHaveBeenCalled();
  });

  it('captures on demand and exposes the screenshot via getCapturedData', async () => {
    const { result } = renderHook(() => useBugReportCapture(true));

    await act(async () => {
      await result.current.captureScreenshot();
    });

    expect(html2canvas).toHaveBeenCalledTimes(1);
    expect(result.current.getCapturedData().screenshot).toBe('data:image/jpeg;base64,MOCK');
  });

  it('is a no-op while disabled', async () => {
    const { result } = renderHook(() => useBugReportCapture(false));

    await act(async () => {
      await result.current.captureScreenshot();
    });

    expect(html2canvas).not.toHaveBeenCalled();
    expect(result.current.getCapturedData().screenshot).toBeNull();
  });

  it('dedupes overlapping calls into a single in-flight capture', async () => {
    let resolveCapture!: () => void;
    html2canvas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = () => resolve({ toDataURL });
        })
    );

    const { result } = renderHook(() => useBugReportCapture(true));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.captureScreenshot();
      second = result.current.captureScreenshot();
      // Let both calls run past the `await import('html2canvas')` microtask
      // so the second sees capturePromiseRef already set, before we resolve it.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(html2canvas).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCapture();
      await Promise.all([first, second]);
    });

    expect(html2canvas).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh capture once the previous one has settled', async () => {
    const { result } = renderHook(() => useBugReportCapture(true));

    await act(async () => {
      await result.current.captureScreenshot();
    });
    await act(async () => {
      await result.current.captureScreenshot();
    });

    expect(html2canvas).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect a screenshot when disabled during an in-flight capture', async () => {
    let resolveCapture!: (value: { toDataURL: typeof toDataURL }) => void;
    html2canvas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        })
    );

    const { result, rerender } = renderHook(({ enabled }) => useBugReportCapture(enabled), {
      initialProps: { enabled: true },
    });
    let capture!: Promise<void>;
    await act(async () => {
      capture = result.current.captureScreenshot();
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender({ enabled: false });
    await act(async () => {
      resolveCapture({ toDataURL });
      await capture;
    });

    expect(result.current.getCapturedData().screenshot).toBeNull();
  });

  it('swallows capture failures instead of throwing', async () => {
    html2canvas.mockImplementationOnce(async () => {
      throw new Error('canvas boom');
    });

    const { result } = renderHook(() => useBugReportCapture(true));

    await act(async () => {
      await expect(result.current.captureScreenshot()).resolves.toBeUndefined();
    });

    expect(result.current.getCapturedData().screenshot).toBeNull();
  });

  it('restores console/fetch and clears buffers when disabled after being enabled', async () => {
    const origLog = console.log;
    const origFetch = window.fetch;
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    window.fetch = mockFetch as typeof window.fetch;

    const { result, rerender } = renderHook(({ enabled }) => useBugReportCapture(enabled), {
      initialProps: { enabled: true },
    });

    expect(console.log).not.toBe(origLog);
    expect(window.fetch).not.toBe(origFetch);

    console.log('buffered log');
    await act(async () => {
      await window.fetch('/buffered-request');
    });

    rerender({ enabled: false });

    expect(console.log).toBe(origLog);
    expect(window.fetch).toBe(mockFetch);
    expect(result.current.getCapturedData()).toEqual({
      consoleLogs: '[]',
      networkLogs: '[]',
      screenshot: null,
    });

    window.fetch = origFetch;
  });
});
