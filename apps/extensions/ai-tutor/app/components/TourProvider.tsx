import type { Driver, PopoverDOM } from 'driver.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import 'driver.js/dist/driver.css';
import { tourDefinitions } from '~/lib/tours/tour-definitions';
import {
  createTourSession,
  findStepIndex,
  getStepMeta,
  moveSession,
  moveSessionAfterMissingTarget,
  storeStepSelection,
  type ActiveTourSession,
} from '~/lib/tours/tour-engine';
import { isLessonRoute, markTourCompleted } from '~/lib/tours/tour-storage';
import type { AppTourDefinition, AppTourId } from '~/lib/tours/tour-types';
import { waitForElement } from '~/lib/tours/tour-utils';

type TourContextValue = {
  activeTourId: AppTourId | null;
  isRunning: boolean;
  suggestedTourId: AppTourId | null;
  startTour: (tourId: AppTourId) => void;
  startSuggestedTour: () => void;
  stopTour: () => void;
};

const AppTourContext = createContext<TourContextValue | null>(null);

function applyPopoverTheme(popover: PopoverDOM) {
  popover.previousButton.classList.add('driver-tour-button', 'driver-tour-button-secondary');
  popover.nextButton.classList.add('driver-tour-button', 'driver-tour-button-primary');
  popover.closeButton.setAttribute('aria-label', 'Close tour');
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTourId, setActiveTourId] = useState<AppTourId | null>(null);
  const driverRef = useRef<Driver | null>(null);
  const sessionRef = useRef<ActiveTourSession | null>(null);
  const renderTokenRef = useRef(0);
  const suppressDestroyedRef = useRef(false);

  const clearTourState = useCallback(() => {
    renderTokenRef.current += 1;
    sessionRef.current = null;
    setActiveTourId(null);
  }, []);

  const destroyDriver = useCallback((suppressOnDestroyed = false) => {
    if (suppressOnDestroyed) {
      suppressDestroyedRef.current = true;
    }

    driverRef.current?.destroy();
  }, []);

  const ensureDriver = useCallback(async () => {
    if (driverRef.current) return driverRef.current;

    const { driver } = await import('driver.js');
    driverRef.current = driver({
      animate: true,
      allowClose: true,
      overlayClickBehavior: () => {
        stopTour();
      },
      overlayOpacity: 0.62,
      overlayColor: 'rgb(20 14 10)',
      smoothScroll: true,
      stagePadding: 12,
      stageRadius: 20,
      popoverOffset: 18,
      showProgress: true,
      allowKeyboardControl: true,
      popoverClass: 'driver-popover-aitutor',
      onDestroyStarted: () => {
        if (suppressDestroyedRef.current) return;
        clearTourState();
      },
      onDestroyed: () => {
        if (suppressDestroyedRef.current) {
          suppressDestroyedRef.current = false;
          return;
        }

        clearTourState();
      },
    });

    return driverRef.current;
  }, [clearTourState]);

  const stopTour = useCallback(() => {
    clearTourState();
    destroyDriver(true);
  }, [clearTourState, destroyDriver]);

  const completeTour = useCallback((tour: AppTourDefinition) => {
    markTourCompleted(tour);
    stopTour();
  }, [stopTour]);

  const showStep = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    const { step, route, hasPrevious, hasNext } = getStepMeta(session);
    if (!route) {
      const nextIndex = moveSessionAfterMissingTarget(session);
      if (nextIndex == null) {
        completeTour(session.tour);
        return;
      }
      void showStep();
      return;
    }

    session.context.currentPath = location.pathname;

    if (route !== location.pathname) {
      destroyDriver(true);
      session.pendingRoute = route;
      navigate(route);
      return;
    }

    const token = ++renderTokenRef.current;

    try {
      const element = await waitForElement(step.target);
      if (renderTokenRef.current !== token || sessionRef.current !== session) return;

      const projectedSession: ActiveTourSession = {
        ...session,
        context: { ...session.context },
      };
      storeStepSelection(projectedSession, element);
      const projectedHasNext = findStepIndex(
        projectedSession,
        projectedSession.stepIndex + 1,
        1,
      ) != null;

      const driver = await ensureDriver();
      if (renderTokenRef.current !== token || sessionRef.current !== session) return;

      destroyDriver(true);

      driver.highlight({
        element,
        disableActiveInteraction: true,
        popover: {
          title: step.title,
          description: step.description,
          side: step.side ?? 'bottom',
          align: step.align ?? 'center',
          showButtons: [
            ...(hasPrevious ? (['previous'] as const) : []),
            'next',
            'close',
          ],
          progressText: `${session.stepIndex + 1} of ${session.tour.steps.length}`,
          nextBtnText: projectedHasNext ? 'Continue' : 'Finish',
          prevBtnText: 'Back',
          doneBtnText: 'Finish',
          onPopoverRender: applyPopoverTheme,
          onCloseClick: () => stopTour(),
          onPrevClick: () => {
            const currentSession = sessionRef.current;
            if (!currentSession) return;
            const previousIndex = moveSession(currentSession, -1);
            if (previousIndex == null) return;
            void showStep();
          },
          onNextClick: () => {
            const currentSession = sessionRef.current;
            if (!currentSession) return;

            storeStepSelection(
              currentSession,
              driver.getActiveElement() ?? document.querySelector(step.target),
            );

            const nextIndex = moveSession(currentSession, 1);
            if (nextIndex == null) {
              completeTour(currentSession.tour);
              return;
            }
            void showStep();
          },
        },
      });
    } catch {
      const currentSession = sessionRef.current;
      if (!currentSession) return;
      const nextIndex = moveSessionAfterMissingTarget(currentSession);
      if (nextIndex == null) {
        completeTour(currentSession.tour);
        return;
      }
      void showStep();
    }
  }, [completeTour, ensureDriver, location.pathname, navigate, stopTour]);

  const startTour = useCallback((tourId: AppTourId) => {
    const tour = tourDefinitions[tourId];
    sessionRef.current = createTourSession(tour, location.pathname);
    setActiveTourId(tourId);
    destroyDriver(true);
    void showStep();
  }, [destroyDriver, location.pathname, showStep]);

  const suggestedTourId = useMemo<AppTourId | null>(() => {
    if (!location.pathname.startsWith('/student')) return null;
    return isLessonRoute(location.pathname) ? 'student-lesson-help' : 'student-journey';
  }, [location.pathname]);

  const startSuggestedTour = useCallback(() => {
    if (!suggestedTourId) return;
    startTour(suggestedTourId);
  }, [startTour, suggestedTourId]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    session.context.currentPath = location.pathname;

    if (session.pendingRoute === location.pathname) {
      session.pendingRoute = null;
      void showStep();
    }
  }, [location.pathname, showStep]);

  useEffect(() => () => {
    destroyDriver(true);
  }, [destroyDriver]);

  const value = useMemo<TourContextValue>(() => ({
    activeTourId,
    isRunning: activeTourId != null,
    suggestedTourId,
    startTour,
    startSuggestedTour,
    stopTour,
  }), [activeTourId, startSuggestedTour, startTour, stopTour, suggestedTourId]);

  return (
    <AppTourContext.Provider value={value}>
      {children}
    </AppTourContext.Provider>
  );
}

export function useAppTour() {
  const context = useContext(AppTourContext);
  if (!context) {
    throw new Error('useAppTour must be used within a TourProvider');
  }
  return context;
}
