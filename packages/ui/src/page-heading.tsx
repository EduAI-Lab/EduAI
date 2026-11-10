import * as React from "react";

export interface PageHeadingProps {
  heading: string;
  subheading?: React.ReactNode;
  className?: string;
  headingClassName?: string;
}

export function PageHeading({
  heading,
  subheading,
  className,
  headingClassName,
}: PageHeadingProps) {
  return (
    <div className={className ?? "rounded-xl bg-muted/50 px-5 py-4"}>
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
