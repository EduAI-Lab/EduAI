import type { AppTourStep, TourContextState } from './tour-types';

export function waitForElement(selector: string, timeoutMs = 4000) {
  return new Promise<Element>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('document is unavailable'));
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

export function resolveStepRoute(step: AppTourStep, context: TourContextState) {
  return typeof step.route === 'function' ? step.route(context) : step.route;
}

export function readRouteFromElement(element: Element | null) {
  if (!element || !('dataset' in element)) return null;
  const route = (element as HTMLElement).dataset?.tourRoute;
  return typeof route === 'string' ? route : null;
}
