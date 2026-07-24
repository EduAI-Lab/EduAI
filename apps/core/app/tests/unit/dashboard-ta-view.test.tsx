import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardStandardBody } from "~/components/dashboard/dashboard-view-config";

function renderTaDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardStandardBody effectiveRole="TA" /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardStandardBody (TA)", () => {
  it("does not show the Question Maker dashboard card", () => {
    renderTaDashboard();

    expect(screen.queryByText("Question Maker")).not.toBeInTheDocument();
  });
});
