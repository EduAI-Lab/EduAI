/**
 * @file ModuleCard — the module tile on the student course view.
 *
 * Anatomy: a course-accent gradient rail + a faint order-number motif tucked
 * into the bottom-right corner; a `CardHeader` holding an eyebrow row (ringed
 * order chip + "MODULE" kicker), a bold title, and a description; then an
 * optional `CardContent` with the learner's progress bar. The whole card is a
 * single click/keyboard target that navigates to the module.
 */
import type { KeyboardEvent } from "react";
import { Card, CardContent, CardHeader, courseThemeVars, type CourseAccentColor } from "@eduai/ui";
import { ProgressBarFromData } from "../ProgressBar";
import { cn } from "~/lib/utils";
import { titleName } from "~/lib/course-title";
import type { Progress } from "~/lib/types";

export interface ModuleCardProps {
  /** Module title — clamped to 2 lines. */
  title: string;
  description?: string | null;
  /** 0-based position, rendered as a leading order chip ("01", "02", ...). */
  index: number;
  /** Course accent colour — ties every module card back to its parent course. */
  accentColor: CourseAccentColor;
  /**
   * When true, renders the student progress row: a bar when
   * `progress.total > 0`, otherwise a "Not started yet" note.
   */
  showProgress?: boolean;
  progress?: Progress;
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
  showProgress = false,
  progress,
  onClick,
  className,
  dataTour,
  dataTourRoute,
}: ModuleCardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  const orderLabel = String(index + 1).padStart(2, "0");

  return (
    <Card
      hoverable
      role="button"
      // Named explicitly so the order chip and kicker don't pad the name.
      aria-label={`Module: ${titleName(title)}`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
            "linear-gradient(90deg, var(--course-accent), color-mix(in oklch, var(--course-accent) 55%, transparent))",
        }}
        aria-hidden="true"
      />

      {/* Ghosted order-number — a watermark pinned to the vertical center of the
          right edge, clear of the title and the bottom progress bar. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 select-none text-[6rem] font-black leading-none tabular-nums"
        style={{ color: "color-mix(in oklch, var(--course-accent) 10%, transparent)" }}
      >
        {orderLabel}
      </span>

      <CardHeader className="relative gap-2">
        <span className="inline-flex items-center gap-2.5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums"
            style={{
              background: "color-mix(in oklch, var(--course-accent) 14%, transparent)",
              color: "var(--course-accent)",
              boxShadow:
                "inset 0 0 0 1px color-mix(in oklch, var(--course-accent) 26%, transparent)",
            }}
          >
            {orderLabel}
          </span>
          <span
            className="text-[11px] font-bold uppercase tracking-[0.16em]"
            style={{
              color: "color-mix(in oklch, var(--course-accent) 78%, var(--muted-foreground))",
            }}
          >
            Module
          </span>
        </span>

        <h3 className="line-clamp-2 text-[17px] font-bold leading-snug text-foreground transition-colors group-hover:text-primary-text">
          {titleName(title)}
        </h3>
        {description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </CardHeader>

      {showProgress && (
        <CardContent className="relative flex flex-col gap-3 pt-0">
          {progress && progress.total > 0 ? (
            <ProgressBarFromData progress={progress} size="sm" showLabel />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden="true" />
              Not started yet
            </span>
          )}
        </CardContent>
      )}
    </Card>
  );
}
