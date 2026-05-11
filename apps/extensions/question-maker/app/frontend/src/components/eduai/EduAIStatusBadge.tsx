/**
 * Small status badge indicating AI service availability with optional refresh action.
 * For question generation flow, supports optional phases: "generating" and "review".
 */
import { RefreshCw } from 'lucide-react';
import { Tooltip } from '../ui/tooltip';
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
    status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-gray-400';

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
        ? 'text-blue-700'
        : null;

  const content = (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium shadow-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} aria-hidden />
      <span className="text-gray-700">AI service</span>
      {phaseLabel !== null ? (
        <span className={phaseStyle ?? ''}>{phaseLabel}</span>
      ) : (
        <>
          {status === 'loading' && <span className="text-gray-500">Checking…</span>}
          {status === 'error' && <span className="text-red-600">Unavailable</span>}
          {status === 'ok' && <span className="text-emerald-700">Online</span>}
        </>
      )}
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-1 inline-flex items-center rounded-full p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
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
