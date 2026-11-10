/**
 * @file The staff page banner for course, module and lesson pages: the course
 * colour and name in one band, matching Core's `CourseHeader` (#2105), so the
 * page's own content starts near the top.
 */
import type { ReactNode } from "react";
import { HERO_GLASS_STYLE, HeroShell, type CourseAccentColor } from "@eduai/ui";

/** A solid white button on the banner, labelled in the course colour. */
export const BANNER_PRIMARY_ACTION_CLASS =
  "bg-white font-semibold text-[var(--course-accent)] shadow-sm hover:bg-white/90 hover:text-[var(--course-accent)]";

/** A see-through button on the banner. */
export const BANNER_SECONDARY_ACTION_CLASS =
  "border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white";

/** The ⋯ trigger on the banner. */
export const BANNER_MENU_TRIGGER_CLASS =
  "flex size-8 items-center justify-center rounded-md text-white/90 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

export function CourseHeader({
  eyebrow,
  title,
  accentColor,
  badges,
  meta,
  topics = [],
  topicsAction,
  actions,
  menu,
}: {
  /** The small line above the title, e.g. "COSC 101 · 2026-27W1". */
  eyebrow: ReactNode;
  title: string;
  accentColor: CourseAccentColor;
  /** Status pills beside the eyebrow (e.g. Published). */
  badges?: ReactNode;
  /** One quiet line under the title, e.g. "2 lessons · 1 published". */
  meta?: ReactNode;
  topics?: string[];
  /** A control beside the topic chips (e.g. add a topic). */
  topicsAction?: ReactNode;
  /** The page's main buttons, right-aligned. */
  actions?: ReactNode;
  /** A trailing ⋯ menu. */
  menu?: ReactNode;
}) {
  const showTopics = topics.length > 0 || Boolean(topicsAction);
  return (
    <header data-tour="course-header">
      <HeroShell accentColor={accentColor} className="px-6 py-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-widest opacity-90">
              <span>{eyebrow}</span>
              {badges}
            </div>
            <h1 className="mt-1 truncate text-2xl font-bold leading-tight tracking-tight">
              {title}
            </h1>
            {meta && <p className="mt-1 text-sm opacity-90">{meta}</p>}
          </div>
          {(actions || menu) && (
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              {menu}
            </div>
          )}
        </div>
        {showTopics && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {topics.length > 0 && (
              <ul className="contents" aria-label="Topics">
                {topics.map((t) => (
                  <li
                    key={t}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-sm"
                    style={HERO_GLASS_STYLE}
                  >
                    {t}
                  </li>
                ))}
              </ul>
            )}
            {topicsAction}
          </div>
        )}
      </HeroShell>
    </header>
  );
}

/** A status pill that reads on the banner. */
export function BannerBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal"
      style={{ background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.28)" }}
    >
      {children}
    </span>
  );
}
