import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardStudentView } from "~/components/dashboard/dashboard-student-view";

function renderStudentDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardStudentView /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardStudentView", () => {
  it("does not show the Question Maker dashboard card", () => {
    renderStudentDashboard();

    expect(screen.queryByText("Question Maker")).not.toBeInTheDocument();
  });

  it("shows student course and chat actions", () => {
    renderStudentDashboard();

    expect(screen.getByText("My Courses")).toBeInTheDocument();
    expect(screen.getByText("Course Chat")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
