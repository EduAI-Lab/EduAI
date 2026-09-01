/**
 * Core's AI-service status chips — a thin adapter over the shared `@eduai/ui`
 * AIServiceIndicators (issues #764, #1551), so Core, QuestionMaker, and AI Tutor
 * show the same two independent chips (Cloud / UBC-hosted) with the same
 * operational / degraded / outage health tiers. Polls `/api/ai-status` via the
 * shared `useAiServiceStatus` hook, which pauses in a hidden tab and shares one
 * request per tick (#1454); the server caches probes, so polling is cheap. Each
 * chip reflects only its own service state.
 */
import { AIServiceIndicators as SharedAIServiceIndicators, useAiServiceStatus } from "@eduai/ui";

export function AIServiceIndicators() {
  const { cloud, ubc, refresh } = useAiServiceStatus({
    endpoint: "/api/ai-status",
    intervalMs: 60_000,
  });

  return (
    <span data-tour="ai-status" className="hidden sm:inline-flex">
      <SharedAIServiceIndicators
        cloud={cloud}
        cloudLabel="Managed cloud AI"
        ubc={ubc}
        onRefresh={refresh}
      />
    </span>
  );
}
