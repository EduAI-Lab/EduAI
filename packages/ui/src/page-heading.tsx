import * as React from "react";

import { cn } from "./utils";

export interface PageHeadingProps {
  heading: string;
  subheading?: React.ReactNode;
  className?: string;
  headingClassName?: string;
  /** The page's main action(s), right-aligned on the title row (wrapping below it on narrow screens). */
  actions?: React.ReactNode;
  /**
   * Sets the heading on a lightly tinted band so it stands apart from the page
   * below. On by default; marketing sections that sit on their own backgrounds
   * turn it off.
   */
  banded?: boolean;
}

export function PageHeading({
  heading,
  subheading,
  className,
  headingClassName,
  actions,
  banded = true,
}: PageHeadingProps) {
  const band = banded ? "rounded-xl border border-border/60 bg-muted/50 px-5 py-4" : undefined;
  const headingBlock = (
    <div className={actions ? "min-w-0" : cn(band, className)}>
      <h2 className={headingClassName ?? "text-3xl font-bold tracking-tight"}>{heading}</h2>
      <div
        style={{
          width: 40,
          height: 3,
          background: "var(--gold)",
          borderRadius: 2,
          margin: "6px 0 8px",
        }}
      />
      {subheading && <p className="text-lg text-muted-foreground">{subheading}</p>}
    </div>
  );
  if (!actions) return headingBlock;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", band, className)}>
      {headingBlock}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
