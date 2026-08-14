import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { markMainTourSeen } from '../tour/mainTourStorage';
import { TourId, TourStep } from '../tour/tourTypes';
import { tourSteps } from '../tour/tourSteps';
import { cn } from '../lib/utils';

type TourState = {
  steps: TourStep[];
  currentIndex: number;
  isActive: boolean;
};

type GuidedTourContextValue = {
  startTour: (id: TourId) => void;
  stopTour: () => void;
  /** Register a callback to run when the tour ends (Done or Skip). Returns unregister function. */
  registerOnTourEnd: (callback: () => void) => () => void;
  /** Register a callback to run when Next is clicked on a specific step (e.g. navigate). Overrides default click behavior. Returns unregister function. */
  registerStepAction: (stepId: string, callback: () => void | Promise<void>) => () => void;
  isActive: boolean;
  activeTourId: TourId | null;
};

const GuidedTourContext = createContext<GuidedTourContextValue | undefined>(undefined);

type HighlightPosition = {
  top: number;
  left: number;
  width: number;
  height: number;
} | null;

const getStepTargetId = (step: TourStep | undefined) => step?.targetId ?? step?.id;

const getTarget = (step: TourStep | undefined) => {
  const targetId = getStepTargetId(step);
  return targetId ? (document.querySelector(`[data-tour-id="${targetId}"]`) as HTMLElement | null) : null;
};

const waitForTarget = (step: TourStep | undefined, timeoutMs = 2500): Promise<void> =>
  new Promise((resolve) => {
    if (!step) {
      resolve();
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (getTarget(step) || Date.now() >= deadline) {
        resolve();
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });

const PADDING = 24;
const TOOLTIP_WIDTH = 320;

const rectsOverlap = (a: { top: number; left: number; width: number; height: number }, b: DOMRect) =>
  !(a.left > b.right || a.left + a.width < b.left || a.top > b.bottom || a.top + a.height < b.top);

type TooltipPlacement = 'bottom-left' | 'top-left' | 'bottom-right' | 'top-right';

const getTooltipRect = (placement: TooltipPlacement, tooltipHeight: number): { top: number; left: number; width: number; height: number } => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  switch (placement) {
    case 'bottom-left':
      return { top: h - PADDING - tooltipHeight, left: PADDING, width: TOOLTIP_WIDTH, height: tooltipHeight };
    case 'top-left':
      return { top: PADDING, left: PADDING, width: TOOLTIP_WIDTH, height: tooltipHeight };
    case 'bottom-right':
      return { top: h - PADDING - tooltipHeight, left: w - PADDING - TOOLTIP_WIDTH, width: TOOLTIP_WIDTH, height: tooltipHeight };
    case 'top-right':
      return { top: PADDING, left: w - PADDING - TOOLTIP_WIDTH, width: TOOLTIP_WIDTH, height: tooltipHeight };
  }
};

const Tooltip = ({
  step,
  position,
  targetEl,
  onNext,
  onPrev,
  onClose,
  isFirst,
  isLast
}: {
  step: TourStep;
  position: HighlightPosition;
  targetEl: HTMLElement | null;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  isFirst: boolean;
  isLast: boolean;
}) => {
  const [placement, setPlacement] = useState<TooltipPlacement>('bottom-right');
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!targetEl || !boxRef.current) {
      setPlacement('bottom-right');
      return;
    }
    const tooltipHeight = boxRef.current.getBoundingClientRect().height;
    const targetRect = targetEl.getBoundingClientRect();
    const order: TooltipPlacement[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
    for (const p of order) {
      const tr = getTooltipRect(p, tooltipHeight);
      if (!rectsOverlap(tr, targetRect)) {
        setPlacement(p);
        return;
      }
    }
    setPlacement('bottom-right');
  }, [step.id, targetEl]);

  const style = useMemo(() => {
    switch (placement) {
      case 'bottom-left':
        return { bottom: PADDING, left: PADDING };
      case 'top-left':
        return { top: PADDING, left: PADDING };
      case 'bottom-right':
        return { bottom: PADDING, right: PADDING };
      case 'top-right':
        return { top: PADDING, right: PADDING };
    }
  }, [placement]);

  return (
    <div
      ref={boxRef}
      className="fixed z-[10002] w-[320px] pointer-events-auto"
      style={style}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="rounded-lg bg-card shadow-xl border border-border p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Step</p>
            <h4 className="font-semibold text-foreground">{step.title}</h4>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            aria-label="Close tour"
          >
            Skip
          </button>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{step.content}</p>
        <div className="flex justify-between items-center pt-2">
          <button
            onClick={onPrev}
            className={cn(
              'px-3 py-1 rounded border text-sm',
              isFirst
                ? 'border-border text-muted-foreground cursor-not-allowed'
                : 'border-border text-foreground hover:border-border'
            )}
            disabled={isFirst}
          >
            Back
          </button>
          <button
            onClick={isLast ? onClose : onNext}
            className="px-3 py-1 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

const GuidedTourOverlay = ({
  step,
  onNext,
  onPrev,
  onClose,
  index,
  total
}: {
  step: TourStep;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  index: number;
  total: number;
}) => {
  const [position, setPosition] = useState<HighlightPosition>(null);
  const [hasMeasured, setHasMeasured] = useState(false);

  useEffect(() => {
    setHasMeasured(false);
    setPosition(null);
  }, [step]);

  useEffect(() => {
    const target = getTarget(step);
    if (!target) {
      setPosition(null);
      setHasMeasured(true);
      return;
    }

    const updatePosition = () => {
      const rect = target.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left - 8,
        width: rect.width + 16,
        height: rect.height + 16
      });
      setHasMeasured(true);
    };

    const observer = new ResizeObserver(updatePosition);
    observer.observe(target);
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [step]);

  if (!hasMeasured) {
    return null;
  }

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/50 z-[10000] pointer-events-none" />
      {position && (
        <div
          className="fixed z-[10001] rounded-lg border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none"
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            height: position.height,
            transition: 'all 0.2s ease'
          }}
        />
      )}
      <Tooltip
        step={step}
        position={position}
        targetEl={getTarget(step)}
        onNext={onNext}
        onPrev={onPrev}
        onClose={onClose}
        isFirst={index === 0}
        isLast={index === total - 1}
      />
    </>,
    document.body
  );
};

export const GuidedTourProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<TourState>({ steps: [], currentIndex: 0, isActive: false });
  const [activeTourId, setActiveTourId] = useState<TourId | null>(null);
  const activeTourIdRef = useRef(activeTourId);
  activeTourIdRef.current = activeTourId;
  const onTourEndRef = useRef<(() => void) | null>(null);
  const stepActionOverridesRef = useRef<Map<string, () => void | Promise<void>>>(new Map());
  const advancingRef = useRef(false);

  const registerStepAction = useCallback((stepId: string, callback: () => void | Promise<void>) => {
    stepActionOverridesRef.current.set(stepId, callback);
    return () => {
      stepActionOverridesRef.current.delete(stepId);
    };
  }, []);

  const runStepAction = useCallback(async (step: TourStep | undefined) => {
    if (!step) return;

    const override = stepActionOverridesRef.current.get(step.id);
    if (override) {
      await override();
      return;
    }

    // Default: some steps trigger a click to move the user forward (navigate, switch tab, or open builder).
    if (step.id === 'course-select' || step.id === 'assessment-tab' || step.id === 'builder-add-section-button') {
      getTarget(step)?.click();
    }
  }, []);

  const registerOnTourEnd = useCallback((callback: () => void) => {
    onTourEndRef.current = callback;
    return () => {
      onTourEndRef.current = null;
    };
  }, []);

  const stopTour = useCallback(() => {
    if (activeTourIdRef.current === 'main') {
      markMainTourSeen();
    }
    const onEnd = onTourEndRef.current;
    onTourEndRef.current = null;
    stepActionOverridesRef.current.clear();
    setState({ steps: [], currentIndex: 0, isActive: false });
    setActiveTourId(null);
    onEnd?.();
  }, []);

  const advanceTo = useCallback(
    (nextIndex: number) => {
      setState((prev) => {
        if (!prev.isActive) return prev;
        if (!prev.steps[nextIndex]) {
          return prev;
        }
        return { ...prev, currentIndex: nextIndex };
      });
    },
    []
  );

  const startTour = useCallback(
    (id: TourId) => {
      const steps = tourSteps[id] ?? [];
      if (steps.length === 0) {
        return;
      }
      setActiveTourId(id);
      setState({ steps, currentIndex: 0, isActive: true });
    },
    []
  );

  const value = useMemo(
    () => ({
      startTour,
      stopTour,
      registerOnTourEnd,
      registerStepAction,
      isActive: state.isActive,
      activeTourId
    }),
    [startTour, stopTour, registerOnTourEnd, registerStepAction, state.isActive, activeTourId]
  );

  const step = state.isActive ? state.steps[state.currentIndex] : null;

  return (
    <GuidedTourContext.Provider value={value}>
      {children}
      {state.isActive && step && (
        <GuidedTourOverlay
          step={step}
          index={state.currentIndex}
          total={state.steps.length}
          onNext={() => {
            if (advancingRef.current) return;
            advancingRef.current = true;
            void (async () => {
              try {
                await runStepAction(step);
                const delay = step.advanceDelayMs ?? 150;
                await new Promise((r) => window.setTimeout(r, delay));
                const nextStep = state.steps[state.currentIndex + 1];
                await waitForTarget(nextStep, nextStep?.waitForTargetMs ?? 2500);
                advanceTo(state.currentIndex + 1);
              } finally {
                advancingRef.current = false;
              }
            })();
          }}
          onPrev={() => advanceTo(Math.max(0, state.currentIndex - 1))}
          onClose={stopTour}
        />
      )}
    </GuidedTourContext.Provider>
  );
};

export const useGuidedTour = () => {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) {
    throw new Error('useGuidedTour must be used within GuidedTourProvider');
  }
  return ctx;
};
