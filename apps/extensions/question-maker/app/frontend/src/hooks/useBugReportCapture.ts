import { useEffect, useRef, useCallback } from 'react';
import html2canvas from 'html2canvas';

interface ConsoleEntry {
  level: string;
  message: string;
  timestamp: string;
}

interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  timestamp: string;
}

const MAX_CONSOLE_ENTRIES = 100;
const MAX_NETWORK_ENTRIES = 50;
/**
 * Patches console + fetch to buffer recent diagnostics for bug reports.
 * When `enabled` is false, restores originals and clears buffers.
 */
export function useBugReportCapture(enabled: boolean) {
  const consoleBuffer = useRef<ConsoleEntry[]>([]);
  const networkBuffer = useRef<NetworkEntry[]>([]);
  const screenshotRef = useRef<string | null>(null);
  const capturePromiseRef = useRef<Promise<void> | null>(null);
  const captureGenerationRef = useRef(0);
  const patchedRef = useRef(false);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    fetch: typeof window.fetch;
  } | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      if (originalsRef.current && patchedRef.current) {
        console.log = originalsRef.current.log;
        console.warn = originalsRef.current.warn;
        console.error = originalsRef.current.error;
        window.fetch = originalsRef.current.fetch;
        patchedRef.current = false;
        originalsRef.current = null;
      }
      consoleBuffer.current = [];
      networkBuffer.current = [];
      screenshotRef.current = null;
      captureGenerationRef.current += 1;
      capturePromiseRef.current = null;
      return;
    }

    if (patchedRef.current) return;
    patchedRef.current = true;

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    const origFetch = window.fetch;

    originalsRef.current = {
      log: origLog,
      warn: origWarn,
      error: origError,
      fetch: origFetch
    };

    function addConsoleEntry(level: string, args: unknown[]) {
      const entry: ConsoleEntry = {
        level,
        message: args
          .map((a) => {
            try {
              return typeof a === 'string' ? a : JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(' '),
        timestamp: new Date().toISOString()
      };
      consoleBuffer.current.push(entry);
      if (consoleBuffer.current.length > MAX_CONSOLE_ENTRIES) {
        consoleBuffer.current.shift();
      }
    }

    console.log = (...args: unknown[]) => {
      addConsoleEntry('log', args);
      origLog.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      addConsoleEntry('warn', args);
      origWarn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      addConsoleEntry('error', args);
      origError.apply(console, args);
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || 'GET';
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const start = performance.now();
      let status: number | null = null;

      try {
        const response = await origFetch(input, init);
        status = response.status;
        return response;
      } finally {
        const entry: NetworkEntry = {
          method,
          url,
          status,
          durationMs: Math.round(performance.now() - start),
          timestamp: new Date().toISOString()
        };
        networkBuffer.current.push(entry);
        if (networkBuffer.current.length > MAX_NETWORK_ENTRIES) {
          networkBuffer.current.shift();
        }
      }
    };

    return () => {
      if (originalsRef.current) {
        console.log = originalsRef.current.log;
        console.warn = originalsRef.current.warn;
        console.error = originalsRef.current.error;
        window.fetch = originalsRef.current.fetch;
      }
      patchedRef.current = false;
      originalsRef.current = null;
    };
  }, [enabled]);

  const captureScreenshot = useCallback(async () => {
    if (!enabled || typeof window === 'undefined') return;
    if (capturePromiseRef.current) return capturePromiseRef.current;

    const generation = captureGenerationRef.current;
    let capturePromise!: Promise<void>;
    capturePromise = (async () => {
      try {
        const canvas = await html2canvas(document.body, {
          logging: false,
          useCORS: true,
          scale: 0.5
        });
        // JPEG keeps the report below Core's screenshot size cap.
        if (captureGenerationRef.current === generation) {
          screenshotRef.current = canvas.toDataURL('image/jpeg', 0.7);
        }
      } catch {
        // ignore capture failures
      } finally {
        if (capturePromiseRef.current === capturePromise) {
          capturePromiseRef.current = null;
        }
      }
    })();
    capturePromiseRef.current = capturePromise;
    return capturePromise;
  }, [enabled]);

  const getCapturedData = useCallback(() => {
    return {
      consoleLogs: JSON.stringify(consoleBuffer.current),
      networkLogs: JSON.stringify(networkBuffer.current),
      screenshot: screenshotRef.current
    };
  }, []);

  return { captureScreenshot, getCapturedData };
}
