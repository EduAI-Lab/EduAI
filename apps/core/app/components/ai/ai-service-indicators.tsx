/**
 * Core's AI-service status chips — a thin adapter over the shared `@eduai/ui`
 * AIServiceIndicators (issue #764), so Core, QuestionMaker, and AI Tutor show the
 * same two independent chips (Cloud / UBC-hosted). Polls `/api/ai-status`; the
 * server caches probes, so polling is cheap. Each chip reflects only its own
 * service state.
 */
import * as React from "react";
import {
  AIServiceIndicators as SharedAIServiceIndicators,
  type ServiceStatus,
} from "@eduai/ui";

type ApiServiceStatus = { state: "online" | "offline" | "unknown"; detail?: string };
type ApiStatus = { cloud: ApiServiceStatus; ubc: ApiServiceStatus };

const POLL_MS = 60_000;

const LOADING: ServiceStatus = { state: "loading" };

export function AIServiceIndicators() {
  const [status, setStatus] = React.useState<ApiStatus | null>(null);
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;

    const load = async () => {
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), POLL_MS - 5_000);
      try {
        const res = await fetch("/api/ai-status", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as ApiStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Transient / aborted — keep the last known status until the next poll.
      } finally {
        clearTimeout(timeout);
      }
    };

    refreshRef.current = () => void load();
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      inFlight?.abort();
    };
  }, []);

  const toStatus = (s?: ApiServiceStatus): ServiceStatus =>
    s ? { state: s.state, detail: s.detail } : LOADING;

  return (
    <span data-tour="ai-status" className="hidden sm:inline-flex">
      <SharedAIServiceIndicators
        cloud={toStatus(status?.cloud)}
        ubc={toStatus(status?.ubc)}
        onRefresh={() => refreshRef.current()}
      />
    </span>
  );
}
