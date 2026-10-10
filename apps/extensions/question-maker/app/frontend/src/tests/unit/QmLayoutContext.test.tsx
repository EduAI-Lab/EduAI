/**
 * Unit tests for `QmLayoutProvider` / `useQmLayout` (#1546): the layout-scoped
 * context for the profile dialog's open state.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QmLayoutProvider, useQmLayout } from "@/components/layout/QmLayoutContext";

describe("QmLayoutContext", () => {
  it("throws when used outside a QmLayoutProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useQmLayout())).toThrow(
      "useQmLayout must be used within QmLayoutProvider",
    );
    spy.mockRestore();
  });

  it("starts with the profile dialog closed", () => {
    const { result } = renderHook(() => useQmLayout(), {
      wrapper: ({ children }) => <QmLayoutProvider>{children}</QmLayoutProvider>,
    });

    expect(result.current.profileOpen).toBe(false);
  });

  it("openProfile / closeProfile toggle profileOpen", () => {
    const { result } = renderHook(() => useQmLayout(), {
      wrapper: ({ children }) => <QmLayoutProvider>{children}</QmLayoutProvider>,
    });

    act(() => result.current.openProfile());
    expect(result.current.profileOpen).toBe(true);

    act(() => result.current.closeProfile());
    expect(result.current.profileOpen).toBe(false);
  });
});
