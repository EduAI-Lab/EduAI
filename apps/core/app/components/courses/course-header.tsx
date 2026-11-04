import type { ReactNode } from "react";
import { termLabel, type CourseAccentColor } from "@eduai/ui";

/**
 * A course page's compact title bar (#2105), in place of the tall hero: Canvas
 * keeps the course name small so the page's own content starts near the top.
 */
export function CourseHeader({
  code,
  term,
  year,
  name,
  accentColor,
  badges,
  actions,
  menu,
}: {
  code: string;
  term: string;
  year?: number | string | null;
  name: string;
  accentColor: CourseAccentColor;
  /** Status pills beside the code (e.g. Published). */
  badges?: ReactNode;
  /** The page's main buttons, right-aligned. */
  actions?: ReactNode;
  /** A trailing ⋯ menu or customize control. */
  menu?: ReactNode;
}) {
  return (
    <header
      className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-4"
      data-tour="course-header"
    >
      <span
        aria-hidden="true"
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ background: accentColor }}
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold leading-tight text-foreground">{name}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">
            {code} · {termLabel(term, year)}
          </span>
          {badges}
        </div>
      </div>
      {(actions || menu) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {menu}
        </div>
      )}
    </header>
  );
}
