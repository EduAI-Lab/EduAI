import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Unrelated chat route files reuse identities like `user-1`. Skip the daily
// cap there so they do not share a 50/day Redis bucket. Suites that cover
// #1547 call `vi.unmock("~/lib/chat-daily-limits.server")`.
vi.mock("~/lib/chat-daily-limits.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/chat-daily-limits.server")>();
  return {
    ...actual,
    consumeLocalChatDailyCap: vi.fn(async () => null),
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
}

// jsdom does not implement matchMedia, which the use-mobile hook (used by
// SidebarProvider and other responsive components) relies on.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
