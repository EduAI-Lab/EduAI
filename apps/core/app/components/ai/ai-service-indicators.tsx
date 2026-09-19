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
  useHistoryOnOpen,
  type HistoryPayload,
} from "@eduai/ui";

/** Matches AI Tutor and Question Maker: the snapshot only changes when the cron probe runs. */
const POLL_INTERVAL_MS = 300_000;

export function AIServiceIndicators() {
  const { cloud, ubc, checkedAt, stale, refresh } = useAiServiceStatus({
    endpoint: "/api/ai-status",
    intervalMs: POLL_INTERVAL_MS,
  });

  const fetchHistory = React.useCallback(async (): Promise<HistoryPayload> => {
    const res = await fetch("/api/ai-status/history?hours=72");
    if (!res.ok) throw new Error(`Status history request failed: ${res.status}`);
    return (await res.json()) as HistoryPayload;
  }, []);

  // One request per deliberate open, even when every one of them fails — see
  // `useHistoryOnOpen` for the loop this replaced.
  const {
    data: history,
    loading,
    error,
    onOpenChange,
    refresh: refreshHistory,
  } = useHistoryOnOpen(fetchHistory);

  const panel = (
    <AIServiceHistoryPanel
      data={history}
      loading={loading}
      error={error}
      stale={stale}
      checkedAt={checkedAt}
      current={ubc}
      onRefresh={() => {
        refresh();
        refreshHistory();
      }}
    />
  );

  return (
    <span data-tour="ai-status" className="hidden sm:inline-flex">
      <SharedAIServiceIndicators
        cloud={cloud}
        cloudLabel="Managed cloud AI"
        ubc={ubc}
        ubcHistory={panel}
        onRefresh={refresh}
        onUbcOpenChange={onOpenChange}
      />
    </span>
  );
}
