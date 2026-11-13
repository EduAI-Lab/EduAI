import * as React from "react";

import { usePersistedFlag } from "./nav-shell";
import { Button } from "./ui/button";
import { cn } from "./utils";

export interface CollapsibleSectionProps {
  title: string;
  /** localStorage key; the collapsed state is remembered per device. */
  storageKey: string;
  children: React.ReactNode;
  /** Extra classes for the title row, e.g. a divider when the section sits in a side panel. */
  headerClassName?: string;
  /** Replaces the default `text-lg font-semibold text-foreground` title style. */
  titleClassName?: string;
}

export function CollapsibleSection({
  title,
  storageKey,
  children,
  headerClassName,
  titleClassName,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = usePersistedFlag(storageKey, false);
  // The saved flag is only read after mount. Hold the body back until then so a
  // section saved as collapsed never mounts (and fetches) its content first.
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);
  const contentId = React.useId();
  const showBody = ready && !collapsed;

  return (
    <section className="space-y-3">
      <div className={cn("flex items-center justify-between gap-2", headerClassName)}>
        <h2 className={titleClassName ?? "text-lg font-semibold text-foreground"}>{title}</h2>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!collapsed}
          aria-controls={showBody ? contentId : undefined}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </Button>
      </div>
      {showBody && <div id={contentId}>{children}</div>}
    </section>
  );
}
