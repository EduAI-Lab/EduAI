/** Standard titled content card used across dashboard + course analytics panels. */
import type { ReactNode } from "react";
import { cn } from "../utils";

export interface PanelCardProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Leading glyph before the title, e.g. to mark a card that needs attention. */
  icon?: ReactNode;
  /** Extra classes for the title, e.g. a colour that sets one card's header apart. */
  titleClassName?: string;
}

export function PanelCard({
  title,
  action,
  children,
  className,
  icon,
  titleClassName,
}: PanelCardProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] border border-border bg-card p-5 shadow-[var(--shadow-2xs)]",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3
          className={cn(
            "flex items-center gap-2 text-base font-semibold text-foreground",
            titleClassName,
          )}
        >
          {icon}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
