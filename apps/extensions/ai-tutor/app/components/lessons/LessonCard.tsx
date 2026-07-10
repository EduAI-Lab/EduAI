/**
 * A single lesson row inside a module's lesson list (student + instructor
 * views). Anatomy: order badge + title, an optional activity-count meta row,
 * learner progress (when known), a publish-status indicator, and a clear
 * "go to lesson" action. Both `student.module.tsx` and `instructor.module.tsx`
 * render a grid of these instead of hand-rolling `Card` markup per route.
 *
 * The whole card is a click target (nav to the lesson); `statusSlot` (e.g.
 * the instructor's interactive `PublishStatusButton`) stops propagation
 * internally so toggling publish state doesn't also navigate away.
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import { Badge, Card, CardContent, CardFooter, CardHeader, CardTitle, StatusBadge } from '@eduai/ui';
import { ProgressBarFromData } from '../ProgressBar';
import type { Progress } from '../../lib/types';
import { cn } from '~/lib/utils';

export interface LessonCardProps {
  /** 1-based position, rendered in the order chip. */
  index: number;
  title: string;
  /** Card is clickable when provided — navigates to the lesson. */
  onClick?: () => void;
  /** Learner progress; renders a compact bar + percentage. Omit when unknown (e.g. instructor view). */
  progress?: Progress;
  /** Count of activities/questions in the lesson. Omit rather than guessing — never fabricate data. */
  activityCount?: number;
  /**
   * Publish state. When set and `statusSlot` is omitted, renders a read-only
   * `StatusBadge` ("Published"/"Draft").
   */
  isPublished?: boolean;
  /** Overrides the default status badge with a custom control, e.g. an interactive publish toggle. */
  statusSlot?: ReactNode;
  /** Footer CTA copy, e.g. "Start lesson" / "Continue lesson" / "View lesson". */
  actionLabel?: string;
  className?: string;
  dataTour?: string;
  dataTourRoute?: string;
}

export function LessonCard({
  index,
  title,
  onClick,
  progress,
  activityCount,
  isPublished,
  statusSlot,
  actionLabel = 'View lesson',
  className,
  dataTour,
  dataTourRoute,
}: LessonCardProps) {
  const clickable = Boolean(onClick);
  const hasProgress = Boolean(progress && progress.total > 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const stopStatusPropagation = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
  };

  return (
    <Card
      hoverable={clickable}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group flex flex-col',
        clickable &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      data-tour={dataTour}
      data-tour-route={dataTourRoute}
    >
      <CardHeader className="gap-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold tabular-nums text-secondary-foreground">
            {String(index).padStart(2, '0')}
          </span>
          {activityCount != null && (
            <Badge variant="muted" size="sm">
              {activityCount} {activityCount === 1 ? 'activity' : 'activities'}
            </Badge>
          )}
        </div>
        <CardTitle className="line-clamp-2 text-base transition-colors group-hover:text-primary">
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1">
        {hasProgress ? (
          <ProgressBarFromData progress={progress} size="sm" showLabel />
        ) : (
          <p className="text-sm text-muted-foreground">Not started yet</p>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-3">
        <div onClick={stopStatusPropagation} onKeyDown={stopStatusPropagation}>
          {statusSlot ??
            (isPublished != null && (
              <StatusBadge active={isPublished} activeLabel="Published" inactiveLabel="Draft" />
            ))}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-text">
          {actionLabel}
          <IconChevronRight size={15} aria-hidden="true" />
        </span>
      </CardFooter>
    </Card>
  );
}
