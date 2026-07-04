import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ProductTour, type TourStep } from "~/components/tour/product-tour";

const STORAGE_KEY = "eduai:test:tour";

const STEPS: TourStep[] = [
  { title: "Welcome", body: "Start here." },
  { target: '[data-tour="missing"]', title: "Anchored (absent)", body: "Should be skipped." },
  { title: "Finish", body: "All done." },
];

function renderTour(initialEntry: string) {
  const router = createMemoryRouter(
    [{ path: "/", element: <ProductTour steps={STEPS} storageKey={STORAGE_KEY} /> }],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

describe("ProductTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("force-starts on ?tour=1 and shows the first step", async () => {
    renderTour("/?tour=1");
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("skips anchored steps whose target is absent", async () => {
    renderTour("/?tour=1");
    await screen.findByText("Welcome");
    // Next should jump over the missing-target step straight to "Finish".
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Finish")).toBeInTheDocument();
    expect(screen.queryByText("Anchored (absent)")).not.toBeInTheDocument();
  });

  it("marks the tour seen when finished", async () => {
    renderTour("/?tour=1");
    await screen.findByText("Welcome");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBe("1"));
    expect(screen.queryByText("Finish")).not.toBeInTheDocument();
  });

  it("does not auto-start when already seen", async () => {
    localStorage.setItem(STORAGE_KEY, "1");
    renderTour("/");
    // Give the 600ms auto-start timer room to (not) fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });
});
