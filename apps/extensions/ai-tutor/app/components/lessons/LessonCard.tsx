/**
 * A single lesson tile inside a module's lesson grid (student + instructor
 * views). Shares the ModuleCard language one level down: a course-accent
 * gradient rail + a faint bottom-right order-number motif; a `CardHeader` with
 * an eyebrow (ringed order chip + "LESSON" kicker on the left; a read-only
 * Published/Draft `StatusBadge` and an optional publish kebab on the right)
 * and a bold title; then an optional `CardContent` with the activity count and
 * learner progress. The whole card is one click/keyboard target that navigates
 * — no separate "view" affordance.
 *
 * Publish state and its action are separated: `isPublished` drives the badge;
 * `menuSlot` (a `PublishMenu`) carries the toggle, shown only to publishers.
 *
 * Progress is student-only: the block renders only when a `progress` object is
 * passed, so instructor cards don't show a learner "Not started yet".
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  StatusBadge,
  courseThemeVars,
  type CourseAccentColor,
} from '@eduai/ui';
import { ProgressBarFromData } from '../ProgressBar';
import type { Progress } from '../../lib/types';
import { cn } from '~/lib/utils';
import { titleName } from '~/lib/course-title';

/**
 * Flatten Markdown source to a compact one-paragraph preview: strip heading
 * hashes, list bullets, emphasis/code markers, and collapse whitespace so the
 * card excerpt reads as plain prose rather than raw Markdown.
 */
function contentExcerpt(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^#{1,6}\s+/gm, '') // heading hashes
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/[*_~]/g, '') // emphasis markers
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LessonCardProps {
  /** 1-based position, rendered (padded) in the order chip when `orderText` is absent. */
  index: number;
  /**
   * Authored order label (e.g. "1.1") shown in the chip + ghost watermark
   * instead of the padded `index`. Use so the number matches the lesson hero
   * eyebrow and breadcrumb (`titleNumber(title)`) rather than a positional
   * index. Takes precedence over `index` when set.
   */
  orderText?: string;
  title: string;
  /**
   * Lesson body (Markdown). A short plain-text excerpt is rendered under the
   * title so authored content is visible on the card, not just in the editor.
   */
  content?: string | null;
  /** Course accent — ties the lesson back to its parent course. Falls back to the brand primary. */
  accentColor?: CourseAccentColor;
  /** Card is clickable when provided — navigates to the lesson. */
  onClick?: () => void;
  /** Learner progress; renders a compact bar or a "Not started yet" note. Omit for instructor cards. */
  progress?: Progress;
  /** Count of activities/questions in the lesson. Omit rather than guessing — never fabricate data. */
  activityCount?: number;
  /** Drives the read-only Published/Draft status badge. */
  isPublished?: boolean;
  /** Eyebrow-right action slot, e.g. the publish `PublishMenu`. */
  menuSlot?: ReactNode;
  className?: string;
  dataTour?: string;
  dataTourRoute?: string;
}

export function LessonCard({
  index,
  orderText,
  title,
  content,
  accentColor,
  onClick,
  progress,
  activityCount,
  isPublished,
  menuSlot,
  className,
  dataTour,
  dataTourRoute,
}: LessonCardProps) {
  const clickable = Boolean(onClick);
  // Authored label (e.g. "1.1") wins; else pad the positional index.
  const orderLabel = orderText ?? String(index).padStart(2, '0');
  const accent = accentColor ?? 'var(--primary)';

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

  const showProgress = progress !== undefined;
  const preview = content?.trim() ? contentExcerpt(content) : '';
  const hasMeta = activityCount != null || showProgress || preview.length > 0;
  const hasStatus = isPublished != null || Boolean(menuSlot);

  return (
    <Card
      hoverable={clickable}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'group relative flex flex-col',
        clickable &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={courseThemeVars(accent)}
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
          right edge, clear of the title and any bottom row. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none text-[4.75rem] font-black leading-none tabular-nums"
        style={{ color: 'color-mix(in oklch, var(--course-accent) 10%, transparent)' }}
      >
        {orderLabel}
      </span>

      <CardHeader className="relative gap-2">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-2.5">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums"
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
              Lesson
            </span>
          </span>

          {hasStatus && (
            <div
              className="flex shrink-0 items-center gap-1"
              onClick={stopStatusPropagation}
              onKeyDown={stopStatusPropagation}
            >
              {isPublished != null && (
                <StatusBadge active={isPublished} activeLabel="Published" inactiveLabel="Draft" />
              )}
              {menuSlot}
            </div>
          )}
        </div>

        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-foreground transition-colors group-hover:text-primary-text">
          {titleName(title)}
        </h3>

        {preview && (
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {preview}
          </p>
        )}
      </CardHeader>

      {hasMeta && (
        <CardContent className="relative flex flex-col gap-3 pt-0">
          {activityCount != null && (
            <div>
              <Badge variant="muted" size="sm">
                {activityCount} {activityCount === 1 ? 'activity' : 'activities'}
              </Badge>
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
