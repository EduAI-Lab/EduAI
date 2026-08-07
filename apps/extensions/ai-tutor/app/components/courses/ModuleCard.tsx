/**
 * @file ModuleCard — the module tile used in both the student and instructor
 * course views (course-detail "content" grid).
 *
 * Anatomy: a course-accent gradient rail + a faint order-number motif tucked
 * into the bottom-right corner; a `CardHeader` holding an eyebrow row (ringed
 * order chip + "MODULE" kicker on the left; a read-only Published/Draft
 * `StatusBadge` and an optional publish kebab menu on the right), a bold
 * title, and a description; then an optional
 * `CardContent` with a lesson-count/updated meta row or a student progress bar.
 * The whole card is a single click/keyboard target that navigates to the
 * module — no separate "view" affordance, which would be redundant.
 *
 * Publish state and its action are separated: `isPublished` drives the
 * glanceable badge; `actions` (a `PublishMenu`) carries the toggle, shown only
 * to users who can publish.
 *
 * Data honesty: `lessonCount` and `updatedLabel` are optional and simply omit
 * their row when not supplied — the AI Tutor `Module` type doesn't currently
 * carry a lesson count or an updated timestamp, so callers must not fabricate
 * one. When the backend adds these fields, pass them through and the rows
 * appear automatically.
 */
import type { KeyboardEvent, ReactNode } from 'react';
import { IconBooks } from '@tabler/icons-react';
import {
  Card,
  CardContent,
  CardHeader,
  StatusBadge,
  courseThemeVars,
  type CourseAccentColor,
} from '@eduai/ui';
import { ProgressBarFromData } from '../ProgressBar';
import { cn } from '~/lib/utils';
import { titleName } from '~/lib/course-title';
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
  /** Drives the read-only Published/Draft status badge. */
  isPublished?: boolean;
  /** Optional trailing meta label, e.g. "Updated 2 days ago". */
  updatedLabel?: string;
  /** Eyebrow-right action slot (e.g. the publish `PublishMenu`). Clicks inside are kept from bubbling to the card's navigation handler. */
  actions?: ReactNode;
  /** Eyebrow-left lead slot rendered before the order chip (e.g. a drag handle). */
  leading?: ReactNode;
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
  leading,
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
  const orderLabel = String(index + 1).padStart(2, '0');
  const hasStatus = isPublished !== undefined || Boolean(actions);

  return (
    <Card
      hoverable
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={courseThemeVars(accentColor)}
      data-tour={dataTour}
      data-tour-route={dataTourRoute}
    >
      {/* Accent gradient rail — brightens on hover. */}
      <div
        className="h-1 w-full shrink-0 opacity-80 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background:
            'linear-gradient(90deg, var(--course-accent), color-mix(in oklch, var(--course-accent) 55%, transparent))',
        }}
        aria-hidden="true"
      />

      {/* Ghosted order-number — a watermark pinned to the vertical center of the
          right edge, clear of the title and the bottom progress bar. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none text-[6rem] font-black leading-none tabular-nums"
        style={{ color: 'color-mix(in oklch, var(--course-accent) 10%, transparent)' }}
      >
        {orderLabel}
      </span>

      <CardHeader className="relative gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-2.5">
            {leading}
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums"
              style={{
                background: 'color-mix(in oklch, var(--course-accent) 14%, transparent)',
                color: 'var(--course-accent)',
                boxShadow: 'inset 0 0 0 1px color-mix(in oklch, var(--course-accent) 26%, transparent)',
              }}
            >
              {orderLabel}
            </span>
            <span
              className="text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: 'color-mix(in oklch, var(--course-accent) 78%, var(--muted-foreground))' }}
            >
              Module
            </span>
          </span>

          {hasStatus && (
            <div
              className="flex shrink-0 items-center gap-1"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {isPublished !== undefined && (
                <StatusBadge active={isPublished} activeLabel="Published" inactiveLabel="Draft" />
              )}
              {actions}
            </div>
          )}
        </div>

        <h3 className="line-clamp-2 text-[17px] font-bold leading-snug text-foreground transition-colors group-hover:text-primary-text">
          {titleName(title)}
        </h3>
        {description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>

      {(hasMeta || showProgress) && (
        <CardContent className="relative flex flex-col gap-3 pt-0">
          {hasMeta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
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
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
                Not started yet
              </span>
            ))}
        </CardContent>
      )}
    </Card>
  );
}
