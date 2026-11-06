import * as React from "react";

import { cn } from "./utils";

export interface PageHeadingProps {
  heading: string;
  subheading?: React.ReactNode;
  className?: string;
  headingClassName?: string;
  /** The page's main action(s), right-aligned on the title row (wrapping below it on narrow screens). */
  actions?: React.ReactNode;
}

export function PageHeading({
  heading,
  subheading,
  className,
  headingClassName,
  actions,
}: PageHeadingProps) {
  const headingBlock = (
    <div className={actions ? "min-w-0" : className}>
      <h2 className={headingClassName ?? "text-2xl font-bold"}>{heading}</h2>
      <div
        style={{
          width: 40,
          height: 3,
          background: "var(--gold)",
          borderRadius: 2,
          margin: "6px 0 8px",
        }}
      />
      {subheading && <p className="text-muted-foreground">{subheading}</p>}
    </div>
  );
  if (!actions) return headingBlock;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      {headingBlock}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
