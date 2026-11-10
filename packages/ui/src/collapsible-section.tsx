import * as React from "react";

import { usePersistedFlag } from "./nav-shell";
import { Button } from "./ui/button";

export interface CollapsibleSectionProps {
  title: string;
  /** localStorage key; the collapsed state is remembered per device. */
  storageKey: string;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, storageKey, children }: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = usePersistedFlag(storageKey, false);
  const contentId = React.useId();

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </Button>
      </div>
      {!collapsed && <div id={contentId}>{children}</div>}
    </section>
  );
}
