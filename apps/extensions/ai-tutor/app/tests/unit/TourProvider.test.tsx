import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "~/hooks/useLocalUser";

const { mockMarkTourCompleted, mockResolveSuggestedTourId, mockWaitForElement } = vi.hoisted(
  () => ({
    mockMarkTourCompleted: vi.fn(),
    mockResolveSuggestedTourId: vi.fn(),
    mockWaitForElement: vi.fn(),
  }),
);

vi.mock("~/lib/tours/tour-storage", async () => {
  const actual = await vi.importActual<typeof import("~/lib/tours/tour-storage")>(
    "~/lib/tours/tour-storage",
  );
  return {
    ...actual,
    markTourCompleted: mockMarkTourCompleted,
    resolveSuggestedTourId: mockResolveSuggestedTourId,
  };
});

vi.mock("~/lib/tours/tour-utils", async () => {
  const actual =
    await vi.importActual<typeof import("~/lib/tours/tour-utils")>("~/lib/tours/tour-utils");
  mockWaitForElement.mockImplementation(actual.waitForElement);
  return {
    ...actual,
    waitForElement: mockWaitForElement,
  };
});

let mockUser: AuthUser | null = { id: "u1", name: "Student", role: "STUDENT" };
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser }),
}));

// A tiny, fully-static tour fixture: each step has a hard-coded route and a
// target selector we control in the test DOM, so we don't depend on the
// real app's routes/components to exercise the provider's step machinery.
vi.mock("~/lib/tours/tour-definitions", () => ({
  tourDefinitions: {
    "student-journey": {
      id: "student-journey",
      completionKey: "test:tour:completed:student-journey",
      steps: [
        {
          id: "step-one",
          title: "Step one",
          description: "First step",
          target: '[data-tour="step-one"]',
          route: "/student",
        },
        {
          id: "step-two",
          title: "Step two",
          description: "Second step",
          target: '[data-tour="step-two"]',
          route: "/student",
        },
      ],
    },
    "student-lesson-help": {
      id: "student-lesson-help",
      completionKey: "test:tour:completed:student-lesson-help",
      steps: [
        {
          id: "lesson-step",
          title: "Lesson step",
          description: "Lesson help",
          target: '[data-tour="lesson-step"]',
          route: "/student/lesson/1",
        },
      ],
    },
  },
}));

const mockHighlight = vi.fn();
const mockDestroy = vi.fn();
const mockGetActiveElement = vi.fn(() => null);
let lastDriverConfig: Record<string, unknown> | null = null;
const mockDriverFactory = vi.fn((config: Record<string, unknown>) => {
  lastDriverConfig = config;
  return {
    highlight: mockHighlight,
    destroy: mockDestroy,
    getActiveElement: mockGetActiveElement,
  };
});

vi.mock("driver.js", () => ({
  driver: mockDriverFactory,
}));

import { TourProvider, useAppTour } from "~/components/TourProvider";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function Harness({
  onReady,
  initialEntries = ["/student"],
}: {
  onReady?: (value: ReturnType<typeof useAppTour>) => void;
  initialEntries?: string[];
}) {
  function Inner() {
    const tour = useAppTour();
    onReady?.(tour);
    return (
      <div>
        <span data-testid="active-tour">{tour.activeTourId ?? "none"}</span>
        <span data-testid="is-running">{String(tour.isRunning)}</span>
        <span data-testid="suggested">{tour.suggestedTourId ?? "none"}</span>
        <button type="button" onClick={() => tour.startTour("student-journey")}>
          start-journey
        </button>
        <button type="button" onClick={() => tour.startTour("student-lesson-help")}>
          start-lesson-help
        </button>
        <button type="button" onClick={tour.startSuggestedTour}>
          start-suggested
        </button>
        <button type="button" onClick={tour.stopTour}>
          stop
        </button>
        <LocationProbe />
      </div>
    );
  }

  return (
    <MemoryRouter initialEntries={initialEntries}>
      <TourProvider>
        <Routes>
          <Route path="*" element={<Inner />} />
        </Routes>
      </TourProvider>
    </MemoryRouter>
  );
}

describe("TourProvider", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    lastDriverConfig = null;
    mockUser = { id: "u1", name: "Student", role: "STUDENT" };
    mockResolveSuggestedTourId.mockReturnValue("student-journey");
    const actual =
      await vi.importActual<typeof import("~/lib/tours/tour-utils")>("~/lib/tours/tour-utils");
    mockWaitForElement.mockImplementation(actual.waitForElement);
    document.body.innerHTML = "";
  });

  it("throws useAppTour when used outside a TourProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useAppTour();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("useAppTour must be used within a TourProvider");
    spy.mockRestore();
  });

  it("starts idle with no active tour and reflects the suggested tour", () => {
    render(<Harness />);

    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
    expect(screen.getByTestId("is-running")).toHaveTextContent("false");
    expect(screen.getByTestId("suggested")).toHaveTextContent("student-journey");
  });

  it("returns no suggested tour when resolveSuggestedTourId says so", () => {
    mockResolveSuggestedTourId.mockReturnValue(null);
    render(<Harness />);
    expect(screen.getByTestId("suggested")).toHaveTextContent("none");
  });

  it("starting a tour on the matching route sets active state and highlights the first step", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div>';
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-tour")).toHaveTextContent("student-journey");
    });
    expect(screen.getByTestId("is-running")).toHaveTextContent("true");

    await waitFor(() => {
      expect(mockHighlight).toHaveBeenCalledTimes(1);
    });
    const call = mockHighlight.mock.calls[0][0];
    expect(call.element).toBe(document.querySelector('[data-tour="step-one"]'));
    expect(call.popover.title).toBe("Step one");
    // Only step in the tour with no predecessor -> no 'previous' button.
    expect(call.popover.showButtons).toEqual(["next", "close"]);
    expect(call.popover.nextBtnText).toBe("Continue");
  });

  it("navigates to the step route first when the current route does not match", async () => {
    document.body.innerHTML = '<div data-tour="lesson-step"></div>';
    render(<Harness initialEntries={["/student"]} />);

    await act(async () => {
      screen.getByText("start-lesson-help").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/student/lesson/1");
    });

    await waitFor(() => {
      expect(mockHighlight).toHaveBeenCalledTimes(1);
    });
  });

  it("advances to the next step and marks the last step as Finish", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div><div data-tour="step-two"></div>';
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });

    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(1));
    const firstCall = mockHighlight.mock.calls[0][0];

    await act(async () => {
      firstCall.popover.onNextClick();
    });

    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(2));
    const secondCall = mockHighlight.mock.calls[1][0];
    expect(secondCall.popover.title).toBe("Step two");
    expect(secondCall.popover.showButtons).toEqual(["previous", "next", "close"]);
    expect(secondCall.popover.nextBtnText).toBe("Finish");
  });

  it("completes the tour and marks it done when Finish is clicked on the last step", async () => {
    // Use the single-step lesson-help tour so Finish has no next step to
    // fall through to (avoids the real waitForElement timeout path).
    document.body.innerHTML = '<div data-tour="lesson-step"></div>';
    render(<Harness initialEntries={["/student/lesson/1"]} />);

    await act(async () => {
      screen.getByText("start-lesson-help").click();
    });
    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(1));

    const call = mockHighlight.mock.calls[0][0];
    await act(async () => {
      call.popover.onNextClick();
    });

    await waitFor(() => {
      expect(mockMarkTourCompleted).toHaveBeenCalledTimes(1);
    });
    expect(mockMarkTourCompleted.mock.calls[0][0].id).toBe("student-lesson-help");
    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
    expect(screen.getByTestId("is-running")).toHaveTextContent("false");
  });

  it("stopTour clears active state and destroys the driver", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div>';
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });
    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(1));

    await act(async () => {
      screen.getByText("stop").click();
    });

    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
    expect(screen.getByTestId("is-running")).toHaveTextContent("false");
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("closing the popover (onCloseClick) stops the tour", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div>';
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });
    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(1));
    const call = mockHighlight.mock.calls[0][0];

    await act(async () => {
      call.popover.onCloseClick();
    });

    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
  });

  it("going back to a previous step calls onPrevClick and re-highlights", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div><div data-tour="step-two"></div>';
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });
    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockHighlight.mock.calls[0][0].popover.onNextClick();
    });
    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(2));

    await act(async () => {
      mockHighlight.mock.calls[1][0].popover.onPrevClick();
    });

    await waitFor(() => expect(mockHighlight).toHaveBeenCalledTimes(3));
    expect(mockHighlight.mock.calls[2][0].popover.title).toBe("Step one");
  });

  it("startSuggestedTour starts the resolved suggested tour", async () => {
    document.body.innerHTML = '<div data-tour="step-one"></div>';
    mockResolveSuggestedTourId.mockReturnValue("student-journey");
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-suggested").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("active-tour")).toHaveTextContent("student-journey");
    });
  });

  it("startSuggestedTour is a no-op when there is no suggested tour", async () => {
    mockResolveSuggestedTourId.mockReturnValue(null);
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-suggested").click();
    });

    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
    expect(mockDriverFactory).not.toHaveBeenCalled();
  });

  it("skips a step whose target never appears and eventually completes the tour", async () => {
    // Force waitForElement to reject immediately (instead of the real 4s
    // timeout) to exercise the catch branch that moves past a missing target.
    mockWaitForElement.mockRejectedValue(new Error("not found"));
    render(<Harness />);

    await act(async () => {
      screen.getByText("start-journey").click();
    });

    await waitFor(() => {
      expect(mockMarkTourCompleted).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("active-tour")).toHaveTextContent("none");
  });
});
