import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { DashboardBody } from "~/components/dashboard/dashboard-view-config";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";

// The dashboard is SSR now (#1220): the body renders from resolved loader data,
// not from client hooks. A minimal, fully-resolved payload stands in here.
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

function renderStudentDashboard() {
  const router = createMemoryRouter(
    [{ path: "/", element: <DashboardBody effectiveRole="STUDENT" data={data} /> }],
    { initialEntries: ["/"] },
  );

  return render(<RouterProvider router={router} />);
}

describe("DashboardBody (STUDENT)", () => {
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
