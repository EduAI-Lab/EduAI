import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { DashboardStudentView } from "~/components/dashboard/DashboardStudentView";
import type { Course } from "~/lib/types";

// #2031: course.progress counts activities, so the panel must say activities, not lessons.
function renderView(courses: Course[]) {
  return render(
    <MemoryRouter>
      <DashboardStudentView courses={courses} submissions={[]} />
    </MemoryRouter>,
  );
}

describe("DashboardStudentView progress panel", () => {
  it("labels the aggregated progress as activities (#2031)", () => {
    renderView([
      {
        id: 1,
        code: "CS 101",
        title: "Course A",
        isPublished: true,
        progress: { completed: 3, total: 6, percentage: 50 },
      },
      {
        id: 2,
        code: "CS 102",
        title: "Course B",
        isPublished: true,
        progress: { completed: 2, total: 4, percentage: 50 },
      },
    ]);
    expect(screen.getByText("Activities completed")).toBeInTheDocument();
    expect(screen.getByText("5 of 10 activities complete.")).toBeInTheDocument();
    expect(screen.queryByText(/lessons? complete/i)).not.toBeInTheDocument();
  });

  it("shows the activities empty state when there is nothing to track", () => {
    renderView([]);
    expect(screen.getByText("No activities available yet.")).toBeInTheDocument();
  });
});
