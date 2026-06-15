import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardTaView } from "~/components/dashboard/dashboard-ta-view";

function renderTaDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardTaView /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardTaView", () => {
  it("does not show the Question Maker dashboard card", () => {
    renderTaDashboard();

    expect(screen.queryByText("Question Maker")).not.toBeInTheDocument();
  });
});
