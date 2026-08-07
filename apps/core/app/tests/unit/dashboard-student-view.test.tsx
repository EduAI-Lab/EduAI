import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardStandardBody } from "~/components/dashboard/dashboard-view-config";

function renderStudentDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardStandardBody effectiveRole="STUDENT" /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardStandardBody (STUDENT)", () => {
  it("does not show the Question Maker dashboard card", () => {
    renderStudentDashboard();

    expect(screen.queryByText("Question Maker")).not.toBeInTheDocument();
  });

  it("shows student course and chat actions", () => {
    renderStudentDashboard();

    expect(screen.getByText("Your courses")).toBeInTheDocument();
    expect(screen.getByText("Recent conversations")).toBeInTheDocument();
  });
});
