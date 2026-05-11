/**
 * @file Captures console logs, network traffic, and an on-demand screenshot
 *   so the bug-report dialog can attach diagnostic context.
 *
 * Responsibility: Owns the rolling diagnostic buffers and exposes
 *   `{ captureScreenshot, getCapturedData }` to the bug-report UI.
 * Callers: The bug-report capture host (mounted near the app root) and the
 *   bug-report dialog that consumes the snapshot.
 * Gotchas:
 *   - On mount this hook **monkey-patches `console.{log, warn, error}` and
 *     `window.fetch` globally** and restores the originals on unmount. The
 *     patch/restore contract MUST stay symmetric — leaking a patched
 *     reference will corrupt logging app-wide. Mount this hook exactly once.
 *   - Buffers are bounded: `MAX_CONSOLE_ENTRIES = 200`,
 *     `MAX_NETWORK_ENTRIES = 100`. Older entries fall off the front.
 *   - Screenshots are cached for `SCREENSHOT_CACHE_WINDOW_MS` (5s) so
 *     reopening the dialog quickly does not re-render the page.
 *   - `html2canvas` is imported lazily on first screenshot request so it
 *     never lands in the main JS chunk.
 * Related: `app/lib/api.ts` (`submitBugReport`), bug-report dialog component.
 */

import { useCallback, useEffect, useRef } from 'react';

type ConsoleEntry = {
  level: 'log' | 'warn' | 'error';
  message: string;
  stack?: string;
  timestamp: string;
};

type NetworkEntry = {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  durationMs: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  timestamp: string;
};

const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 100;
const SCREENSHOT_CACHE_WINDOW_MS = 5_000;

function stringifyArg(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function headersToObject(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (init?.body instanceof FormData) {
    return '[form-data]';
  }
  if (init?.body) {
    return '[binary-body]';
  }
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return null;
    }
  }
  return null;
}

export function useBugReportCapture() {
  const consoleBuffer = useRef<ConsoleEntry[]>([]);
  const networkBuffer = useRef<NetworkEntry[]>([]);
  const screenshotRef = useRef<string | null>(null);
  const lastScreenshotAtRef = useRef<number>(0);
  const patchedRef = useRef(false);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    fetch: typeof window.fetch;
  } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || patchedRef.current) {
      return;
    }
    patchedRef.current = true;

    // Snapshot the originals BEFORE installing patches so the cleanup
    // function below can restore exactly what was there at mount time.
    // Skipping this snapshot would leave wrappers installed after unmount.
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalFetch = window.fetch;
    originalsRef.current = {
      log: originalLog,
      warn: originalWarn,
      error: originalError,
      fetch: originalFetch,
    };

    function pushConsoleEntry(level: ConsoleEntry['level'], args: unknown[]) {
      const entry: ConsoleEntry = {
        level,
        message: args.map(stringifyArg).join(' '),
        stack: args.find((arg) => arg instanceof Error)?.stack,
        timestamp: new Date().toISOString(),
      };
      consoleBuffer.current.push(entry);
      if (consoleBuffer.current.length > MAX_CONSOLE_ENTRIES) {
        consoleBuffer.current.shift();
      }
    }

    console.log = (...args: unknown[]) => {
      pushConsoleEntry('log', args);
      originalLog.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      pushConsoleEntry('warn', args);
      originalWarn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      pushConsoleEntry('error', args);
      originalError.apply(console, args);
    };

    const patchedFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const startedAt = performance.now();
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const requestHeaders = headersToObject(
        new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
      );
      const requestBody = await readRequestBody(input, init);
      let status: number | null = null;
      let responseHeaders: Record<string, string> = {};
      let responseBody: string | null = null;

      try {
        const response = await originalFetch(input, init);
        status = response.status;
        responseHeaders = headersToObject(response.headers);
        try {
          responseBody = await response.clone().text();
        } catch {
          responseBody = null;
        }
        return response;
      } finally {
        networkBuffer.current.push({
          method,
          url,
          requestHeaders,
          requestBody,
          status,
          durationMs: Math.round(performance.now() - startedAt),
          responseHeaders,
          responseBody,
          timestamp: new Date().toISOString(),
        });
        if (networkBuffer.current.length > MAX_NETWORK_ENTRIES) {
          networkBuffer.current.shift();
        }
      }
    }) as typeof window.fetch;

    window.fetch = patchedFetch;

    return () => {
      if (!originalsRef.current) return;
      console.log = originalsRef.current.log;
      console.warn = originalsRef.current.warn;
      console.error = originalsRef.current.error;
      window.fetch = originalsRef.current.fetch;
      patchedRef.current = false;
    };
  }, []);

  const captureScreenshot = useCallback(async () => {
    if (typeof window === 'undefined') return null;
    const now = Date.now();
    // Reuse the most recent screenshot within the cache window to avoid the
    // visible flash and CPU cost of re-rendering the DOM via html2canvas
    // when the user toggles the bug-report dialog quickly.
    if (screenshotRef.current && now - lastScreenshotAtRef.current <= SCREENSHOT_CACHE_WINDOW_MS) {
      return screenshotRef.current;
    }
    try {
      // Lazy import keeps html2canvas out of the main bundle; it is large
      // and only needed when a user actually files a bug report.
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        scale: 0.75,
      });
      screenshotRef.current = canvas.toDataURL('image/png');
      lastScreenshotAtRef.current = Date.now();
      return screenshotRef.current;
    } catch {
      return screenshotRef.current;
    }
  }, []);

  const getCapturedData = useCallback(() => {
    return {
      consoleLogs: JSON.stringify(consoleBuffer.current),
      networkLogs: JSON.stringify(networkBuffer.current),
      screenshot: screenshotRef.current,
    };
  }, []);

  return { captureScreenshot, getCapturedData };
}
