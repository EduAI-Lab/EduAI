/**
 * Dual AI-service status indicator (issue #764 — parity with QuestionMaker's
 * AIServiceIndicators). Two small pills in the header — "Cloud" and "UBC" — each
 * showing whether that provider path is live, so it's obvious which one is
 * serving. Polls `/api/ai-status`; the server caches probes, so polling is cheap.
 */
import * as React from "react";

type ServiceState = "online" | "offline" | "unknown";
type ServiceStatus = { state: ServiceState; detail: string };
type AiServiceStatus = { cloud: ServiceStatus; ubc: ServiceStatus };

const POLL_MS = 60_000;

const DOT_CLASS: Record<ServiceState, string> = {
  online: "bg-emerald-500",
  offline: "bg-red-500",
  unknown: "bg-muted-foreground/50",
};

const STATE_WORD: Record<ServiceState, string> = {
  online: "online",
  offline: "offline",
  unknown: "unknown",
};

function Indicator({ label, status }: { label: string; status: ServiceStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground"
      title={`${label}: ${STATE_WORD[status.state]} — ${status.detail}`}
      role="status"
      aria-label={`${label} AI service ${STATE_WORD[status.state]}`}
    >
      <span
        className={`size-1.5 rounded-full ${DOT_CLASS[status.state]}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function AIServiceIndicators() {
  const [status, setStatus] = React.useState<AiServiceStatus | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let inFlight: AbortController | null = null;

    const load = async () => {
      // Abort any still-pending poll before starting a new one so a hung request
      // can't pile up across the interval.
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), POLL_MS - 5_000);
      try {
        const res = await fetch("/api/ai-status", { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as AiServiceStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Transient / aborted — keep the last known status until the next poll.
      } finally {
        clearTimeout(timeout);
      }
    };

    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      inFlight?.abort();
    };
  }, []);

  if (!status) return null;

  return (
    <div
      className="hidden items-center gap-1.5 sm:flex"
      aria-label="AI service status"
      data-tour="ai-status"
    >
      <Indicator label="Cloud" status={status.cloud} />
      <Indicator label="UBC" status={status.ubc} />
    </div>
  );
}
