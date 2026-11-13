import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CourseDashboard, courseLinks } from "~/components/dashboard/course-dashboard";
import type { DashboardCourse } from "~/components/dashboard/dashboard-view";
import { PolicyProvider } from "~/components/policy/policy-gate";
import type { DashboardData } from "~/lib/dashboard/dashboard-data.server";

const course = (overrides: Partial<DashboardCourse> = {}): DashboardCourse => ({
  id: "c1",
  code: "BIOL 116",
  name: "Intro Biology",
  term: "W1",
  year: 2026,
  isPublished: true,
  callerEnrollmentRole: "STUDENT",
  ...overrides,
});

const TUTOR = { id: "ai-tutor", name: "AI Tutor", url: "https://tutor.test/?courseId=c1" };

describe("courseLinks", () => {
  it("gives a learner the course's chat, then the extensions", () => {
    const links = courseLinks(course({ id: "c 1" }), "taking", [TUTOR]);
    expect(links.map((l) => [l.key, l.href, l.external ?? false])).toEqual([
      ["chat", "/chat?courseId=c%201", false],
      ["ai-tutor", TUTOR.url, true],
    ]);
  });

  it("gives a TA the materials only", () => {
    expect(courseLinks(course(), "assisting", []).map((l) => [l.key, l.href])).toEqual([
      ["materials", "/courses/c1?tab=materials"],
    ]);
  });

  it("gives a teacher materials and the assistant of a published course", () => {
    expect(courseLinks(course(), "teaching", []).map((l) => [l.key, l.href])).toEqual([
      ["materials", "/courses/c1?tab=materials"],
      ["assistant", "/instructor/chat?courseId=c1"],
    ]);
  });

  it("disables the assistant of an unpublished course, saying why", () => {
    const assistant = courseLinks(course({ isPublished: false }), "teaching", []).find(
      (l) => l.key === "assistant",
    );
    expect(assistant?.href).toBeUndefined();
    expect(assistant?.disabledReason).toMatch(/Publish this course/);
  });
});

function data(courses: DashboardCourse[], courseTotal = courses.length): DashboardData {
  return {
    stats: {
      chatCount: 3,
      chatCountWeek: 1,
      materialCount: 0,
      studentCount: 0,
      instructorCount: 0,
      totalUsers: 0,
      activeCourseCount: 0,
      materialsByStatus: { ready: 0, processing: 2, failed: 1 },
    },
    recentChats: [],
    courses,
    courseTotal,
  };
}

function renderDashboard(
  props: Partial<React.ComponentProps<typeof CourseDashboard>> & { data: DashboardData },
) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <PolicyProvider policies={{ "instructors.canPublishCourses": true }}>
            <CourseDashboard
              role="STUDENT"
              userRole="STUDENT"
              launcherRole="STUDENT"
              stats={[{ label: "Chats", value: 3 }]}
              {...props}
            />
          </PolicyProvider>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("CourseDashboard", () => {
  it("gives a student with one kind of course a single 'Your courses' grid", () => {
    renderDashboard({ data: data([course()]) });
    expect(screen.getByRole("heading", { name: "Your courses" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Courses you're taking/ })).toBeNull();
    expect(screen.getByRole("link", { name: "BIOL 116 Intro Biology" })).toHaveAttribute(
      "href",
      "/courses/c1",
    );
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chat?courseId=c1");
    expect(screen.getByRole("link", { name: /New chat/ })).toHaveAttribute("href", "/chat");
  });

  it("splits an instructor's courses into teaching, assisting and taking, in that order", () => {
    renderDashboard({
      role: "INSTRUCTOR",
      userRole: "INSTRUCTOR",
      launcherRole: "INSTRUCTOR",
      data: data([
        course({ id: "s", code: "STAT 100", callerEnrollmentRole: "STUDENT" }),
        course({
          id: "t",
          code: "COSC 111",
          callerEnrollmentRole: "INSTRUCTOR",
          isPublished: false,
        }),
        course({ id: "a", code: "MATH 100", callerEnrollmentRole: "TA" }),
      ]),
    });
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
    const sections = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(sections).toEqual(["Courses you teach", "Courses you assist", "Courses you're taking"]);
    const teaching = within(screen.getByRole("region", { name: "Courses you teach" }));
    expect(teaching.getByText("Unpublished")).toBeInTheDocument();
    expect(teaching.getByRole("button", { name: "COSC 111 actions" })).toBeInTheDocument();
    // An instructor's new chat is the course assistant.
    expect(screen.getByRole("link", { name: /New chat/ })).toHaveAttribute(
      "href",
      "/instructor/chat",
    );
  });

  it("switches to the list view and remembers it", () => {
    const { unmount } = renderDashboard({ data: data([course()]) });
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("BIOL 116 · Intro Biology");
    expect(window.localStorage.getItem("eduai.dashboard.courseView")).toBe("list");
    unmount();

    renderDashboard({ data: data([course()]) });
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("keeps the card view when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderDashboard({ data: data([course()]) });
    fireEvent.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("links to every course when the dashboard shows only some", () => {
    renderDashboard({ data: data([course()], 30) });
    expect(screen.getByRole("link", { name: "All 30 courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });

  it("points a user with no courses to the Courses page, or shows the caller's message", () => {
    const { unmount } = renderDashboard({ data: data([]) });
    expect(screen.getByText("You don't have any courses yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Courses" })).toHaveAttribute("href", "/courses");
    unmount();

    renderDashboard({ data: data([]), emptyMessage: "Nothing to teach yet." });
    expect(screen.getByText("Nothing to teach yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to Courses" })).toBeNull();
  });

  it("sums up activity, flagging processing and failed materials", () => {
    renderDashboard({ data: data([course()]) });
    const glance = within(screen.getByRole("complementary", { name: "Activity" }));
    expect(glance.getByText("Chats")).toBeInTheDocument();
    expect(glance.getByText("2 processing")).toBeInTheDocument();
    expect(glance.getByText("1 failed")).toBeInTheDocument();
  });

  it("gives an instructor one Material status panel instead of repeating its counts in At a glance", () => {
    renderDashboard({ role: "INSTRUCTOR", data: data([course()]) });
    const aside = within(screen.getByRole("complementary", { name: "Activity" }));
    const panel = within(aside.getByText("Material status").closest("section")!);
    expect(panel.getByText("Ready").nextElementSibling).toHaveTextContent("0");
    expect(panel.getByText("Processing").nextElementSibling).toHaveTextContent("2");
    expect(panel.getByText("Failed").nextElementSibling).toHaveTextContent("1");
    expect(aside.queryByText("2 processing")).toBeNull();
    expect(aside.queryByText("1 failed")).toBeNull();
  });

  it("leaves the Material status panel to instructors", () => {
    renderDashboard({ data: data([course()]) });
    expect(screen.queryByText("Material status")).toBeNull();
  });
});
