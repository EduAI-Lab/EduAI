/**
 * @file ModuleCard — the module tile used in both the student and instructor
 * course views (course-detail "content" grid).
 *
 * Anatomy: a course-accent-tinted order chip + title/description, an optional
 * lesson-count meta row, either a student progress bar or an instructor
 * publish StatusBadge, and a footer "View module" link. The whole card is a
 * single click/keyboard target that navigates to the module.
 *
 * Data honesty: `lessonCount` and `updatedLabel` are optional and simply omit
 * their row when not supplied — the AI Tutor `Module` type doesn't currently
 * carry a lesson count or an updated timestamp, so callers must not fabricate
 * one. When the backend adds these fields, pass them through and the rows
 * appear automatically.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { IconBooks, IconChevronRight } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  StatusBadge,
  courseThemeVars,
  type CourseAccentColor,
} from '@eduai/ui';
import { ProgressBarFromData } from '../ProgressBar';
import { cn } from '~/lib/utils';
import type { Progress } from '~/lib/types';

export interface ModuleCardProps {
  /** Module title — clamped to 2 lines. */
  title: string;
  description?: string | null;
  /** 0-based position, rendered as a leading order chip ("01", "02", ...). */
  index: number;
  /** Course accent colour — ties every module card back to its parent course. */
  accentColor: CourseAccentColor;
  /** Total lesson count. Omitted (no row) when unknown — never fabricated. */
  lessonCount?: number;
  /**
   * When true, renders the student progress row: a bar when
   * `progress.total > 0`, otherwise a "Not started yet" note.
   */
  showProgress?: boolean;
  progress?: Progress;
  /** When provided, renders an instructor Published/Draft StatusBadge. */
  isPublished?: boolean;
  /** Optional trailing meta label, e.g. "Updated 2 days ago". */
  updatedLabel?: string;
  /** Footer-right slot for instructor-only controls (e.g. PublishStatusButton). Clicks inside are kept from bubbling to the card's navigation handler. */
  actions?: ReactNode;
  onClick: () => void;
  className?: string;
  dataTour?: string;
  dataTourRoute?: string;
}

export function ModuleCard({
  title,
  description,
  index,
  accentColor,
  lessonCount,
  showProgress = false,
  progress,
  isPublished,
  updatedLabel,
  actions,
  onClick,
  className,
  dataTour,
  dataTourRoute,
}: ModuleCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const hasMeta = lessonCount !== undefined || updatedLabel;

  return (
    <Card
      hoverable
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative cursor-pointer border-l-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={{ borderLeftColor: accentColor, ...courseThemeVars(accentColor) }}
      data-tour={dataTour}
      data-tour-route={dataTourRoute}
    >
      <CardHeader className="flex-row items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
          style={{
            background: 'color-mix(in oklch, var(--course-accent) 14%, transparent)',
            color: 'var(--course-accent)',
          }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-base font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
              {title}
            </h3>
            {isPublished !== undefined && (
              <StatusBadge
                active={isPublished}
                activeLabel="Published"
                inactiveLabel="Draft"
                className="mt-0.5 shrink-0"
              />
            )}
          </div>
          {description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </CardHeader>

      {(hasMeta || showProgress) && (
        <CardContent className="space-y-3">
          {hasMeta && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {lessonCount !== undefined && (
                <span className="inline-flex items-center gap-1.5">
                  <IconBooks size={14} aria-hidden="true" />
                  {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'}
                </span>
              )}
              {updatedLabel && <span>{updatedLabel}</span>}
            </div>
          )}

          {showProgress &&
            (progress && progress.total > 0 ? (
              <ProgressBarFromData progress={progress} size="sm" showLabel />
            ) : (
              <p className="text-sm text-muted-foreground">Not started yet</p>
            ))}
        </CardContent>
      )}

      <CardFooter className="justify-between">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-text">
          View module
          <IconChevronRight size={15} aria-hidden="true" />
        </span>
        {actions && (
          <div
            className="relative z-10"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
