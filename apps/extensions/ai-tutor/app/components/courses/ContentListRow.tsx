/**
 * @file One module or lesson in a staff content list: a Canvas-style stacked
 * row (order, title, a one-line summary, status, ⋯ menu) instead of a card
 * grid, so a long course scans top to bottom. The title is the row's link and
 * stretches over it; the drag handle and menu sit above that layer.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { StatusBadge, cn, courseThemeVars, type CourseAccentColor } from "@eduai/ui";

/** The bordered list the rows sit in. Rows are wrapped by `SortableItem` divs, hence ARIA roles. */
export function ContentList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="list"
      aria-label={label}
      className="overflow-hidden rounded-lg border border-border bg-card [&>*:not(:last-child)]:border-b [&>*]:border-border"
    >
      {children}
    </div>
  );
}

export function ContentListRow({
  orderLabel,
  kind,
  title,
  summary,
  href,
  accentColor,
  isPublished,
  leading,
  menu,
}: {
  /** e.g. "01" or "1.2". */
  orderLabel: string;
  /** "Module" / "Lesson": read with the order by screen readers. */
  kind: string;
  title: string;
  summary?: string | null;
  href: string;
  accentColor: CourseAccentColor;
  isPublished?: boolean;
  /** Before the order chip, e.g. a drag handle. */
  leading?: ReactNode;
  /** Trailing ⋯ menu. */
  menu?: ReactNode;
}) {
  return (
    <div
      role="listitem"
      className="group relative flex items-center gap-3 bg-card px-3 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40"
      style={courseThemeVars(accentColor)}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-[var(--course-accent)] opacity-70"
      />
      {leading && <div className="relative z-10 shrink-0">{leading}</div>}
      <span
        aria-hidden="true"
        className="flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums text-[color-mix(in_oklch,var(--course-accent)_72%,var(--foreground))]"
        style={{ background: "color-mix(in oklch, var(--course-accent) 12%, transparent)" }}
      >
        {orderLabel}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={href}
          className={cn(
            "block truncate text-sm font-semibold text-foreground underline-offset-2",
            "after:absolute after:inset-0 after:content-[''] group-hover:underline",
            "focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring",
          )}
        >
          <span className="sr-only">
            {kind} {orderLabel}:{" "}
          </span>
          {title}
        </Link>
        {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
      </div>
      {isPublished !== undefined && (
        <StatusBadge
          active={isPublished}
          activeLabel="Published"
          inactiveLabel="Unpublished"
          className="shrink-0"
        />
      )}
      {menu && <div className="relative z-10 shrink-0">{menu}</div>}
    </div>
  );
}
