import type { AppTourDefinition, AppTourStep, TourContextState } from "./tour-types";
import { isLessonRoute } from "./tour-storage";
import { readRouteFromElement, resolveStepRoute } from "./tour-utils";

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

/**
 * The step a tour should open on when launched from `pathname`.
 *
 * A tour that spans more than one route (the unit-admin one covers /dashboard
 * and /instructor) must not navigate away the moment it is started: opening it
 * from the course list should begin at the course-list step, not at step one on
 * the dashboard. Falls back to the first step when no step lives on this route,
 * which is the intended behaviour for a TA launching the learner tour from the
 * instructor shell — going to /student is the point of that tour.
 */
export function resolveTourStartStep(tour: AppTourDefinition, context: TourContextState) {
  const index = tour.steps.findIndex(
    (step) => resolveStepRoute(step, context) === context.currentPath,
  );

  return index === -1 ? 0 : index;
}

export function createTourSession(tour: AppTourDefinition, pathname: string): ActiveTourSession {
  const context = createInitialTourContext(pathname);

  return {
    tour,
    stepIndex: resolveTourStartStep(tour, context),
    direction: 1,
    context,
    pendingRoute: null,
  };
}

export function getSessionStep(session: ActiveTourSession): AppTourStep {
  return session.tour.steps[session.stepIndex];
}

export function findStepIndex(session: ActiveTourSession, fromIndex: number, direction: 1 | -1) {
  for (let index = fromIndex; index >= 0 && index < session.tour.steps.length; index += direction) {
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
