import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CanvasDashboardCard } from "~/components/canvas/canvas-dashboard-card";
import { getCanvasIntegration } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  getCanvasIntegration: vi.fn(),
  listCanvasCourses: vi.fn().mockResolvedValue([]),
}));

function renderCard(disabled = false) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <CanvasDashboardCard disabled={disabled} /> },
      { path: "/settings", element: <div>Settings page</div> },
      { path: "/courses/:id", element: <div>Course page</div> },
    ],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("CanvasDashboardCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCanvasIntegration).mockResolvedValue(null);
  });

  it("prompts instructors to connect Canvas in Settings when disconnected", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText(/canvas is not connected yet/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Connect Canvas in Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.queryByRole("button", { name: "Fetch from Canvas" }),
    ).not.toBeInTheDocument();
  });

  it("shows Fetch from Canvas button when connected", async () => {
    vi.mocked(getCanvasIntegration).mockResolvedValue({
      canvasUrl: "https://canvas.ubc.ca",
      isTestMode: false,
      isConnected: true,
    });

    renderCard();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Fetch from Canvas" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Fetch from Canvas" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Fetch from Canvas" }),
      ).toBeInTheDocument();
    });
  });

  it("greys out the card (instead of hiding it) without fetching when the policy is off", async () => {
    renderCard(true);

    // Card stays visible with a greyed, non-navigating action.
    const link = await screen.findByRole("link", { name: "Connect Canvas in Settings" });
    expect(link).toHaveAttribute("href", "/settings");

    // Skips the Canvas API entirely, so no "Forbidden: instructors only" error.
    expect(getCanvasIntegration).not.toHaveBeenCalled();
    expect(screen.queryByText(/forbidden/i)).not.toBeInTheDocument();
  });
});
