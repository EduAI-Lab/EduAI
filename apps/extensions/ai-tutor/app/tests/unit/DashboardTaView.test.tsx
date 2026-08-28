import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";

import { DashboardTaView } from "~/components/dashboard/DashboardTaView";
import type { Course } from "~/lib/types";

/**
 * #1644: a TA's `courses` prop mixes TA-assigned courses (no progress) with
 * courses the same account is separately enrolled in as a student (with
 * progress). These pin that "Assigned courses" lists only the assisted ones
 * (linking into /instructor), while the enrolled-as-student course surfaces
 * only in the learner-facing "Continue learning" surface (linking into
 * /student).
 */
const assisted: Course = { id: 1, code: "TA 101", title: "Course I Assist", isPublished: true };
const enrolled: Course = {
  id: 2,
  code: "STU 201",
  title: "Course I Learn",
  isPublished: true,
  progress: { completed: 2, total: 4, percentage: 50 },
};

function renderView() {
  return render(
    <MemoryRouter>
      <DashboardTaView courses={[assisted, enrolled]} submissions={[]} />
    </MemoryRouter>,
  );
}

describe("DashboardTaView", () => {
  it("lists only assisted courses under 'Assigned courses' (#1644)", () => {
    renderView();
    // The assisted course is an assigned row (links into /instructor)…
    expect(screen.getByRole("link", { name: /Course I Assist/ })).toHaveAttribute(
      "href",
      "/instructor/courses/1",
    );
    // …but the course the account is a *student* in is never an assigned row.
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/instructor/courses/2");
    }
  });

  it("surfaces the enrolled-as-student course only in the learner surface (#1644)", () => {
    renderView();
    // It shows up as a /student link (Continue learning), not a staff /instructor one.
    expect(
      screen.getAllByRole("link").some((l) => l.getAttribute("href") === "/student/courses/2"),
    ).toBe(true);
  });

  it("counts only assisted courses in the 'Courses assisting' stat", () => {
    renderView();
    const label = screen.getByText("Courses assisting");
    // Label and value share a stat card; walk up to the card and read its value.
    const card = label.closest("[class]")?.parentElement ?? label.parentElement;
    expect(card?.textContent).toContain("1");
    expect(card?.textContent).not.toContain("2");
  });
});
