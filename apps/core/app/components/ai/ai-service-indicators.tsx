/**
 * Core's AI-service status chips — a thin adapter over the shared `@eduai/ui`
 * AIServiceIndicators (issues #764, #1551), so Core, QuestionMaker, and AI Tutor
 * show the same two independent chips (Cloud / UBC-hosted) with the same
 * operational / degraded / outage health tiers. Polls `/api/ai-status` via the
 * shared `useAiServiceStatus` hook, which pauses in a hidden tab and shares one
 * request per tick (#1454); the server caches probes, so polling is cheap. Each
 * chip reflects only its own service state.
 *
 * The UBC chip opens a 72-hour history popover backed by
 * `/api/ai-status/history`, which reads the persisted sample table rather than
 * probing live — see the ai-status-probe cron job. History is fetched only
 * once the popover first opens: a panel nobody opens should cost nothing.
 */
import * as React from "react";
import {
  AIServiceIndicators as SharedAIServiceIndicators,
  AIServiceHistoryPanel,
  useAiServiceStatus,
  type HistoryPayload,
} from "@eduai/ui";

export function AIServiceIndicators() {
  const { cloud, ubc, checkedAt, stale, refresh } = useAiServiceStatus({
    endpoint: "/api/ai-status",
    intervalMs: 60_000,
  });

  const [history, setHistory] = React.useState<HistoryPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState(false);

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-status/history?hours=72");
      if (!res.ok) throw new Error(`Status history request failed: ${res.status}`);
      setHistory((await res.json()) as HistoryPayload);
    } catch {
      // Keep the last payload; a single transient failure must not blank the panel.
      setError("Could not load status history.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on first open, then only on explicit refresh.
  React.useEffect(() => {
    if (opened && history === null && !loading) void loadHistory();
  }, [opened, history, loading, loadHistory]);

  const panel = (
    <AIServiceHistoryPanel
      data={history}
      loading={loading}
      error={error}
      stale={stale}
      checkedAt={checkedAt}
      onRefresh={() => {
        refresh();
        void loadHistory();
      }}
    />
  );

  return (
    <span data-tour="ai-status" className="hidden sm:inline-flex" onClick={() => setOpened(true)}>
      <SharedAIServiceIndicators
        cloud={cloud}
        cloudLabel="Managed cloud AI"
        ubc={ubc}
        ubcHistory={panel}
        onRefresh={refresh}
      />
    </span>
  );
}
