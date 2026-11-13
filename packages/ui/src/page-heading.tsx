import * as React from "react";

import { cn } from "./utils";

export interface PageHeadingProps {
  heading: string;
  subheading?: React.ReactNode;
  /** Merged with the band; add layout classes here without losing the look. */
  className?: string;
  headingClassName?: string;
  /** Tinted panel behind the heading. Turn off for headings that sit on a page-wide surface. */
  banded?: boolean;
}

export function PageHeading({
  heading,
  subheading,
  className,
  headingClassName,
  banded = true,
}: PageHeadingProps) {
  return (
    // `flex-1` rather than `w-full`: beside an action button in a flex row the band
    // takes the space left over instead of pushing the button to the edge.
    <div className={cn(banded && "min-w-0 flex-1 rounded-xl bg-muted/50 px-5 py-4", className)}>
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
      {subheading && <p className="text-muted-foreground">{subheading}</p>}
    </div>
  );
}
