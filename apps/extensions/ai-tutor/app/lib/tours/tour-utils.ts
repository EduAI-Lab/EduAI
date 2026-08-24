import type { AppTourStep, TourContextState } from "./tour-types";

export function waitForElement(selector: string, timeoutMs = 4000) {
  return new Promise<Element>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document is unavailable"));
      return;
    }

    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const next = document.querySelector(selector);
      if (!next) return;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      resolve(next);
    });

    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for ${selector}`));
    }, timeoutMs);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

export type EitherElementMatch = {
  matched: "target" | "empty";
  element: Element;
};

/**
 * Resolve as soon as either `selector` or `emptySelector` appears, reporting
 * which one matched. Used so a content gate (e.g. the first module card) can be
 * raced against its empty-state sentinel: on an empty course the sentinel wins
 * and the tour skips the gate at once, while a genuinely slow-loading course
 * still resolves the real target within the timeout (#1572).
 */
export function waitForEitherElement(selector: string, emptySelector: string, timeoutMs = 4000) {
  return new Promise<EitherElementMatch>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document is unavailable"));
      return;
    }

    const check = (): EitherElementMatch | null => {
      const target = document.querySelector(selector);
      if (target) return { matched: "target", element: target };
      const empty = document.querySelector(emptySelector);
      if (empty) return { matched: "empty", element: empty };
      return null;
    };

    const existing = check();
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const hit = check();
      if (!hit) return;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      resolve(hit);
    });

    const timeoutId = window.setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timed out waiting for ${selector} or ${emptySelector}`));
    }, timeoutMs);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

export function resolveStepRoute(step: AppTourStep, context: TourContextState) {
  return typeof step.route === "function" ? step.route(context) : step.route;
}

export function readRouteFromElement(element: Element | null) {
  if (!element || !("dataset" in element)) return null;
  const route = (element as HTMLElement).dataset?.tourRoute;
  return typeof route === "string" ? route : null;
}
