import type { Progress } from '~/lib/types';

interface ProgressBarProps {
  completed: number;
  total: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

// Track heights on the same 3-step scale MeterBar's fixed track approximates —
// keeping ProgressBar's size variants means call sites that need a compact
// (list-row) or roomy (course-detail) bar still can, which MeterBar's fixed
// h-2 track can't do.
const TRACK_HEIGHTS: Record<NonNullable<ProgressBarProps['size']>, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-3.5',
};

/**
 * DS-token progress bar: muted track (`bg-muted`, matches `@eduai/ui`'s
 * `MeterBar`) + primary fill. Same visual language as MeterBar, kept as a
 * separate small component (rather than delegating to MeterBar) because
 * MeterBar has no `size` variant — several call sites rely on the compact
 * `sm` track for dense lists.
 */
export function ProgressBar({
  completed,
  total,
  size = 'md',
  showLabel = true,
  className = '',
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={`space-y-2 ${className}`}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">
            {completed} of {total} completed
          </span>
          <span className="font-bold tabular-nums text-foreground">{percentage}%</span>
        </div>
      )}
      <div className={`w-full overflow-hidden rounded-full bg-muted ${TRACK_HEIGHTS[size]}`}>
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function ProgressBarFromData({
  progress,
  size,
  showLabel,
  className,
}: {
  progress?: Progress;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}) {
  if (!progress) {
    return null;
  }

  return (
    <ProgressBar
      completed={progress.completed}
      total={progress.total}
      size={size}
      showLabel={showLabel}
      className={className}
    />
  );
}
