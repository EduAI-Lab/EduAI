import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "~/hooks/use-mobile";

type Listener = (event?: unknown) => void;

function installMatchMedia() {
  const listeners = new Set<Listener>();
  const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, l: Listener) => {
      listeners.add(l);
    },
    removeEventListener: (_: string, l: Listener) => {
      listeners.delete(l);
    },
    dispatchEvent: vi.fn(),
  }));
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMediaMock,
  });
  return { listeners };
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

describe("useIsMobile", () => {
  let listeners: Set<Listener>;

  beforeEach(() => {
    ({ listeners } = installMatchMedia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when innerWidth is below the mobile breakpoint", () => {
    setInnerWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when innerWidth is at or above the mobile breakpoint", () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates the result when the media query change event fires", () => {
    setInnerWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setInnerWidth(500);
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    setInnerWidth(1024);
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBeGreaterThan(0);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
