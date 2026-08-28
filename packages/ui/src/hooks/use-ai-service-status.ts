/**
 * Dual cloud/UBC AI-service status, polled on an interval (issue #764). Core,
 * AI Tutor, and Question Maker each wrap the shared `AIServiceIndicators`
 * (`../ai-service-indicators`) with their own near-identical fetch + polling +
 * refresh + error-swallowing logic; this hook is that shared logic, with the
 * data source injected so each app keeps its own way of getting there:
 *
 *   - Core polls its own `/api/ai-status` — the default `fetch(endpoint)`
 *     path, no `fetcher` needed.
 *   - AI Tutor forwards to Core through its API client → pass a `fetcher`
 *     that calls it.
 *   - Question Maker probes cloud/UBC independently client-side (its own
 *     provider-key + reachability checks) → pass a `fetcher` that runs both
 *     probes and resolves `{ cloud, ubc }`.
 *
 * A failed poll keeps the last known status — chips never flash to an error
 * state on a single transient failure. Both services start as
 * `{ state: "loading" }` until the first response resolves.
 *
 * Cancellation contract (issue #1551): every probe — the default fetch AND a
 * caller-supplied `fetcher` — is handed an `AbortSignal`. The signal fires when
 * (a) the component unmounts, (b) a newer poll or manual refresh supersedes it,
 * or (c) the probe outruns `requestTimeoutMs`. Callers that reach the network
 * (Question Maker's Axios probes) MUST forward the signal so a wedged request is
 * actually torn down and a late response can't overwrite newer state.
 *
 * Backgrounded tabs stop polling entirely and fire exactly one refresh when the
 * tab becomes visible again (#1454) — a poll here costs a live provider probe,
 * so an idle hidden tab should cost nothing.
 */
import * as React from "react";

import type { ServiceStatus } from "../ai-service-indicators";

/** The `{ cloud, ubc }` pair every AI-status data source resolves to. */
export interface AiServiceStatusPair {
  cloud: ServiceStatus;
  ubc: ServiceStatus;
}

export interface UseAiServiceStatusOptions {
  /**
   * GET endpoint returning a `{ cloud, ubc }` JSON payload. Used by the
   * default fetcher; ignored when `fetcher` is supplied.
   * Default: "/api/ai-status".
   */
  endpoint?: string;
  /**
   * Overrides the default `fetch(endpoint)` call — e.g. Question Maker's
   * independent cloud/UBC probes, or AI Tutor's API client forwarding to
   * Core. Must resolve the same `{ cloud, ubc }` shape. Receives the poll's
   * `AbortSignal` and MUST forward it to any network call it makes, so refresh,
   * unmount, and timeout can cancel a probe in flight.
   */
  fetcher?: (signal: AbortSignal) => Promise<AiServiceStatusPair>;
  /**
   * Poll interval in ms.
   * Default: 60_000 (matches Core, AI Tutor, and Question Maker today).
   */
  intervalMs?: number;
  /**
   * Abort a single probe still running after this long, freeing the
   * single-flight slot before the next tick so a wedged request cannot pin it.
   * Default: `intervalMs - 5_000`, floored at 1_000.
   */
  requestTimeoutMs?: number;
}

export interface UseAiServiceStatusResult extends AiServiceStatusPair {
  /** Re-checks both services now. Safe to pass directly as `onRefresh`. */
  refresh: () => void;
}

const DEFAULT_ENDPOINT = "/api/ai-status";
const DEFAULT_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_BUFFER_MS = 5_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const LOADING: ServiceStatus = { state: "loading" };

async function defaultFetcher(endpoint: string, signal: AbortSignal): Promise<AiServiceStatusPair> {
  const res = await fetch(endpoint, { signal });
  if (!res.ok) {
    throw new Error(`AI status request to ${endpoint} failed: ${res.status}`);
  }
  const data = (await res.json()) as Partial<AiServiceStatusPair>;
  return {
    cloud: data.cloud ?? LOADING,
    ubc: data.ubc ?? LOADING,
  };
}

/**
 * Polls a dual cloud/UBC AI-service status on an interval. See the file
 * header for how each app is expected to wire `endpoint` / `fetcher`.
 */
export function useAiServiceStatus(
  options: UseAiServiceStatusOptions = {},
): UseAiServiceStatusResult {
  const {
    endpoint = DEFAULT_ENDPOINT,
    fetcher,
    intervalMs = DEFAULT_INTERVAL_MS,
    requestTimeoutMs,
  } = options;

  const [cloud, setCloud] = React.useState<ServiceStatus>(LOADING);
  const [ubc, setUbc] = React.useState<ServiceStatus>(LOADING);

  // Refs so `load` always reads the latest options without forcing the
  // polling effect to restart when a caller passes a fresh inline fetcher.
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const endpointRef = React.useRef(endpoint);
  endpointRef.current = endpoint;

  const refreshRef = React.useRef<() => void>(() => {});

  const timeoutMs =
    requestTimeoutMs ?? Math.max(MIN_REQUEST_TIMEOUT_MS, intervalMs - REQUEST_TIMEOUT_BUFFER_MS);

  React.useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    // Only keep a timer armed while the tab is visible; a hidden tab stops
    // polling entirely and refreshes once when it becomes visible again (#1454).
    const schedule = () => {
      clearTimer();
      if (!cancelled && !isHidden()) timer = setTimeout(() => void load(), intervalMs);
    };

    const load = async () => {
      // Cancel a still-pending previous poll before starting a new one, so a
      // slow response can't race a newer one and overwrite it out of order.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      // Abort a wedged probe before the next tick so it can't pin the slot.
      const killTimer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = fetcherRef.current
          ? await fetcherRef.current(controller.signal)
          : await defaultFetcher(endpointRef.current, controller.signal);
        // Ignore a response that lost its race (a newer poll aborted this one).
        if (!cancelled && !controller.signal.aborted) {
          setCloud(result.cloud);
          setUbc(result.ubc);
        }
      } catch {
        // Transient / aborted — keep the last known status until the next poll.
      } finally {
        clearTimeout(killTimer);
        if (inFlight === controller) inFlight = null;
        schedule();
      }
    };

    const onVisibility = () => {
      clearTimer();
      if (!isHidden()) void load();
    };

    refreshRef.current = () => void load();
    void load();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      clearTimer();
      inFlight?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [intervalMs, timeoutMs]);

  const refresh = React.useCallback(() => refreshRef.current(), []);

  return { cloud, ubc, refresh };
}
