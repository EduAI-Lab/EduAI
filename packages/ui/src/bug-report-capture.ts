/**
 * @file Captures console logs, request metadata, and an on-demand screenshot
 *   so the bug-report dialog can attach diagnostic context.
 *
 * Responsibility: Owns the rolling diagnostic buffers and exposes
 *   `{ captureScreenshot, getCapturedData, clearScreenshot }` to the bug-report UI.
 * Callers: Core's `BugReportSubmitDialog`, AI Tutor's `BugReportProvider`, and
 *   QM's `BugReportProvider` — each mounts it once and hands the callbacks to
 *   `BugReportDialog` (#1752).
 * Gotchas:
 *   - While enabled this hook **monkey-patches `console.{log, warn, error}` and
 *     `window.fetch` globally** and restores the originals on unmount or when
 *     disabled. The patch/restore contract MUST stay symmetric — leaking a
 *     patched reference will corrupt logging app-wide. Mount this hook exactly once.
 *   - Buffers are bounded: `MAX_CONSOLE_ENTRIES = 200`,
 *     `MAX_NETWORK_ENTRIES = 100`. Older entries fall off the front.
 *   - No screenshot is taken until `captureScreenshot()` is called (the dialog
 *     does so when the reporter opts in). `clearScreenshot()` drops it and
 *     invalidates any capture still in flight.
 *   - `html2canvas` is imported lazily on first screenshot request so it
 *     never lands in the main JS chunk. This is a subpath export, not part of
 *     the `@eduai/ui` barrel, for the same reason.
 * Related: `bug-report-dialog.tsx`.
 */

import { useCallback, useEffect, useRef } from "react";
import { isString } from "./lib/primitive-union";
import { isBrowser } from "./lib/runtime-env";

type ConsoleEntry = {
  level: "log" | "warn" | "error";
  message: string;
  stack?: string;
  timestamp: string;
};

type NetworkEntry = {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  timestamp: string;
};

const MAX_CONSOLE_ENTRIES = 200;
const MAX_NETWORK_ENTRIES = 100;

const DIALOG_SLOTS = new Set(["dialog-overlay", "dialog-content"]);

/** html2canvas `ignoreElements`: keep the bug-report modal out of its own screenshot. */
export function isBugReportChrome(el: Element) {
  return DIALOG_SLOTS.has(el.getAttribute("data-slot") ?? "");
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- formats whatever was handed to a patched console.*; the rule's own `cause` hatch is the same case, minus the throwable.
function stringifyArg(value: unknown) {
  if (value instanceof Error) {
    return value.message;
  }
  if (isString(value)) {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function useBugReportCapture(enabled = true) {
  const consoleBuffer = useRef<ConsoleEntry[]>([]);
  const networkBuffer = useRef<NetworkEntry[]>([]);
  const screenshotRef = useRef<string | null>(null);
  const capturePromiseRef = useRef<Promise<string | null> | null>(null);
  // Bumped whenever the screenshot is invalidated, so a capture that resolves
  // after disable/close cannot repopulate the ref.
  const captureGenerationRef = useRef(0);
  const patchedRef = useRef(false);
  const originalsRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    fetch: typeof window.fetch;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !isBrowser()) {
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

    function pushConsoleEntry(level: ConsoleEntry["level"], args: unknown[]) {
      const entry: ConsoleEntry = {
        level,
        message: args.map(stringifyArg).join(" "),
        stack: args.find((arg) => arg instanceof Error)?.stack,
        timestamp: new Date().toISOString(),
      };
      consoleBuffer.current.push(entry);
      if (consoleBuffer.current.length > MAX_CONSOLE_ENTRIES) {
        consoleBuffer.current.shift();
      }
    }

    console.log = (...args: unknown[]) => {
      pushConsoleEntry("log", args);
      originalLog.apply(console, args);
    };
    console.warn = (...args: unknown[]) => {
      pushConsoleEntry("warn", args);
      originalWarn.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      pushConsoleEntry("error", args);
      originalError.apply(console, args);
    };

    // SAFETY: the wrapper takes fetch's own (input, init) and returns its Response
    // unchanged; the cast only drops fetch's extra static members, which nothing reads.
    const patchedFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const startedAt = performance.now();
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const url = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
      let status: number | null = null;

      try {
        const response = await originalFetch(input, init);
        status = response.status;
        return response;
      } finally {
        networkBuffer.current.push({
          method,
          url,
          status,
          durationMs: Math.round(performance.now() - startedAt),
          timestamp: new Date().toISOString(),
        });
        if (networkBuffer.current.length > MAX_NETWORK_ENTRIES) {
          networkBuffer.current.shift();
        }
      }
    }) as typeof window.fetch;

    window.fetch = patchedFetch;

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

  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    if (!enabled || !isBrowser()) return null;
    if (capturePromiseRef.current) return capturePromiseRef.current;

    const generation = captureGenerationRef.current;
    let promise!: Promise<string | null>;
    promise = (async () => {
      try {
        // Lazy import keeps html2canvas out of the main bundle; it is large
        // and only needed when a user actually files a bug report.
        const html2canvas = (await import("html2canvas")).default;
        const canvas = await html2canvas(document.body, {
          logging: false,
          useCORS: true,
          scale: 0.75,
          ignoreElements: isBugReportChrome,
        });
        if (captureGenerationRef.current !== generation) return null;
        // JPEG, not PNG: a full-page PNG data URL easily exceeds Core's 512k
        // screenshot cap, and the server drops oversized screenshots (#979).
        screenshotRef.current = canvas.toDataURL("image/jpeg", 0.7);
        return screenshotRef.current;
      } catch {
        return captureGenerationRef.current === generation ? screenshotRef.current : null;
      } finally {
        if (capturePromiseRef.current === promise) capturePromiseRef.current = null;
      }
    })();
    capturePromiseRef.current = promise;
    return promise;
  }, [enabled]);

  const getCapturedData = useCallback(() => {
    return {
      consoleLogs: JSON.stringify(consoleBuffer.current),
      networkLogs: JSON.stringify(networkBuffer.current),
      screenshot: screenshotRef.current,
    };
  }, []);

  const clearScreenshot = useCallback(() => {
    captureGenerationRef.current += 1;
    capturePromiseRef.current = null;
    screenshotRef.current = null;
  }, []);

  return { captureScreenshot, getCapturedData, clearScreenshot };
}
