import type { Progress } from '~/lib/types';

interface ProgressBarProps {
  completed: number;
  total: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  completed,
  total,
  size = 'md',
  showLabel = true,
  className = '',
}: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = percentage === 100;

  const heights = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-3.5',
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground font-medium">
            {completed} of {total} completed
          </span>
          <span className="font-bold tabular-nums text-foreground">{percentage}%</span>
        </div>
      )}
      <div className={`relative w-full bg-secondary rounded-full overflow-hidden ${heights[size]}`}>
        {/* Track glow on completion */}
        {isComplete && <div className="absolute inset-0 bg-primary/30 animate-pulse-soft" />}

        {/* Progress fill */}
        <div
          className="h-full rounded-full transition-all duration-700 ease-out relative bg-primary"
          style={{ width: `${percentage}%` }}
        >
          {/* Shimmer effect for in-progress */}
          {!isComplete && percentage > 0 && percentage < 100 && (
            <div className="absolute inset-0 animate-shimmer" />
          )}
        </div>
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
