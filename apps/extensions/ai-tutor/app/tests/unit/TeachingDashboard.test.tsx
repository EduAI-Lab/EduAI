import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import { TeachingDashboard } from "~/components/dashboard/TeachingDashboard";
import type { Course } from "~/lib/types";

const requestToggle = vi.fn();

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "i1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));
vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canPublishContent: true, canPreviewAsStudent: true }),
}));
vi.mock("~/components/courses/useCoursePublishToggle", () => ({
  useCoursePublishToggle: () => ({ requestToggle, dialog: null }),
}));

const published: Course = { id: 1, code: "COSC 101", title: "Intro", isPublished: true };
const draft: Course = { id: 2, code: "COSC 211", title: "Architecture", isPublished: false };

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TeachingDashboard
        sections={[{ kind: "teaching", courses: [published, draft] }]}
        stats={[{ label: "Courses teaching", value: 2 }]}
        showDrafts
      />
    </MemoryRouter>,
  );
}

describe("TeachingDashboard", () => {
  beforeEach(() => {
    requestToggle.mockClear();
    window.localStorage.clear();
  });

  it("links each card's title and section shortcuts into that course", () => {
    renderDashboard();
    expect(screen.getByRole("link", { name: "COSC 101 · Intro" })).toHaveAttribute(
      "href",
      "/instructor/courses/1",
    );
    const sections = screen.getByRole("navigation", { name: "COSC 101 sections" });
    const hrefs = within(sections)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/instructor/courses/1");
    expect(hrefs).toContain("/instructor/courses/1?tab=analytics");
    expect(hrefs).toContain("/student/courses/1");
  });

  it("lists only unpublished courses under Needs attention, each one click from publishing", () => {
    renderDashboard();
    const panel = screen.getByRole("region", { name: "Needs attention" });
    expect(within(panel).queryByText("COSC 101")).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Publish COSC 211" }));
    expect(requestToggle).toHaveBeenCalledWith(draft);
  });

  it("switches to the list layout and remembers it", () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
    expect(window.localStorage.getItem("eduai.aiTutor.dashboard.courseView")).toBe("list");
  });
});
