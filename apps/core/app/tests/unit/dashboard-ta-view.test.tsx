import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardBody } from "~/components/dashboard/dashboard-view-config";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";

// SSR dashboard (#1220): the body renders from resolved loader data.
const data: DashboardData = {
  stats: {
    chatCount: 0,
    chatCountWeek: 0,
    materialCount: 0,
    studentCount: 0,
    instructorCount: 0,
    totalUsers: 0,
    activeCourseCount: 0,
  },
  recentChats: [],
  courses: [],
  courseTotal: 0,
};

function renderTaDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardBody effectiveRole="TA" data={data} /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardBody (TA)", () => {
  it("does not show the Question Maker dashboard card", () => {
    renderTaDashboard();

    expect(screen.queryByText("Question Maker")).not.toBeInTheDocument();
  });

  it("shows the TA course panel and recent conversations", () => {
    renderTaDashboard();

    expect(screen.getByText("Assigned courses")).toBeInTheDocument();
    expect(screen.getByText("Recent conversations")).toBeInTheDocument();
  });
});
