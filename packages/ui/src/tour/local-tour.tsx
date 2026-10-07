import * as React from "react";

import { findTourTarget } from "./tour-dom";
import type { TourStep } from "./tour-engine";
import { TourOverlay } from "./tour-overlay";

export interface LocalTourProps {
  /** Steps on the current screen; `route`, `captureRoute` and waiting don't apply here. */
  steps: readonly Pick<TourStep, "id" | "target" | "title" | "body" | "placement">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A single-screen tour with the shared look (#1754), for walkthroughs scoped
 * to one already-rendered surface such as a dialog. Renders in place rather
 * than portalling, so a Radix dialog's focus trap and outside-click handling
 * treat it as part of the dialog. Steps whose target is absent are skipped.
 *
 * Cross-page tours belong in a `TourDefinition` run by `TourProvider`.
 */
export function LocalTour({ steps, open, onOpenChange }: LocalTourProps) {
  const [index, setIndex] = React.useState(0);

  const available = React.useCallback(
    (i: number) => !steps[i].target || findTourTarget(steps[i].target) !== null,
    [steps],
  );
  const find = React.useCallback(
    (from: number, direction: 1 | -1) => {
      for (let i = from; i >= 0 && i < steps.length; i += direction) {
        if (available(i)) return i;
      }
      return null;
    },
    [steps, available],
  );

  React.useEffect(() => {
    if (open) setIndex(find(0, 1) ?? 0);
  }, [open, find]);

  if (!open || steps.length === 0) return null;
  const step = steps[index];
  const close = () => onOpenChange(false);
  const next = find(index + 1, 1);
  const previous = find(index - 1, -1);

  return (
    <TourOverlay
      portal={false}
      step={step}
      target={step.target ? findTourTarget(step.target) : null}
      stepNumber={index + 1}
      totalSteps={steps.length}
      canGoBack={previous !== null}
      isLast={next === null}
      onNext={() => (next === null ? close() : setIndex(next))}
      onBack={() => previous !== null && setIndex(previous)}
      onClose={close}
    />
  );
}
