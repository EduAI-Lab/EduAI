import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,xyz" })),
}));

import html2canvas from "html2canvas";
import { isBugReportChrome, useBugReportCapture } from "../bug-report-capture";

describe("useBugReportCapture", () => {
  const realFetch = window.fetch;
  let fetchStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchStub = vi.fn(async () => new Response(null, { status: 204 }));
    window.fetch = fetchStub as typeof window.fetch;
  });

  afterEach(() => {
    window.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("restores the exact original console.log and fetch on unmount", () => {
    const origLog = console.log;
    const origFetch = window.fetch;
    const { unmount } = renderHook(() => useBugReportCapture());
    expect(console.log).not.toBe(origLog);
    expect(window.fetch).not.toBe(origFetch);
    unmount();
    expect(console.log).toBe(origLog);
    expect(window.fetch).toBe(origFetch);
  });

  it("buffers console entries and returns them as JSON", () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    console.warn("boom", { a: 1 });
    const logs = JSON.parse(result.current.getCapturedData().consoleLogs);
    expect(logs.at(-1)).toMatchObject({ level: "warn", message: 'boom {"a":1}' });
    unmount();
  });

  it("keeps an Error's message and stack", () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    const err = new Error("kaput");
    console.error(err);
    const logs = JSON.parse(result.current.getCapturedData().consoleLogs);
    expect(logs.at(-1)).toMatchObject({ level: "error", message: "kaput", stack: err.stack });
    unmount();
  });

  it("caps the console buffer at 200 entries, dropping the oldest", () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    for (let i = 0; i < 205; i++) console.log(`entry ${i}`);
    const logs = JSON.parse(result.current.getCapturedData().consoleLogs);
    expect(logs).toHaveLength(200);
    expect(logs[0].message).toBe("entry 5");
    unmount();
  });

  it("records fetch calls, taking the method from a Request when init has none", async () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    await window.fetch(new Request("http://localhost/api/x", { method: "DELETE" }));
    const [entry] = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(entry).toMatchObject({ method: "DELETE", url: "http://localhost/api/x", status: 204 });
    unmount();
  });

  it("still records a network entry when the underlying fetch rejects", async () => {
    fetchStub.mockRejectedValueOnce(new TypeError("offline"));
    const { result, unmount } = renderHook(() => useBugReportCapture());
    await expect(window.fetch("/api/y")).rejects.toThrow("offline");
    const [entry] = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(entry).toMatchObject({ method: "GET", url: "/api/y", status: null });
    unmount();
  });

  it("caps the network buffer at 100 entries", async () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    for (let i = 0; i < 103; i++) await window.fetch(`/api/${i}`);
    const logs = JSON.parse(result.current.getCapturedData().networkLogs);
    expect(logs).toHaveLength(100);
    expect(logs[0].url).toBe("/api/3");
    unmount();
  });

  it("does not patch anything when disabled", () => {
    const origLog = console.log;
    const origFetch = window.fetch;
    renderHook(() => useBugReportCapture(false));
    expect(console.log).toBe(origLog);
    expect(window.fetch).toBe(origFetch);
  });

  it("restores originals and clears buffers when disabled after being enabled", () => {
    const origLog = console.log;
    const { result, rerender } = renderHook(({ on }) => useBugReportCapture(on), {
      initialProps: { on: true },
    });
    console.log("before disable");
    rerender({ on: false });
    expect(console.log).toBe(origLog);
    expect(JSON.parse(result.current.getCapturedData().consoleLogs)).toEqual([]);
  });

  it("never takes a screenshot on its own", () => {
    const { unmount } = renderHook(() => useBugReportCapture());
    expect(html2canvas).not.toHaveBeenCalled();
    unmount();
  });

  it("captures a JPEG that skips the bug-report dialog chrome", async () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    let shot: string | null = null;
    await act(async () => {
      shot = await result.current.captureScreenshot();
    });
    expect(shot).toBe("data:image/jpeg;base64,xyz");
    expect(result.current.getCapturedData().screenshot).toBe("data:image/jpeg;base64,xyz");
    const opts = vi.mocked(html2canvas).mock.calls[0][1]!;
    expect(opts.ignoreElements).toBe(isBugReportChrome);
    unmount();
  });

  it("returns null without capturing while disabled", async () => {
    const { result } = renderHook(() => useBugReportCapture(false));
    await expect(result.current.captureScreenshot()).resolves.toBeNull();
    expect(html2canvas).not.toHaveBeenCalled();
  });

  it("dedupes overlapping calls into a single in-flight capture", async () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    await act(async () => {
      await Promise.all([result.current.captureScreenshot(), result.current.captureScreenshot()]);
    });
    expect(html2canvas).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not resurrect a screenshot cleared while the capture was in flight", async () => {
    let finish!: (canvas: { toDataURL: () => string }) => void;
    vi.mocked(html2canvas).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve as typeof finish)) as never,
    );
    const { result, unmount } = renderHook(() => useBugReportCapture());
    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.captureScreenshot();
    });
    await vi.waitFor(() => expect(html2canvas).toHaveBeenCalled());
    act(() => result.current.clearScreenshot());
    finish({ toDataURL: () => "data:image/jpeg;base64,late" });
    await expect(pending).resolves.toBeNull();
    expect(result.current.getCapturedData().screenshot).toBeNull();
    unmount();
  });

  it("swallows capture failures instead of throwing", async () => {
    vi.mocked(html2canvas).mockRejectedValueOnce(new Error("tainted canvas"));
    const { result, unmount } = renderHook(() => useBugReportCapture());
    await expect(result.current.captureScreenshot()).resolves.toBeNull();
    unmount();
  });

  it("clearScreenshot drops the cached shot", async () => {
    const { result, unmount } = renderHook(() => useBugReportCapture());
    await act(async () => {
      await result.current.captureScreenshot();
    });
    act(() => result.current.clearScreenshot());
    expect(result.current.getCapturedData().screenshot).toBeNull();
    unmount();
  });
});

describe("isBugReportChrome", () => {
  it.each([
    ["dialog-overlay", true],
    ["dialog-content", true],
    ["sidebar", false],
  ])("data-slot=%s → %s", (slot, expected) => {
    const el = document.createElement("div");
    el.setAttribute("data-slot", slot);
    expect(isBugReportChrome(el)).toBe(expected);
  });

  it("is false for an element with no data-slot", () => {
    expect(isBugReportChrome(document.createElement("div"))).toBe(false);
  });
});
