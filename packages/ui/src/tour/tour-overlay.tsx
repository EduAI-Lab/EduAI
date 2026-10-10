import * as React from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";

import { Button } from "../ui/button";
import { placeTourCard, type TourRect } from "./tour-dom";
import type { TourStep } from "./tour-engine";

const SPOTLIGHT_PAD = 8;
const CARD_WIDTH = 340;

export interface TourOverlayProps {
  step: Pick<TourStep, "id" | "title" | "body" | "placement">;
  /** Element to spotlight; null centres the card over a dimmed page. */
  target: HTMLElement | null;
  stepNumber: number;
  totalSteps: number;
  canGoBack: boolean;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  /**
   * Render into `document.body` (default). Pass false inside a Radix dialog so
   * the tour stays within the dialog's focus trap and outside-click handling.
   */
  portal?: boolean;
}

function rectOf(el: HTMLElement, origin: { top: number; left: number }): TourRect {
  const r = el.getBoundingClientRect();
  return { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height };
}

/** Keep Tab focus cycling inside `container`. */
function trapTab(e: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;
  const focusable = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * The one tour look across Core, AI Tutor and Question Maker (#1754): a
 * spotlight cut out of a dimmed page plus a step card beside the target.
 * Purely presentational — `TourProvider` (cross-page tours) and `LocalTour`
 * (tours inside one dialog) decide which step shows.
 *
 * Owns the modal behaviour: blocks clicks on the page beneath, moves focus in
 * and restores it on close, contains Tab, and maps Esc / ← / → to
 * skip / back / next.
 */
export function TourOverlay({
  step,
  target,
  stepNumber,
  totalSteps,
  canGoBack,
  isLast,
  onNext,
  onBack,
  onClose,
  portal = true,
}: TourOverlayProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const bodyId = React.useId();
  const [layout, setLayout] = React.useState<{
    spot: TourRect | null;
    card: { top: number; left: number };
  } | null>(null);

  // Measure in the overlay root's own coordinates. Normally that is the
  // viewport, but inside a transformed ancestor (a centred Radix dialog)
  // `position: fixed` is relative to that ancestor instead, and the card must
  // also stay within that ancestor's box, since it clips (`overflow: hidden`).
  const measure = React.useCallback(() => {
    const root = rootRef.current;
    const card = cardRef.current;
    if (!root || !card) return;
    const box = root.getBoundingClientRect();
    const origin = { top: box.top, left: box.left };
    const spot = target ? rectOf(target, origin) : null;
    const viewport = {
      width: Math.min(box.width, window.innerWidth - box.left),
      height: Math.min(box.height, window.innerHeight - box.top),
    };
    const padded = spot && {
      top: spot.top - SPOTLIGHT_PAD,
      left: spot.left - SPOTLIGHT_PAD,
      width: spot.width + SPOTLIGHT_PAD * 2,
      height: spot.height + SPOTLIGHT_PAD * 2,
    };
    const size = { width: card.offsetWidth || CARD_WIDTH, height: card.offsetHeight };
    setLayout({ spot: padded, card: placeTourCard(padded, size, viewport, step.placement) });
  }, [target, step.placement]);

  React.useLayoutEffect(() => {
    target?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
    measure();
    const observer = new ResizeObserver(measure);
    if (target) observer.observe(target);
    if (cardRef.current) observer.observe(cardRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target, step.id, measure]);

  // Keyboard. Capture phase on window so Esc ends the tour before a Radix
  // dialog underneath sees it and closes too.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && canGoBack) onBack();
      else if (e.key === "Tab") trapTab(e, rootRef.current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onNext, onBack, canGoBack]);

  // Focus moves into the tour on open and back where it was on close. Mount
  // only — refocusing every step would yank focus while the reader works.
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const overlay = (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="tour-overlay"
      className="pointer-events-auto fixed inset-0 z-[1000] outline-none"
    >
      {/* One box with a huge shadow dims everything but the target. Clicks on
          the dimmed page are swallowed so the tour can't be lost by accident. */}
      {layout?.spot ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200 motion-reduce:transition-none"
          style={{ ...layout.spot, boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)" }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}
      <div className="absolute inset-0" aria-hidden="true" />

      <div
        ref={cardRef}
        className="absolute flex flex-col gap-3 rounded-[var(--radius-xl)] border border-border bg-popover p-5 text-popover-foreground shadow-lg transition-[top,left] duration-200 motion-reduce:transition-none"
        style={{
          width: `min(${CARD_WIDTH}px, calc(100vw - 32px))`,
          top: layout?.card.top ?? 0,
          left: layout?.card.left ?? 0,
          visibility: layout ? "visible" : "hidden",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {step.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="-mt-1 -mr-1 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <IconX className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div id={bodyId} className="text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {stepNumber} of {totalSteps}
          </span>
          <div className="flex items-center gap-2">
            {isLast ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Skip
              </Button>
            )}
            {canGoBack ? (
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={onNext}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return portal ? createPortal(overlay, document.body) : overlay;
}
