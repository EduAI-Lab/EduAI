/**
 * Dependency-free guided product tour (issue #764 — parity with QuestionMaker's
 * driver.js walkthrough). A spotlight overlay steps a new user through the key
 * parts of the shell. Kept library-free on purpose — same rationale as the
 * dependency-free dashboard charts: no bundle cost, full control of the look.
 *
 * Each step optionally anchors to a `[data-tour="…"]` element; anchored steps
 * that can't be found on the current page (e.g. an analytics panel a student
 * doesn't have) are skipped automatically, so the same step list is safe across
 * roles and viewports. Steps with no target render as a centered card.
 *
 * Auto-starts once per user (guarded by localStorage) and can be replayed by
 * navigating with `?tour=1`.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router";
import { IconX } from "@tabler/icons-react";

export interface TourStep {
  /** CSS selector for the element to spotlight; omit for a centered step. */
  target?: string;
  title: string;
  body: string;
}

const SPOTLIGHT_PAD = 8;

type Rect = { top: number; left: number; width: number; height: number };

function readRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function ProductTour({
  steps,
  storageKey,
}: {
  steps: TourStep[];
  storageKey: string;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [active, setActive] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  // Bumped to force a rect recompute on resize/scroll.
  const [, setTick] = React.useState(0);
  // Ensures the tour starts at most once per mount — without this, dropping the
  // ?tour=1 param re-runs the start effect and would re-open the tour.
  const startedRef = React.useRef(false);

  const finish = React.useCallback(() => {
    setActive(false);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {
      // Private-mode / storage-disabled: the tour just won't be remembered.
    }
  }, [storageKey]);

  // ── Decide whether to auto-start (once) or force-start via ?tour=1 ───────────
  React.useEffect(() => {
    if (startedRef.current) return;

    if (searchParams.get("tour") === "1") {
      startedRef.current = true;
      setIndex(0);
      setActive(true);
      // Drop the param so a refresh doesn't reopen the tour.
      const next = new URLSearchParams(searchParams);
      next.delete("tour");
      navigate({ search: next.toString() }, { replace: true });
      return;
    }
    let seen = false;
    try {
      seen = localStorage.getItem(storageKey) === "1";
    } catch {
      seen = true; // If we can't read storage, don't nag.
    }
    if (!seen) {
      const t = setTimeout(() => {
        startedRef.current = true;
        setActive(true);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [searchParams, navigate, storageKey]);

  // Resolve the current step, skipping anchored steps whose target is missing.
  const resolveStep = React.useCallback(
    (from: number, dir: 1 | -1): number | null => {
      let i = from;
      while (i >= 0 && i < steps.length) {
        const step = steps[i];
        if (!step.target || document.querySelector(step.target)) return i;
        i += dir;
      }
      return null;
    },
    [steps],
  );

  // ── Position the spotlight for the active step ───────────────────────────────
  React.useEffect(() => {
    if (!active) return;

    const resolved = resolveStep(index, 1) ?? resolveStep(index, -1);
    if (resolved === null) {
      finish();
      return;
    }
    if (resolved !== index) {
      setIndex(resolved);
      return;
    }

    const step = steps[index];
    if (!step.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.target);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setRect(readRect(el));
  }, [active, index, steps, resolveStep, finish]);

  // Keep the spotlight aligned while the page scrolls or resizes.
  React.useEffect(() => {
    if (!active) return;
    const onMove = () => {
      const step = steps[index];
      if (step?.target) {
        const el = document.querySelector(step.target);
        if (el) setRect(readRect(el));
      }
      setTick((t) => t + 1);
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [active, index, steps]);

  // ── Keyboard controls ────────────────────────────────────────────────────────
  const goNext = React.useCallback(() => {
    const next = resolveStep(index + 1, 1);
    if (next === null) finish();
    else setIndex(next);
  }, [index, resolveStep, finish]);

  const goBack = React.useCallback(() => {
    const prev = resolveStep(index - 1, -1);
    if (prev !== null) setIndex(prev);
  }, [index, resolveStep]);

  React.useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, finish, goNext, goBack]);

  if (!active) return null;

  const step = steps[index];
  const total = steps.length;
  const isLast = resolveStep(index + 1, 1) === null;

  // Anchored tooltip sits below the target (or above if it'd overflow); a
  // targetless step centers the card.
  const anchored = rect !== null;
  const belowTop = anchored ? rect.top + rect.height + SPOTLIGHT_PAD + 8 : 0;
  const placeAbove = anchored && belowTop + 180 > window.innerHeight;

  const cardStyle: React.CSSProperties = anchored
    ? {
        position: "fixed",
        top: placeAbove ? undefined : belowTop,
        bottom: placeAbove ? window.innerHeight - rect.top + SPOTLIGHT_PAD + 8 : undefined,
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 340)),
        width: 320,
      }
    : {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 340,
      };

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Dimmer + spotlight. A single highlight box with a huge box-shadow cuts a
          hole in the dim layer around the target; centered steps dim everything. */}
      {anchored ? (
        <div
          className="pointer-events-none absolute rounded-lg transition-all duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      {/* Click-catcher so the page underneath doesn't receive clicks. Clicking
          the backdrop advances the tour. */}
      <button
        type="button"
        aria-label="Continue tour"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={goNext}
      />

      <div
        style={cardStyle}
        className="rounded-[var(--radius-xl)] border border-border bg-popover p-5 shadow-lg"
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <IconX className="size-4" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {index + 1} / {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={finish}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Skip
            </button>
            {index > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
