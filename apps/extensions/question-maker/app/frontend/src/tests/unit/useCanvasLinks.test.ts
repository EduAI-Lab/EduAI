/**
 * Unit tests for `useCanvasLinks` (#2119): per-course Canvas link lookup
 * behind the course card's Canvas shortcut.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import canvasService from "@/services/canvasService";
import { CANVAS_LINK_LIMIT, __resetCanvasLinkCache, useCanvasLinks } from "@/hooks/useCanvasLinks";

vi.mock("@/services/canvasService", () => ({
  default: { getCourseLink: vi.fn() },
}));

const getCourseLink = vi.mocked(canvasService.getCourseLink);
const mapping = { canvasCourseId: 9 } as never;

beforeEach(() => {
  __resetCanvasLinkCache();
  getCourseLink.mockReset();
});

describe("useCanvasLinks", () => {
  it("includes linked ids and leaves out unlinked ones", async () => {
    getCourseLink.mockImplementation(async (id) =>
      id === 1 ? { status: "linked", mapping } : { status: "unlinked" },
    );
    const { result } = renderHook(() => useCanvasLinks([1, 2], true));
    await waitFor(() => expect(result.current.has(1)).toBe(true));
    expect(result.current.has(2)).toBe(false);
  });

  it("does not fetch the same ids twice", async () => {
    getCourseLink.mockResolvedValue({ status: "linked", mapping });
    const first = renderHook(() => useCanvasLinks([1], true));
    await waitFor(() => expect(first.result.current.has(1)).toBe(true));
    first.unmount();
    const second = renderHook(() => useCanvasLinks([1], true));
    await waitFor(() => expect(second.result.current.has(1)).toBe(true));
    expect(getCourseLink).toHaveBeenCalledTimes(1);
  });

  it("retries unknown on remount", async () => {
    getCourseLink.mockResolvedValueOnce({ status: "unknown" });
    const first = renderHook(() => useCanvasLinks([1], true));
    await waitFor(() => expect(getCourseLink).toHaveBeenCalledTimes(1));
    first.unmount();
    getCourseLink.mockResolvedValueOnce({ status: "linked", mapping });
    const second = renderHook(() => useCanvasLinks([1], true));
    await waitFor(() => expect(second.result.current.has(1)).toBe(true));
    expect(getCourseLink).toHaveBeenCalledTimes(2);
  });

  it("makes no calls when disabled", () => {
    const { result } = renderHook(() => useCanvasLinks([1, 2], false));
    expect(getCourseLink).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("looks up at most CANVAS_LINK_LIMIT courses", async () => {
    getCourseLink.mockResolvedValue({ status: "unlinked" });
    const ids = Array.from({ length: CANVAS_LINK_LIMIT + 20 }, (_, i) => i + 1);
    renderHook(() => useCanvasLinks(ids, true));
    await waitFor(() => expect(getCourseLink).toHaveBeenCalledTimes(CANVAS_LINK_LIMIT));
  });
});
