import {
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import type { OCRJob, OCRJobStatus } from '../../types/ocr';

function formatTimeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr ago`;
  if (days < 7) return `${days} day ago`;
  return d.toLocaleDateString();
}

interface OCRJobCardProps {
  job: OCRJob;
  isCurrentCourse: boolean;
  onSelect?: (job: OCRJob) => void;
  onRemove?: (jobId: string) => void;
}

const statusConfig: Record<
  OCRJobStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    className: string;
    badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'text-amber-500',
    badgeVariant: 'outline',
  },
  processing: {
    label: 'Processing',
    icon: Loader2,
    className: 'text-blue-500 animate-spin',
    badgeVariant: 'secondary',
  },
  success: {
    label: 'Complete',
    icon: CheckCircle2,
    className: 'text-emerald-500',
    badgeVariant: 'default',
  },
  error: {
    label: 'Failed',
    icon: XCircle,
    className: 'text-destructive',
    badgeVariant: 'destructive',
  },
  discarded: {
    label: 'Discarded',
    icon: AlertCircle,
    className: 'text-muted-foreground',
    badgeVariant: 'outline',
  },
};

export function OCRJobCard({
  job,
  isCurrentCourse,
  onSelect,
  onRemove,
}: OCRJobCardProps) {
  const config = statusConfig[job.status];
  const StatusIcon = config.icon;

  const isClickable =
    (job.status === 'success' || job.status === 'discarded') &&
    job.storedQuestions &&
    job.storedQuestions.length > 0;

  const timeAgo = formatTimeAgo(job.createdAt);
  const displayFileName =
    job.fileName.length > 24 ? `${job.fileName.slice(0, 21)}...` : job.fileName;

  const handleClick = () => {
    if (isClickable && onSelect) onSelect(job);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(job.id);
  };

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick();
        }
      }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border p-3 transition-colors',
        isClickable && 'cursor-pointer hover:bg-accent/50',
        !isCurrentCourse && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          {job.fileName.length > 24 ? (
            <Tooltip content={job.fileName} side="top">
              <p className="truncate text-sm font-medium leading-tight">{displayFileName}</p>
            </Tooltip>
          ) : (
            <p className="truncate text-sm font-medium leading-tight">{displayFileName}</p>
          )}
          {!isCurrentCourse && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{job.courseName}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handleRemove}
          aria-label={`Remove ${job.fileName} from history`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Tooltip
          content={
            job.status === 'pending' || job.status === 'processing'
              ? 'Upload in progress. Wait for it to complete before you can restore.'
              : job.status === 'error'
                ? 'This upload failed. Remove from history or try uploading again.'
                : isClickable && isCurrentCourse
                  ? 'Click to load these questions into the review area.'
                  : isClickable && !isCurrentCourse
                    ? 'This upload was for a different course. Switch course to restore.'
                    : `${config.label}.`
          }
          side="top"
        >
          <div className="flex items-center gap-1.5">
            <StatusIcon className={cn('size-3.5', config.className)} />
            <Badge variant={config.badgeVariant} className="text-[10px] px-1.5 py-0">
              {config.label}
            </Badge>
          </div>
        </Tooltip>
        <span className="text-[10px] text-muted-foreground">{timeAgo}</span>
      </div>

      {job.status === 'success' && job.questionsCount !== undefined && (
        <p className="text-xs text-muted-foreground">
          {job.questionsCount} question{job.questionsCount !== 1 ? 's' : ''} extracted
        </p>
      )}

      {job.status === 'error' && job.error && (
        <Tooltip content={job.error} side="bottom">
          <p className="text-xs text-destructive truncate cursor-help">{job.error}</p>
        </Tooltip>
      )}

      {isClickable && isCurrentCourse && (
        <p className="text-[10px] text-muted-foreground italic">Click to restore questions</p>
      )}

      {isClickable && !isCurrentCourse && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 italic">
          Different course - click to view
        </p>
      )}
    </div>
  );
}
