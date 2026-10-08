/**
 * Browser-side helpers for the shared guided tour (#1754): finding targets,
 * waiting for them to render, placing the card, and remembering seen tours.
 */
import { hasDocument } from "../lib/runtime-env";
import { tourSelector, type TourPlacement, type TourStep } from "./tour-engine";

export type TourRect = { top: number; left: number; width: number; height: number };

/** Top-left corner of the tour card. */
export type TourCardPosition = Pick<TourRect, "top" | "left">;

type CardCandidate = TourCardPosition & { fits: boolean };

function isVisible(el: HTMLElement): boolean {
  // `checkVisibility` treats display:none ancestors (e.g. a responsive
  // `hidden sm:inline-flex` wrapper) as hidden; unlike `offsetParent` it also
  // handles position:fixed targets. Environments without it (jsdom) count as visible.
  return el.checkVisibility?.() ?? true;
}

/** First *visible* element tagged `data-tour="<target>"`, or null. */
export function findTourTarget(target: string): HTMLElement | null {
  if (!hasDocument()) return null;
  for (const el of document.querySelectorAll<HTMLElement>(tourSelector(target))) {
    if (isVisible(el)) return el;
  }
  return null;
}

/** The `data-tour-route` an element advertises, for `TourStep.captureRoute`. */
export function readTourRoute(element: Element | null): string | null {
  return element instanceof HTMLElement ? (element.dataset.tourRoute ?? null) : null;
}

export type TourTargetMatch =
  | { kind: "target"; element: HTMLElement }
  | { kind: "empty" }
  | { kind: "missing" };

const POLL_MS = 50;

/**
 * Wait up to `timeoutMs` for a step's target (or its `emptyTarget` sentinel)
 * to be visible. Polls rather than observing mutations so a target that is in
 * the DOM but still hidden (a collapsing sidebar, a lazy panel) is caught too.
 */
export function waitForTourTarget(
  step: Pick<TourStep, "target" | "emptyTarget">,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TourTargetMatch> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let timer: number | undefined;
    const check = () => {
      if (signal?.aborted) return;
      const element = step.target ? findTourTarget(step.target) : null;
      if (element) return resolve({ kind: "target", element });
      if (step.emptyTarget && findTourTarget(step.emptyTarget)) return resolve({ kind: "empty" });
      if (Date.now() >= deadline) return resolve({ kind: "missing" });
      timer = window.setTimeout(check, POLL_MS);
    };
    signal?.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
    check();
  });
}

const OPPOSITE = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
} as const satisfies Record<TourPlacement, TourPlacement>;

/**
 * Where the tour card goes: on the step's preferred side of the target, else
 * the opposite side, else whichever side fits, clamped into the viewport. A
 * step with no target centres the card.
 */
export function placeTourCard(
  target: TourRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: TourPlacement = "bottom",
  gap = 16,
  margin = 16,
): TourCardPosition {
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - card.width - margin));
  const clampY = (y: number) =>
    Math.max(margin, Math.min(y, viewport.height - card.height - margin));

  if (!target) {
    return {
      top: clampY((viewport.height - card.height) / 2),
      left: clampX((viewport.width - card.width) / 2),
    };
  }

  const centreX = clampX(target.left + target.width / 2 - card.width / 2);
  const centreY = clampY(target.top + target.height / 2 - card.height / 2);
  const candidates = {
    bottom: {
      top: target.top + target.height + gap,
      left: centreX,
      fits: target.top + target.height + gap + card.height <= viewport.height - margin,
    },
    top: {
      top: target.top - gap - card.height,
      left: centreX,
      fits: target.top - gap - card.height >= margin,
    },
    right: {
      top: centreY,
      left: target.left + target.width + gap,
      fits: target.left + target.width + gap + card.width <= viewport.width - margin,
    },
    left: {
      top: centreY,
      left: target.left - gap - card.width,
      fits: target.left - gap - card.width >= margin,
    },
  } satisfies Record<TourPlacement, CardCandidate>;

  const order: TourPlacement[] = [preferred, OPPOSITE[preferred], "bottom", "top", "right", "left"];
  const hit = order.find((side) => candidates[side].fits);
  if (hit) return { top: candidates[hit].top, left: candidates[hit].left };
  // Nothing fits beside a target this large: keep the card on screen over it.
  return { top: clampY(candidates.bottom.top), left: centreX };
}

/** Whether the tour stored under `storageKey` has been seen (finished or skipped). */
export function hasSeenTour(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return true; // Storage unreadable: don't nag with an auto-start every visit.
  }
}

export function markTourSeen(storageKey: string): void {
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // Private mode / storage disabled: the tour just won't be remembered.
  }
}
