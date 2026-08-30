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

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

if (!window.matchMedia) {
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

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Radix's Select (and the other pointer-driven primitives) call the Pointer
// Capture API on open. jsdom does not implement it, so without these the
// listbox never opens and no `option` is ever rendered — a combobox looks
// permanently empty rather than failing loudly.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
