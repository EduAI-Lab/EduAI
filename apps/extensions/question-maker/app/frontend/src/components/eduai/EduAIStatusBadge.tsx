/**
 * Small status badge indicating AI service availability with optional refresh action.
 * For question generation flow, supports optional phases: "generating" and "review".
 */
import { Tooltip } from '@/components/ui/tooltip';
import { RefreshCw } from 'lucide-react';
import type { QuestionGenerationPhase } from '../../hooks/useEduAIStatus';

type EduAIStatus = 'loading' | 'ok' | 'error';

interface EduAIStatusBadgeProps {
  status: EduAIStatus;
  message?: string;
  onRefresh?: () => void;
  compact?: boolean;
  className?: string;
  /** When set (e.g. in Add Question flow), badge shows this phase instead of status label. */
  questionGenerationPhase?: QuestionGenerationPhase;
}

export const EduAIStatusBadge = ({ status, message, onRefresh, compact = false, className, questionGenerationPhase }: EduAIStatusBadgeProps) => {
  const dotColor =
    status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-muted-foreground';

  const phaseLabel =
    questionGenerationPhase === 'generating'
      ? 'Generating'
      : questionGenerationPhase === 'review'
        ? 'Review'
        : null;
  const phaseStyle =
    questionGenerationPhase === 'generating'
      ? 'text-amber-700'
      : questionGenerationPhase === 'review'
        ? 'text-primary-text'
        : null;

  const content = (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-xs font-medium shadow-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} aria-hidden />
      <span className="text-foreground">AI service</span>
      {phaseLabel !== null ? (
        <span className={phaseStyle ?? ''}>{phaseLabel}</span>
      ) : (
        <>
          {status === 'loading' && <span className="text-muted-foreground">Checking…</span>}
          {status === 'error' && <span className="text-red-600">Unavailable</span>}
          {status === 'ok' && <span className="text-emerald-700">Online</span>}
        </>
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-1 inline-flex items-center rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh AI service status"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );

  const tooltipContent =
    questionGenerationPhase === 'generating'
      ? 'Question is being generated…'
      : questionGenerationPhase === 'review'
        ? 'Review the generated question'
        : message || 'AI service status';

  return (
    <Tooltip content={tooltipContent} side="bottom" className={className}>
      {content}
    </Tooltip>
  );
};

export default EduAIStatusBadge;
