import type { ReactNode } from "react";
import { HERO_GLASS_STYLE, HeroShell, termLabel, type CourseAccentColor } from "@eduai/ui";

/** A solid white button on the banner, labelled in the course colour. */
export const BANNER_PRIMARY_ACTION_CLASS =
  "bg-white text-[var(--course-accent)] shadow-sm hover:bg-white/90 hover:text-[var(--course-accent)]";

/** A see-through button on the banner. */
export const BANNER_SECONDARY_ACTION_CLASS =
  "border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white";

/**
 * A course page's banner (#2105): the course colour and name, kept to one band
 * so the page's own content starts near the top.
 */
export function CourseHeader({
  code,
  term,
  year,
  name,
  department,
  accentColor,
  badges,
  topics = [],
  actions,
  menu,
}: {
  code: string;
  term: string;
  year?: number | string | null;
  name: string;
  department?: string | null;
  accentColor: CourseAccentColor;
  /** Status pills beside the code (e.g. Published). */
  badges?: ReactNode;
  topics?: string[];
  /** The page's main buttons, right-aligned. */
  actions?: ReactNode;
  /** A trailing ⋯ menu or customize control. */
  menu?: ReactNode;
}) {
  return (
    <header data-tour="course-header">
      <HeroShell accentColor={accentColor} className="px-6 py-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-widest opacity-85">
              <span>
                {code} · {termLabel(term, year)}
                {department && ` · ${department}`}
              </span>
              {badges}
            </div>
            <h1 className="mt-1 truncate text-2xl font-bold leading-tight tracking-tight">
              {name}
            </h1>
          </div>
          {(actions || menu) && (
            <div className="flex flex-wrap items-center gap-2">
              {actions}
              {menu}
            </div>
          )}
        </div>
        {topics.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Topics">
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
      </HeroShell>
    </header>
  );
}

/** Active/Inactive, so an archived course doesn't read as a live one. */
export function ActiveBannerBadge({ active }: { active: boolean }) {
  return <BannerBadge>{active ? "Active" : "Inactive"}</BannerBadge>;
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
