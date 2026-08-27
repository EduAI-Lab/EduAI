import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// CI runners share CPU with the postgres/redis service containers and other
// turbo tasks, which makes the default 1000ms findBy*/waitFor timeout flaky
// under load even though the same assertions are never slow locally.
configure({ asyncUtilTimeout: 5000 });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

if (typeof window.matchMedia === "undefined") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
