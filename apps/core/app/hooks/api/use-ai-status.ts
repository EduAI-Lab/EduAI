/**
 * Shared source for the AI-service status chips (#1454).
 *
 * `GET /api/ai-status` is backed by `getAiServiceStatus()`, which reaches out to
 * the configured AI providers, so the cost of a poll lands on a provider
 * round-trip rather than on Core. The store therefore only keeps a timer armed
 * while the tab is visible: a backgrounded tab stops polling entirely and fires
 * exactly one refresh when it becomes visible again.
 *
 * Same module-singleton shape as `use-cron-job-status.ts` (#1389) — a listener
 * set driving `useSyncExternalStore`, so any number of mounted consumers share
 * one request per tick. The two pollers are kept separate on purpose: different
 * endpoints, different cadences, no shared status to share.
 */
import { useSyncExternalStore } from "react";
import { apiFetch } from "~/hooks/api/config";

export type AiServiceStatus = { state: "online" | "offline" | "unknown"; detail?: string };
export type AiStatus = { cloud: AiServiceStatus; ubc: AiServiceStatus };

/** Endpoint sets `Cache-Control: private, max-age=15`; 60s stays well clear of it. */
const POLL_MS = 60_000;
/** Abort a wedged provider probe before the next tick so it cannot pin `inFlight`. */
const REQUEST_TIMEOUT_MS = POLL_MS - 5_000;

let snapshot: AiStatus | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(status: AiStatus) {
  snapshot = status;
  listeners.forEach((listener) => listener());
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule() {
  clearTimer();
  if (listeners.size && document.visibilityState === "visible") {
    timer = setTimeout(() => void refresh(), POLL_MS);
  }
}

/**
 * Fetch once. No-ops with no listeners, in a hidden tab, or while a request is
 * already in flight. The `onRefresh` button funnels through here too — a click
 * implies the tab is visible, so the visibility guard never blocks it.
 */
export async function refresh() {
  if (!listeners.size || document.visibilityState !== "visible" || inFlight)
    return inFlight ?? undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  inFlight = apiFetch<AiStatus | undefined>("/api/ai-status", { signal: controller.signal })
    .then((status) => {
      if (status) publish(status);
    })
    .catch(() => {
      // Transient / aborted — keep the last known status until the next poll.
    })
    .finally(() => {
      clearTimeout(timeout);
      inFlight = null;
      schedule();
    });

  return inFlight;
}

function onVisibilityChange() {
  clearTimer();
  if (document.visibilityState === "visible") void refresh();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      snapshot = null;
    }
  };
}

function getSnapshot() {
  return snapshot;
}

export function useAiStatus() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { status, refresh };
}
