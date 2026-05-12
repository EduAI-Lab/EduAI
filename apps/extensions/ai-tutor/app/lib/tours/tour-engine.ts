import type { AppTourDefinition, AppTourStep, TourContextState } from './tour-types';
import { isLessonRoute } from './tour-storage';
import { readRouteFromElement, resolveStepRoute } from './tour-utils';

export type ActiveTourSession = {
  tour: AppTourDefinition;
  stepIndex: number;
  direction: 1 | -1;
  context: TourContextState;
  pendingRoute: string | null;
};

export function createInitialTourContext(pathname: string): TourContextState {
  return {
    currentPath: pathname,
    selectedCourseRoute: null,
    selectedModuleRoute: null,
    selectedLessonRoute: isLessonRoute(pathname) ? pathname : null,
  };
}

export function createTourSession(tour: AppTourDefinition, pathname: string): ActiveTourSession {
  return {
    tour,
    stepIndex: 0,
    direction: 1,
    context: createInitialTourContext(pathname),
    pendingRoute: null,
  };
}

export function getSessionStep(session: ActiveTourSession): AppTourStep {
  return session.tour.steps[session.stepIndex];
}

export function findStepIndex(
  session: ActiveTourSession,
  fromIndex: number,
  direction: 1 | -1,
) {
  for (
    let index = fromIndex;
    index >= 0 && index < session.tour.steps.length;
    index += direction
  ) {
    const route = resolveStepRoute(session.tour.steps[index], session.context);
    if (route) return index;
  }

  return null;
}

export function getStepRoute(session: ActiveTourSession, step = getSessionStep(session)) {
  return resolveStepRoute(step, session.context);
}

export function getStepMeta(session: ActiveTourSession) {
  return {
    step: getSessionStep(session),
    route: getStepRoute(session),
    hasPrevious: findStepIndex(session, session.stepIndex - 1, -1) != null,
    hasNext: findStepIndex(session, session.stepIndex + 1, 1) != null,
  };
}

export function moveSession(session: ActiveTourSession, direction: 1 | -1) {
  const nextIndex = findStepIndex(session, session.stepIndex + direction, direction);
  if (nextIndex == null) return null;

  session.direction = direction;
  session.stepIndex = nextIndex;
  return nextIndex;
}

export function moveSessionAfterMissingTarget(session: ActiveTourSession) {
  return moveSession(session, session.direction);
}

export function storeStepSelection(session: ActiveTourSession, element: Element | null) {
  const currentStep = getSessionStep(session);
  if (!currentStep.storeRouteFromTarget) return;

  session.context[currentStep.storeRouteFromTarget] = readRouteFromElement(element);
}
