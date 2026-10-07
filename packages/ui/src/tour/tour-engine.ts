/**
 * Shared guided-tour model (#1754): the step/definition shapes every app writes
 * its tours in, plus the pure step-resolution rules `TourProvider` runs on.
 *
 * Core, AI Tutor and Question Maker each own *what* their tours say and where
 * they go; this module owns *how* a tour walks — which step is next, which page
 * it lives on, and when a step can't be shown and is skipped. Nothing here
 * touches the DOM, so it is unit-tested without a browser.
 */
import type { ReactNode } from "react";

export type TourPlacement = "top" | "bottom" | "left" | "right";

/**
 * Routes a tour has learned so far, keyed by name: seeded when the tour starts
 * (`TourDefinition.seedRoutes`) and captured from targets as it runs
 * (`TourStep.captureRoute`). Later steps resolve their page from these.
 */
export type TourRoutes = Readonly<Record<string, string | null | undefined>>;

/** A fixed route, or one derived from captured routes. Resolving to null/undefined skips the step. */
export type TourRoute = string | ((routes: TourRoutes) => string | null | undefined);

export interface TourStep {
  /** Stable id, unique within its tour. */
  id: string;
  /** `data-tour` value of the element to spotlight. Omit for a centred card. */
  target?: string;
  /**
   * `data-tour` value of an empty-state sentinel meaning `target` will never
   * appear (e.g. a course with no modules). Whichever shows up first wins, so
   * the step is skipped at once instead of waiting out the timeout (#1572).
   */
  emptyTarget?: string;
  title: string;
  body: ReactNode;
  /**
   * Page the step lives on. The tour navigates there before showing it. Omit
   * for a step that stays wherever the tour currently is.
   */
  route?: TourRoute;
  /**
   * Read the target's `data-tour-route` into `routes[captureRoute]` when the
   * step is shown — how a tour follows "the first course" into its page.
   */
  captureRoute?: string;
  /** Preferred side of the target for the card; it flips when that side doesn't fit. */
  placement?: TourPlacement;
  /** Override how long to wait for `target` before skipping the step. */
  waitMs?: number;
}

export interface TourDefinition<Id extends string = string> {
  id: Id;
  /** localStorage key marking the tour seen, which stops it auto-starting again. */
  storageKey: string;
  steps: readonly TourStep[];
  /** Routes known from the page the tour is started on (e.g. the lesson being viewed). */
  seedRoutes?: (pathname: string) => Record<string, string | null>;
}

export interface TourLocation {
  pathname: string;
  search: string;
}

/** CSS selector for a `data-tour` key. */
export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`;
}

/** `undefined`: the step has no route of its own. `null`: it has one that can't be resolved yet. */
export function resolveStepRoute(step: TourStep, routes: TourRoutes): string | null | undefined {
  if (step.route === undefined) return undefined;
  const route = step.route instanceof Function ? step.route(routes) : step.route;
  return route ?? null;
}

/** First step from `from` (inclusive) walking `direction` whose route resolves, else null. */
export function findAvailableStep(
  steps: readonly TourStep[],
  routes: TourRoutes,
  from: number,
  direction: 1 | -1,
): number | null {
  for (let i = from; i >= 0 && i < steps.length; i += direction) {
    if (resolveStepRoute(steps[i], routes) !== null) return i;
  }
  return null;
}

function splitRoute(route: string): { pathname: string; params: URLSearchParams } {
  const q = route.indexOf("?");
  return q === -1
    ? { pathname: route, params: new URLSearchParams() }
    : { pathname: route.slice(0, q), params: new URLSearchParams(route.slice(q + 1)) };
}

/** True when `route` names the same page as `pathname`, ignoring any query. */
export function isSamePage(route: string, pathname: string): boolean {
  return splitRoute(route).pathname === pathname;
}

/**
 * True when the browser is already where `route` points: same pathname, and
 * every query param the route names has the same value (others may be extra,
 * so `/courses/5?tab=questions` matches `?tab=questions&page=2`).
 */
export function isOnRoute(route: string, location: TourLocation): boolean {
  const { pathname, params } = splitRoute(route);
  if (pathname !== location.pathname) return false;
  const current = new URLSearchParams(location.search);
  for (const [key, value] of params) {
    if (current.get(key) !== value) return false;
  }
  return true;
}

/**
 * The step a tour opens on. A tour started from a page it visits begins at
 * that page's first step rather than dragging the reader back to step one —
 * opening the course tour from inside a course tours *that* course. Elsewhere
 * it starts at the first available step.
 */
export function resolveStartStep(
  steps: readonly TourStep[],
  routes: TourRoutes,
  pathname: string,
): number | null {
  const here = steps.findIndex((step) => {
    const route = resolveStepRoute(step, routes);
    return route !== null && route !== undefined && isSamePage(route, pathname);
  });
  return here !== -1 ? here : findAvailableStep(steps, routes, 0, 1);
}
