import * as React from "react";

import { hasSeenTour, markTourSeen, readTourRoute, waitForTourTarget } from "./tour-dom";
import {
  findAvailableStep,
  isOnRoute,
  resolveStartStep,
  resolveStepRoute,
  type TourDefinition,
  type TourLocation,
  type TourRoutes,
} from "./tour-engine";
import { TourOverlay } from "./tour-overlay";

/** How long a step waits for its target right after the tour changed page (data may still be loading). */
const WAIT_AFTER_NAVIGATION_MS = 4000;
/** How long it waits on a page that's already rendered — long enough for a lazy panel, short enough that a role-hidden target isn't noticed. */
const WAIT_IN_PLACE_MS = 400;

interface TourRun {
  tour: TourDefinition;
  index: number;
  direction: 1 | -1;
  routes: TourRoutes;
  /** Bumped per run so stale async step resolutions are ignored. */
  token: number;
}

/** A step resolved on the page, with the routes it captured (applied on Next). */
interface ShownStep {
  token: number;
  index: number;
  element: HTMLElement | null;
  routes: TourRoutes;
}

export interface TourContextValue {
  activeTourId: string | null;
  isRunning: boolean;
  startTour: (tourId: string) => void;
  stopTour: () => void;
  hasSeenTour: (tourId: string) => boolean;
}

/**
 * What `useTour` returns outside a provider: nothing runs and every tour
 * counts as seen. Each app mounts `TourProvider` at its root, so this only
 * applies to shells rendered bare (tests, Storybook-style previews).
 */
const NO_TOURS: TourContextValue = {
  activeTourId: null,
  isRunning: false,
  startTour: () => {},
  stopTour: () => {},
  hasSeenTour: () => true,
};

const TourContext = React.createContext<TourContextValue>(NO_TOURS);

export interface TourProviderProps {
  /** Every tour the app offers, keyed by id. */
  tours: Readonly<Record<string, TourDefinition>>;
  /** Current router location; the provider stays router-agnostic. */
  location: TourLocation;
  navigate: (to: string) => void;
  children: React.ReactNode;
}

/**
 * Runs guided tours for an app (#1754). One provider per app, mounted inside
 * its router; tours are plain `TourDefinition` data.
 *
 * A tour can span pages: each step names its route, the provider navigates
 * there, waits for the target, and skips steps whose target never appears
 * (a role without that panel, an empty course) so one definition serves every
 * viewer. Finishing or skipping marks the tour seen, which only governs
 * `useAutoStartTour` — any tour can always be restarted from the (?) button.
 */
export function TourProvider({ tours, location, navigate, children }: TourProviderProps) {
  const [run, setRun] = React.useState<TourRun | null>(null);
  const [shown, setShown] = React.useState<ShownStep | null>(null);
  const tokenRef = React.useRef(0);
  // The step we last navigated for, so a route that redirects elsewhere skips
  // the step instead of navigating in a loop.
  const navigatedForRef = React.useRef<string | null>(null);
  const locationRef = React.useRef(location);
  locationRef.current = location;
  const runRef = React.useRef(run);
  runRef.current = run;

  const finish = React.useCallback((tour: TourDefinition) => {
    markTourSeen(tour.storageKey);
    setRun(null);
    setShown(null);
  }, []);

  const stopTour = React.useCallback(() => {
    if (runRef.current) finish(runRef.current.tour);
  }, [finish]);

  /** Move to the next available step in `direction` from `from`, or end the tour. */
  const goTo = React.useCallback(
    (current: TourRun, routes: TourRoutes, from: number, direction: 1 | -1) => {
      const { steps } = current.tour;
      const next =
        findAvailableStep(steps, routes, from, direction) ??
        (direction === -1 ? findAvailableStep(steps, routes, current.index, 1) : null);
      if (next === null) {
        finish(current.tour);
        return;
      }
      setRun({ ...current, index: next, direction, routes });
    },
    [finish],
  );

  const startTour = React.useCallback(
    (tourId: string) => {
      const tour = tours[tourId];
      if (!tour) return;
      const { pathname } = locationRef.current;
      const routes = tour.seedRoutes?.(pathname) ?? {};
      const index = resolveStartStep(tour.steps, routes, pathname);
      if (index === null) return;
      tokenRef.current += 1;
      navigatedForRef.current = null;
      setShown(null);
      setRun({ tour, index, direction: 1, routes, token: tokenRef.current });
    },
    [tours],
  );

  // Resolve the current step: navigate to its page, wait for its target, then
  // show it — or skip it in the direction of travel.
  const { pathname, search } = location;
  React.useEffect(() => {
    if (!run) return;
    const step = run.tour.steps[run.index];
    const stepKey = `${run.token}:${run.index}`;
    const route = resolveStepRoute(step, run.routes);

    if (route === null) {
      goTo(run, run.routes, run.index + run.direction, run.direction);
      return;
    }
    if (route !== undefined && !isOnRoute(route, { pathname, search })) {
      setShown(null);
      if (navigatedForRef.current === stepKey) {
        // Already navigated for this step and landed elsewhere (a redirect).
        goTo(run, run.routes, run.index + run.direction, run.direction);
        return;
      }
      navigatedForRef.current = stepKey;
      navigate(route);
      return;
    }

    const show = (element: HTMLElement | null) => {
      const routes = step.captureRoute
        ? { ...run.routes, [step.captureRoute]: readTourRoute(element) }
        : run.routes;
      setShown({ token: run.token, index: run.index, element, routes });
    };

    if (!step.target) {
      show(null);
      return;
    }

    const navigated = navigatedForRef.current === stepKey;
    const timeout =
      step.waitMs ?? (navigated || step.emptyTarget ? WAIT_AFTER_NAVIGATION_MS : WAIT_IN_PLACE_MS);
    const controller = new AbortController();
    void waitForTourTarget(step, timeout, controller.signal).then((match) => {
      if (controller.signal.aborted) return;
      if (match.kind === "target") show(match.element);
      else goTo(run, run.routes, run.index + run.direction, run.direction);
    });
    return () => controller.abort();
  }, [run, pathname, search, navigate, goTo]);

  const visible = run && shown && shown.token === run.token && shown.index === run.index;
  const step = visible ? run.tour.steps[run.index] : null;

  const handleNext = React.useCallback(() => {
    if (!run || !shown) return;
    goTo(run, shown.routes, run.index + 1, 1);
  }, [run, shown, goTo]);

  const handleBack = React.useCallback(() => {
    if (!run) return;
    goTo(run, run.routes, run.index - 1, -1);
  }, [run, goTo]);

  const value = React.useMemo<TourContextValue>(
    () => ({
      activeTourId: run?.tour.id ?? null,
      isRunning: run !== null,
      startTour,
      stopTour,
      hasSeenTour: (tourId) => {
        const tour = tours[tourId];
        return tour ? hasSeenTour(tour.storageKey) : true;
      },
    }),
    [run, startTour, stopTour, tours],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      {visible && step ? (
        <TourOverlay
          step={step}
          target={shown.element}
          stepNumber={run.index + 1}
          totalSteps={run.tour.steps.length}
          canGoBack={findAvailableStep(run.tour.steps, run.routes, run.index - 1, -1) !== null}
          isLast={findAvailableStep(run.tour.steps, shown.routes, run.index + 1, 1) === null}
          onNext={handleNext}
          onBack={handleBack}
          onClose={stopTour}
        />
      ) : null}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  return React.useContext(TourContext);
}

/**
 * Start `tourId` once for a viewer who has never seen it, on the first idle
 * tick so it never competes with the page's first paint.
 */
export function useAutoStartTour(tourId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const { startTour, isRunning, hasSeenTour: seen } = useTour();
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || isRunning || startedRef.current || seen(tourId)) return;
    const start = () => {
      startedRef.current = true;
      startTour(tourId);
    };
    if (window.requestIdleCallback) {
      // Called on `window`: a detached reference throws "Illegal invocation".
      const id = window.requestIdleCallback(start, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(start, 300);
    return () => window.clearTimeout(timer);
  }, [enabled, isRunning, seen, startTour, tourId]);
}
