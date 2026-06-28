import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CanvasDashboardCard } from "~/components/canvas/canvas-dashboard-card";
import { getCanvasIntegration } from "~/lib/canvas/client";

vi.mock("~/lib/canvas/client", () => ({
  getCanvasIntegration: vi.fn(),
  listCanvasCourses: vi.fn().mockResolvedValue([]),
}));

function renderCard() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <CanvasDashboardCard /> },
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
});
