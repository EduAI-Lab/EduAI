/**
 * Unit tests for `GuidedTourProvider` / `useGuidedTour` (#1546): tour
 * start/stop lifecycle, step navigation, and the registration hooks pages use
 * to hook into tour end / step actions. No step's `data-tour-id` exists in
 * these tests, so `GuidedTourOverlay` never reaches its `ResizeObserver`
 * branch (jsdom has none) — it renders its "not yet measured" null state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const markMainTourSeen = vi.fn();

vi.mock("@/tour/mainTourStorage", () => ({
  markMainTourSeen: (...args: unknown[]) => markMainTourSeen(...args),
}));

vi.mock("@/tour/tourSteps", () => ({
  tourSteps: {
    main: [
      { id: "step-1", title: "Step One", content: "First step" },
      { id: "step-2", title: "Step Two", content: "Second step" },
      { id: "step-3", title: "Step Three", content: "Third step" },
    ],
    assessmentBuilder: [],
  },
}));

import { GuidedTourProvider, useGuidedTour } from "@/contexts/GuidedTourContext";

// jsdom has no ResizeObserver; the overlay only needs disconnect/observe to be callable.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? FakeResizeObserver;

function wrapper({ children }: { children: ReactNode }) {
  return <GuidedTourProvider>{children}</GuidedTourProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useGuidedTour", () => {
  it("throws when used outside a GuidedTourProvider", () => {
    const { result } = renderHook(() => {
      try {
        return useGuidedTour();
      } catch (e) {
        return e as Error;
      }
    });
    expect((result.current as Error).message).toMatch(/must be used within GuidedTourProvider/);
  });

  it("starts inactive with no active tour", () => {
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    expect(result.current.isActive).toBe(false);
    expect(result.current.activeTourId).toBeNull();
  });

  it("startTour activates the named tour and its first step", () => {
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    act(() => result.current.startTour("main"));
    expect(result.current.isActive).toBe(true);
    expect(result.current.activeTourId).toBe("main");
  });

  it("startTour is a no-op for a tour with no steps", () => {
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    act(() => result.current.startTour("assessmentBuilder"));
    expect(result.current.isActive).toBe(false);
    expect(result.current.activeTourId).toBeNull();
  });

  it("stopTour deactivates, clears activeTourId, and marks the main tour seen", () => {
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    act(() => result.current.startTour("main"));
    act(() => result.current.stopTour());
    expect(result.current.isActive).toBe(false);
    expect(result.current.activeTourId).toBeNull();
    expect(markMainTourSeen).toHaveBeenCalledTimes(1);
  });

  it("stopTour calls the registered onTourEnd callback", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    act(() => {
      result.current.registerOnTourEnd(onEnd);
      result.current.startTour("main");
    });
    act(() => result.current.stopTour());
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("unregistering onTourEnd via the returned function prevents the callback from firing", () => {
    const onEnd = vi.fn();
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    let unregister: () => void;
    act(() => {
      unregister = result.current.registerOnTourEnd(onEnd);
      result.current.startTour("main");
    });
    act(() => unregister());
    act(() => result.current.stopTour());
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("registerStepAction registers and unregisters a per-step override", () => {
    const { result } = renderHook(() => useGuidedTour(), { wrapper });
    const action = vi.fn();
    let unregister: () => void;
    act(() => {
      unregister = result.current.registerStepAction("step-1", action);
    });
    // No direct getter for the override map; just confirm register/unregister don't throw
    // and return a stable function.
    expect(unregister!).toBeInstanceOf(Function);
    act(() => unregister());
  });

  it("renders the overlay tooltip for the active step once mounted with a live target", () => {
    function Harness() {
      const { startTour } = useGuidedTour();
      return (
        <div>
          <div data-tour-id="step-1">Target</div>
          <button onClick={() => startTour("main")}>start</button>
        </div>
      );
    }
    render(
      <GuidedTourProvider>
        <Harness />
      </GuidedTourProvider>,
    );

    act(() => screen.getByText("start").click());

    return waitFor(() => expect(screen.getByText("Step One")).toBeInTheDocument());
  });
});

describe("GuidedTourProvider Next/Prev navigation", () => {
  function Harness() {
    const { startTour } = useGuidedTour();
    return (
      <div>
        <div data-tour-id="step-1">Target 1</div>
        <div data-tour-id="step-2">Target 2</div>
        <div data-tour-id="step-3">Target 3</div>
        <button onClick={() => startTour("main")}>start</button>
      </div>
    );
  }

  it("Next advances to the next step, Prev returns to the previous one, and Done ends on the last step", async () => {
    vi.useFakeTimers();
    render(
      <GuidedTourProvider>
        <Harness />
      </GuidedTourProvider>,
    );

    await act(async () => {
      screen.getByText("start").click();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(screen.getByText("Step One")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("Next").click();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(screen.getByText("Step Two")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("Back").click();
    });
    expect(screen.getByText("Step One")).toBeInTheDocument();

    // Advance to the last step, then Done (rendered as "Next" label until last).
    await act(async () => {
      screen.getByText("Next").click();
      await vi.runOnlyPendingTimersAsync();
    });
    await act(async () => {
      screen.getByText("Next").click();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(screen.getByText("Step Three")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("Done").click();
    });
    expect(markMainTourSeen).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clicking Skip (Close tour) ends the tour", async () => {
    vi.useFakeTimers();
    render(
      <GuidedTourProvider>
        <Harness />
      </GuidedTourProvider>,
    );
    await act(async () => {
      screen.getByText("start").click();
      await vi.runOnlyPendingTimersAsync();
    });
    expect(screen.getByText("Step One")).toBeInTheDocument();

    await act(async () => {
      screen.getByLabelText("Close tour").click();
    });
    expect(screen.queryByText("Step One")).toBeNull();
    vi.useRealTimers();
  });
});
