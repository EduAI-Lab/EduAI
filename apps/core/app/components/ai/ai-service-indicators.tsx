/**
 * Core's AI-service status chips — a thin adapter over the shared `@eduai/ui`
 * AIServiceIndicators (issue #764), so Core, QuestionMaker, and AI Tutor show the
 * same two independent chips (Cloud / UBC-hosted). Polling lives in `useAiStatus`,
 * which shares one request across consumers and pauses while the tab is hidden
 * (#1454). Each chip reflects only its own service state.
 */
import { AIServiceIndicators as SharedAIServiceIndicators, type ServiceStatus } from "@eduai/ui";
import { useAiStatus, type AiServiceStatus } from "~/hooks/api/use-ai-status";

const LOADING: ServiceStatus = { state: "loading" };

export function AIServiceIndicators() {
  const { status, refresh } = useAiStatus();

  const toStatus = (s?: AiServiceStatus): ServiceStatus =>
    s ? { state: s.state, detail: s.detail } : LOADING;

  return (
    <span data-tour="ai-status" className="hidden sm:inline-flex">
      <SharedAIServiceIndicators
        cloud={toStatus(status?.cloud)}
        ubc={toStatus(status?.ubc)}
        onRefresh={() => void refresh()}
      />
    </span>
  );
}
