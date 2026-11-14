import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { DashboardTaView } from "~/components/dashboard/DashboardTaView";
import type { Course } from "~/lib/types";

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: { id: "ta1", name: "TA", role: "TA", authorizedUnits: [] } }),
}));
vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canPublishContent: false, canPreviewAsStudent: false }),
}));
// Publishing revalidates through a data router this test doesn't mount.
vi.mock("~/components/courses/useCoursePublishToggle", () => ({
  useCoursePublishToggle: () => ({ requestToggle: () => {}, dialog: null }),
}));

/**
 * #1644: a TA's `courses` prop mixes TA-assigned courses (no progress) with
 * courses the same account is separately enrolled in as a student (with
 * progress). These pin that "Courses you assist" lists only the assisted ones
 * (linking into /instructor), while the enrolled-as-student course sits under
 * "Courses you're taking" (linking into /student).
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
  it("lists only assisted courses under 'Courses you assist' (#1644)", () => {
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

  it("surfaces the enrolled-as-student course only under 'Courses you're taking' (#1644)", () => {
    renderView();
    const taking = screen.getByRole("region", { name: "Courses you're taking" });
    expect(within(taking).getByRole("link", { name: /Course I Learn/ })).toHaveAttribute(
      "href",
      "/student/courses/2",
    );
    const assisting = screen.getByRole("region", { name: "Courses you assist" });
    expect(within(assisting).queryByText(/Course I Learn/)).not.toBeInTheDocument();
  });

  it("counts only assisted courses in the 'Courses assisting' stat", () => {
    renderView();
    // The <dt> and its <dd> share a wrapper in the "At a glance" list.
    const stat = screen.getByText("Courses assisting").parentElement;
    expect(stat?.querySelector("dd")?.textContent).toBe("1");
  });
});
