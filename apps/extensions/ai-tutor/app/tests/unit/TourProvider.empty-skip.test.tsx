import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppTourDefinition } from "~/lib/tours/tour-types";

/**
 * #1572 — when a tour step declares an `emptyTarget` sentinel and the course is
 * empty (no modules/lessons), the step must skip AT ONCE via the raced
 * empty-state match rather than stall on the full missing-target timeout. This
 * drives that branch through the real provider: the sentinel is present, the
 * target never is, so the step (and any dependent step behind the same gate) is
 * dropped and the tour ends without ever constructing driver.js.
 */

const hoisted = vi.hoisted(() => ({
  tours: {} as Record<string, AppTourDefinition>,
  markTourCompleted: vi.fn(),
}));

vi.mock("~/lib/tours/tour-definitions", () => ({
  get tourDefinitions() {
    return hoisted.tours;
  },
}));

vi.mock("~/lib/tours/tour-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/tours/tour-storage")>();
  return {
    ...actual,
    markTourCompleted: (tour: AppTourDefinition) => hoisted.markTourCompleted(tour),
    resolveSuggestedTourId: () => null,
  };
});

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: { id: "1", name: "Student", role: "STUDENT" } }),
}));

import { TourProvider, useAppTour } from "~/components/TourProvider";

function Consumer() {
  const { startTour, isRunning } = useAppTour();
  return (
    <>
      <button type="button" onClick={() => startTour("test-tour")}>
        start
      </button>
      <span data-testid="running">{String(isRunning)}</span>
    </>
  );
}

function renderProvider(path = "/student") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TourProvider>
        <Consumer />
      </TourProvider>
    </MemoryRouter>,
  );
}

function setTour(steps: AppTourDefinition["steps"]) {
  for (const key of Object.keys(hoisted.tours)) delete hoisted.tours[key];
  hoisted.tours["test-tour"] = { id: "test-tour", steps } as AppTourDefinition;
}

describe("TourProvider empty-state skip (#1572)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("skips a gated step and completes when every step's empty sentinel wins", async () => {
    // Two steps, each gated behind an empty-state sentinel that is present while
    // its real target never appears — exercises both the "advance to next step"
    // and the "no step left → complete" arms of the skip branch.
    setTour([
      {
        title: "Modules",
        description: "open the first module",
        target: '[data-tour="student-module-card-first"]',
        emptyTarget: '[data-tour="student-modules-empty"]',
        route: "/student",
      },
      {
        title: "Lessons",
        description: "open the first lesson",
        target: '[data-tour="student-lesson-card-first"]',
        emptyTarget: '[data-tour="student-lessons-empty"]',
        route: "/student",
      },
    ]);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-tour="student-modules-empty"></div><div data-tour="student-lessons-empty"></div>`,
    );

    renderProvider();
    fireEvent.click(screen.getByText("start"));

    await waitFor(() => expect(hoisted.markTourCompleted).toHaveBeenCalledTimes(1));
    expect(hoisted.markTourCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "test-tour" }),
    );
    await waitFor(() => expect(screen.getByTestId("running").textContent).toBe("false"));
  });

  it("completes immediately when the only step is empty-gated", async () => {
    setTour([
      {
        title: "Modules",
        description: "open the first module",
        target: '[data-tour="student-module-card-first"]',
        emptyTarget: '[data-tour="student-modules-empty"]',
        route: "/student",
      },
    ]);
    document.body.insertAdjacentHTML("beforeend", `<div data-tour="student-modules-empty"></div>`);

    renderProvider();
    fireEvent.click(screen.getByText("start"));

    await waitFor(() => expect(hoisted.markTourCompleted).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("running").textContent).toBe("false");
  });
});
