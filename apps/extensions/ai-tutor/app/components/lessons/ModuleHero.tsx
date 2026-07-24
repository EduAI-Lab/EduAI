/**
 * @file ModuleHero — the banner atop a module's lesson list (instructor +
 * student module views).
 *
 * Composes the shared `@eduai/ui` `HeroShell` — the same solid course-accent
 * surface, white text, `radius-xl`, `p-6`, glow shadow — and its
 * `HERO_GLASS_STYLE` badge treatment, the same shell `CourseHeroCard` uses, so
 * a module reads as the *container* and its lessons (the light `LessonCard`
 * tiles below) as the *children*.
 *
 * What makes it its OWN hero, not a course-hero clone: a ghosted order-number
 * watermark tucked into the bottom-right (the `LessonCard`/`ModuleCard` motif,
 * pulled up to hero scale), and a split meta row — glass stat badges on the
 * left, a progress bar on the right. That combination is unique to the module
 * tier.
 *
 * Each view supplies its own numbers:
 *   - instructor → total / published / draft lesson counts as glass badges + a
 *     Draft/Published badge, and drops its "Add lesson" / "Import" buttons into
 *     `actions`.
 *   - student → total lessons + a progress bar (real, derived from each
 *     lesson's progress — never fabricated).
 *
 * Data honesty: `order`, `stats`, and `progress` are optional and simply omit
 * their block when not supplied. `order` must be the module's real index among
 * its siblings (1-based) — callers derive it from the ordered module list, NOT
 * from the raw `position` field, which is 1-based from the seed but 0-based via
 * UI create. When it can't be resolved, omit it and the watermark hides.
 */
import type { ReactNode } from 'react';
import { HERO_GLASS_STYLE, HeroShell, type CourseAccentColor } from '@eduai/ui';
import { titleName } from '~/lib/course-title';

export interface ModuleHeroStat {
  label: string;
  value: number | string;
  /**
   * Accepted for call-site compatibility but no longer honoured — every stat
   * badge shares the hero's white-glass treatment.
   */
  accent?: boolean;
}

export interface ModuleHeroProps {
  /**
   * Real 1-based index among sibling modules — drives the ghost watermark.
   * Derive from the ordered module list, never the raw `position` field (see
   * file header). Omit to hide the watermark.
   */
  order?: number;
  /**
   * Authored order label (e.g. "1.1") shown in the eyebrow + watermark instead
   * of the padded numeric `order`. Use for lesson heroes so the number matches
   * the breadcrumb's `splitTitle(title).label` rather than a positional index.
   * Takes precedence over `order` when set.
   */
  orderText?: string;
  title: string;
  description?: string | null;
  /** Course accent — ties the module back to its parent course. */
  accentColor?: CourseAccentColor;
  /** Eyebrow kicker. Defaults to "Module". */
  eyebrow?: string;
  /** Renders a read-only Draft/Published badge when provided (instructor). */
  isPublished?: boolean;
  /** Summary counts shown as glass badges. */
  stats?: ModuleHeroStat[];
  /** Overall progress bar (student). Rendered only when total > 0. */
  progress?: { completed: number; total: number } | null;
  /** Trailing action slot, e.g. the instructor "Add lesson" / "Import" buttons. */
  actions?: ReactNode;
}

export function ModuleHero({
  order,
  orderText,
  title,
  description,
  accentColor,
  eyebrow = 'Module',
  isPublished,
  stats,
  progress,
  actions,
}: ModuleHeroProps) {
  const accent = (accentColor ?? 'var(--primary)') as CourseAccentColor;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;
  const hasProgress = Boolean(progress && progress.total > 0);
  const hasBadges = Boolean(stats?.length) || isPublished != null;
  // `orderText` (authored, e.g. "1.1") wins; else pad the numeric index.
  const orderLabel =
    orderText ?? (order != null && order > 0 ? String(order).padStart(2, '0') : null);
  const hasOrder = orderLabel != null;

  return (
    <HeroShell accentColor={accent}>
      {/* Ghost order watermark — the module-tier signature. */}
      {hasOrder && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -right-4 select-none text-[11rem] font-black leading-none tabular-nums text-white/10"
        >
          {orderLabel}
        </span>
      )}

      {/* Two columns: identity on the left; badges pinned top-right and the
          progress bar pinned bottom-right (via justify-between). */}
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col">
          {/* Kicker carries the tier label + order number; the headline is the
              name alone — no "Module 1 — Name" prefix/em dash to repeat it. */}
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest opacity-80">
            <span>{eyebrow}</span>
            {orderLabel && <span className="tabular-nums opacity-90">{orderLabel}</span>}
          </div>
          <h1 className="mb-2 text-xl font-bold leading-snug tracking-tight">{titleName(title)}</h1>
          {description && (
            <p className="line-clamp-3 max-w-[560px] whitespace-pre-line text-[13px] leading-relaxed opacity-90">
              {description}
            </p>
          )}
        </div>

        {(actions || hasBadges || hasProgress) && (
          <div className="flex shrink-0 flex-col gap-4 sm:items-end">
            {/* Top-right cluster: actions, then the stat badges. */}
            {(actions || hasBadges) && (
              <div className="flex flex-col gap-2.5 sm:items-end">
                {actions && <div className="flex items-center gap-2">{actions}</div>}
                {hasBadges && (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {isPublished != null && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur-sm"
                        style={HERO_GLASS_STYLE}
                      >
                        <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
                        {isPublished ? 'Published' : 'Draft'}
                      </span>
                    )}
                    {stats?.map((stat) => (
                      <span
                        key={stat.label}
                        className="rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm"
                        style={HERO_GLASS_STYLE}
                      >
                        <span className="font-bold tabular-nums">{stat.value}</span> {stat.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bottom-right: progress bar. */}
            {hasProgress && progress && (
              <div className="w-full sm:w-72">
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest opacity-80">
                  <span>Your progress</span>
                  <span className="tabular-nums">{pct}%</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full"
                  style={{ background: 'rgba(255,255,255,0.22)' }}
                >
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[12px] opacity-80">
                  {progress.completed} of {progress.total} activities completed
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </HeroShell>
  );
}
