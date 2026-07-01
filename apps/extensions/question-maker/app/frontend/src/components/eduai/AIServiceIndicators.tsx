/**
 * Compact AI-service status for the site header: two small chips — UBC-hosted and
 * cloud — instead of one combined badge, so it's obvious at a glance which path is
 * live without hovering. The backend probes a single provider per check (cloud key
 * if present, else the UBC-hosted model), so only the live provider can be reported
 * "Online"; the other chip reads "Not in use" rather than implying it's offline.
 * Clicking either chip re-checks. Shared by the site header and every in-flow AI
 * surface (Add Question, Composer, Upload, Profile, API test bench); when a question
 * is generating it also shows the Generating/Review phase label.
 */
import { Tooltip } from '@/components/ui/tooltip';
import { IconCloud } from '@tabler/icons-react';
import type { QuestionGenerationPhase } from '../../hooks/useEduAIStatus';

type EduAIStatus = 'loading' | 'ok' | 'error';
type DotState = 'online' | 'idle' | 'error' | 'loading';

interface AIServiceIndicatorsProps {
  status: EduAIStatus;
  message?: string;
  provider?: 'google' | 'ollama';
  questionGenerationPhase?: QuestionGenerationPhase;
  onRefresh?: () => void;
  className?: string;
}

const DOT_CLASS: Record<DotState, string> = {
  online: 'bg-emerald-500',
  idle: 'bg-muted-foreground/40',
  error: 'bg-red-500',
  loading: 'bg-amber-400 animate-pulse',
};

function Chip({
  label,
  tooltip,
  dot,
  active,
  onClick,
  children,
}: {
  label: string;
  tooltip: string;
  dot: DotState;
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={tooltip} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`relative inline-flex h-6 w-6 items-center justify-center align-middle rounded-md border border-border bg-card shadow-sm transition-colors hover:bg-muted ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {children}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-card ${DOT_CLASS[dot]}`}
          aria-hidden
        />
      </button>
    </Tooltip>
  );
}

export const AIServiceIndicators = ({
  status,
  message,
  provider,
  questionGenerationPhase,
  onRefresh,
  className,
}: AIServiceIndicatorsProps) => {
  const isOk = status === 'ok';
  const ubcOnline = isOk && provider === 'ollama';
  const cloudOnline = isOk && provider === 'google';

  const ubcDot: DotState =
    status === 'loading' ? 'loading' : ubcOnline ? 'online' : status === 'error' ? 'error' : 'idle';
  const cloudDot: DotState =
    status === 'loading' ? 'loading' : cloudOnline ? 'online' : status === 'error' ? 'error' : 'idle';

  const ubcTip =
    status === 'loading'
      ? 'Checking UBC-hosted AI…'
      : ubcOnline
        ? 'UBC-hosted AI · Online'
        : status === 'error'
          ? message || 'UBC-hosted AI unavailable (needs UBC wifi/VPN)'
          : 'UBC-hosted AI · Not in use — cloud key active';
  const cloudTip =
    status === 'loading'
      ? 'Checking cloud AI…'
      : cloudOnline
        ? 'Cloud AI · Online (your provider key)'
        : status === 'error'
          ? message || 'Cloud AI unavailable — add a provider key in Settings'
          : 'Cloud AI · Not in use — UBC-hosted model active';

  const phaseLabel =
    questionGenerationPhase === 'generating'
      ? 'Generating'
      : questionGenerationPhase === 'review'
        ? 'Review'
        : null;

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      <Chip label="UBC-hosted AI status" tooltip={ubcTip} dot={ubcDot} active={ubcOnline} onClick={onRefresh}>
        <span className="text-[9px] font-bold leading-none tracking-tight">UBC</span>
      </Chip>
      <Chip label="Cloud AI status" tooltip={cloudTip} dot={cloudDot} active={cloudOnline} onClick={onRefresh}>
        <IconCloud className="size-3.5" strokeWidth={1.75} />
      </Chip>
      {phaseLabel !== null && (
        <span
          className={`ml-1 text-xs font-medium ${
            questionGenerationPhase === 'generating' ? 'text-amber-700' : 'text-primary-text'
          }`}
        >
          {phaseLabel}
        </span>
      )}
    </div>
  );
};

export default AIServiceIndicators;
