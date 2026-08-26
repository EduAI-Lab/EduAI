import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHtml2canvas = vi.fn();
vi.mock('html2canvas', () => ({
  default: (...args: unknown[]) => mockHtml2canvas(...args),
}));

import { useBugReportCapture } from '~/hooks/useBugReportCapture';

describe('useBugReportCapture', () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalFetch: typeof window.fetch;

  beforeEach(() => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    originalFetch = window.fetch;
    mockHtml2canvas.mockReset();
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('patches console methods and window.fetch on mount', () => {
    const { unmount } = renderHook(() => useBugReportCapture());

    expect(console.log).not.toBe(originalLog);
    expect(console.warn).not.toBe(originalWarn);
    expect(console.error).not.toBe(originalError);
    expect(window.fetch).not.toBe(originalFetch);

    unmount();
  });

  it('restores the original console/fetch on unmount', () => {
    const { unmount } = renderHook(() => useBugReportCapture());
    unmount();

    expect(console.log).toBe(originalLog);
    expect(console.warn).toBe(originalWarn);
    expect(console.error).toBe(originalError);
    expect(window.fetch).toBe(originalFetch);
  });

  it('captures console.log/warn/error entries and still forwards to the original', () => {
    const logSpy = vi.fn();
    const warnSpy = vi.fn();
    const errorSpy = vi.fn();
    console.log = logSpy;
    console.warn = warnSpy;
    console.error = errorSpy;

    const { result, unmount } = renderHook(() => useBugReportCapture());

    console.log('hello', 42);
    console.warn('careful');
    console.error(new Error('boom'));

    expect(logSpy).toHaveBeenCalledWith('hello', 42);
    expect(warnSpy).toHaveBeenCalledWith('careful');
    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));

    const captured = result.current.getCapturedData();
    const entries = JSON.parse(captured.consoleLogs);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ level: 'log', message: 'hello 42' });
    expect(entries[1]).toMatchObject({ level: 'warn', message: 'careful' });
    expect(entries[2]).toMatchObject({ level: 'error', message: 'boom' });
    expect(entries[2].stack).toBeDefined();

    unmount();
  });

  it('caps the console buffer at 200 entries, dropping the oldest', () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());

    for (let i = 0; i < 205; i += 1) {
      console.log(`entry-${i}`);
    }

    const entries = JSON.parse(result.current.getCapturedData().consoleLogs);
    expect(entries).toHaveLength(200);
    expect(entries[0].message).toBe('entry-5');
    expect(entries[entries.length - 1].message).toBe('entry-204');

    unmount();
  });

  it('records a successful fetch call in the network buffer', async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { result, unmount } = renderHook(() => useBugReportCapture());

    await act(async () => {
      await window.fetch('http://localhost/api/thing', {
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
      });
    });

    const entries = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: 'POST',
      url: 'http://localhost/api/thing',
      status: 200,
    });
    expect(entries[0].durationMs).toBeGreaterThanOrEqual(0);

    unmount();
  });

  it('still records a network entry when the underlying fetch rejects', async () => {
    window.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const { result, unmount } = renderHook(() => useBugReportCapture());

    await act(async () => {
      await expect(window.fetch('http://localhost/api/fail')).rejects.toThrow('network down');
    });

    const entries = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBeNull();
    expect(entries[0].url).toBe('http://localhost/api/fail');

    unmount();
  });

  it('caps the network buffer at 100 entries', async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const { result, unmount } = renderHook(() => useBugReportCapture());

    for (let i = 0; i < 105; i += 1) {
      await act(async () => {
        await window.fetch(`http://localhost/api/${i}`);
      });
    }

    const entries = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(entries).toHaveLength(100);
    expect(entries[0].url).toBe('http://localhost/api/5');

    unmount();
  });

  it('captureScreenshot returns a JPEG data URL from html2canvas', async () => {
    const toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,abc');
    mockHtml2canvas.mockResolvedValue({ toDataURL });

    const { result, unmount } = renderHook(() => useBugReportCapture());

    let screenshot: string | null = null;
    await act(async () => {
      screenshot = await result.current.captureScreenshot();
    });

    expect(screenshot).toBe('data:image/jpeg;base64,abc');
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
    expect(result.current.getCapturedData().screenshot).toBe('data:image/jpeg;base64,abc');

    unmount();
  });

  it('reuses a cached screenshot within the cache window instead of re-rendering', async () => {
    const toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,cached');
    mockHtml2canvas.mockResolvedValue({ toDataURL });

    const { result, unmount } = renderHook(() => useBugReportCapture());

    await act(async () => {
      await result.current.captureScreenshot();
    });
    await act(async () => {
      await result.current.captureScreenshot();
    });

    expect(mockHtml2canvas).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('captureScreenshot returns null (or a prior cached value) when html2canvas throws', async () => {
    mockHtml2canvas.mockRejectedValue(new Error('canvas failed'));

    const { result, unmount } = renderHook(() => useBugReportCapture());

    let screenshot: string | null = 'sentinel';
    await act(async () => {
      screenshot = await result.current.captureScreenshot();
    });

    expect(screenshot).toBeNull();

    unmount();
  });
});
