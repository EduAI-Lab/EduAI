import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useMenuTooltip } from "../use-menu-tooltip";

describe("useMenuTooltip", () => {
  it("opens on hover while the menu is closed", () => {
    const { result } = renderHook(() => useMenuTooltip(false));
    act(() => result.current.tooltipProps.onOpenChange(true));
    expect(result.current.tooltipProps.open).toBe(true);
  });

  it("stays shut while the menu is open", () => {
    const { result, rerender } = renderHook(({ open }) => useMenuTooltip(open), {
      initialProps: { open: false },
    });
    act(() => result.current.tooltipProps.onOpenChange(true));
    rerender({ open: true });
    expect(result.current.tooltipProps.open).toBe(false);

    act(() => result.current.tooltipProps.onOpenChange(true));
    expect(result.current.tooltipProps.open).toBe(false);
  });

  it("ignores the focus the menu hands back on close until the pointer returns", () => {
    const { result, rerender } = renderHook(({ open }) => useMenuTooltip(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });

    act(() => result.current.tooltipProps.onOpenChange(true));
    expect(result.current.tooltipProps.open).toBe(false);

    act(() => result.current.triggerProps.onPointerEnter());
    act(() => result.current.tooltipProps.onOpenChange(true));
    expect(result.current.tooltipProps.open).toBe(true);
  });
});
