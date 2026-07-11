/**
 * AI Tutor's AI-service status chips — a thin adapter over the shared `@eduai/ui`
 * AIServiceIndicators (issue #764), so Core, QuestionMaker, and AI Tutor show the
 * same two independent chips (Cloud / UBC-hosted). AI Tutor delegates AI to
 * EduAI Core, so `/api/ai-status` proxies Core's probe — the data is identical to
 * Core's. Each chip reflects only its own service state.
 */
import * as React from 'react';
import { AIServiceIndicators as SharedAIServiceIndicators, type ServiceStatus } from '@eduai/ui';

import api from '~/lib/api';

type ApiServiceStatus = { state: 'online' | 'offline' | 'loading' | 'unknown'; detail?: string };
type ApiStatus = { cloud: ApiServiceStatus; ubc: ApiServiceStatus };

const POLL_MS = 60_000;
const LOADING: ServiceStatus = { state: 'loading' };

export function AiServiceIndicators() {
  const [status, setStatus] = React.useState<ApiStatus | null>(null);
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = (await api.aiStatus()) as ApiStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // Transient — keep the last known status until the next poll.
      }
    };
    refreshRef.current = () => void load();
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toStatus = (s?: ApiServiceStatus): ServiceStatus =>
    s ? { state: s.state, detail: s.detail } : LOADING;

  return (
    <span className="hidden sm:inline-flex">
      <SharedAIServiceIndicators
        cloud={toStatus(status?.cloud)}
        ubc={toStatus(status?.ubc)}
        onRefresh={() => refreshRef.current()}
      />
    </span>
  );
}
