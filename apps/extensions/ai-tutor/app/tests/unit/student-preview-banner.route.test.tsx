/**
 * #1660: ADMIN, UNIT_ADMIN, and INSTRUCTOR can now open the /student/*
 * content routes to preview the learner experience. These tests pin the two
 * halves of that: the widened role gate renders real content instead of
 * throwing (component-level proxy for requireClientUser's allow-list — the
 * gate itself lives in each route's clientLoader, exercised via
 * requireClientUser.test.ts's own coverage) and the StudentPreviewBanner
 * shows for the three staff roles but not for a real STUDENT/TA, mirroring
 * student.route.test.tsx's "#746 review: TA preview must stay student-shaped".
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Role } from "~/lib/types";

const mockUser = vi.hoisted(() => ({ current: { id: "u1", name: "Viewer", role: "STUDENT" } }));

vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn(),
    modulesForCourse: vi.fn(),
    activitiesForLesson: vi.fn(),
    lessonBreadcrumb: vi.fn(),
    submitAnswer: vi.fn(),
    mySubmissions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ courseId: "1", lessonId: "3" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser.current }),
}));
vi.mock("~/hooks/useCourseTopics", () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false }),
  CourseTopicsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({ setContext: vi.fn(), clearContext: vi.fn() }),
}));
vi.mock("~/components/StudentAiChat", () => ({ default: () => null }));

import StudentCourseModules from "~/routes/student.course";
import StudentModuleLessons from "~/routes/student.module";
import StudentLessonPlayer from "~/routes/student.lesson";

const course = { id: 1, title: "Course 1", code: "COSC 101", isPublished: true };

function setRole(role: Role) {
  mockUser.current = { id: "u1", name: "Viewer", role };
}

function renderCourse() {
  return render(
    <MemoryRouter>
      <StudentCourseModules
        {...({
          loaderData: {
            course,
            modules: [{ id: 10, title: "Module A", description: "", position: 0 }],
            modulesTotal: 1,
            page: 1,
            pageSize: 25,
          },
        } as React.ComponentProps<typeof StudentCourseModules>)}
      />
    </MemoryRouter>,
  );
}

function renderModule() {
  const loaderData: React.ComponentProps<typeof StudentModuleLessons>["loaderData"] = {
    course,
    module: {
      id: 10,
      title: "Module A",
      description: "",
      position: 0,
      isPublished: true,
      courseOfferingId: 1,
    },
    lessons: [],
    moduleOrder: 1,
  };
  return render(
    <MemoryRouter>
      <StudentModuleLessons
        {...({ loaderData } as React.ComponentProps<typeof StudentModuleLessons>)}
      />
    </MemoryRouter>,
  );
}

function renderLesson() {
  const loaderData: React.ComponentProps<typeof StudentLessonPlayer>["loaderData"] = {
    lesson: {
      id: 3,
      title: "Lesson 1",
      contentMd: "",
      position: 0,
      moduleId: 10,
      isPublished: true,
    },
    activities: [],
    activitiesTotal: 0,
  };
  return render(
    <MemoryRouter>
      <StudentLessonPlayer
        {...({ loaderData } as React.ComponentProps<typeof StudentLessonPlayer>)}
      />
    </MemoryRouter>,
  );
}

describe.each([
  ["student.course", renderCourse],
  ["student.module", renderModule],
  ["student.lesson", renderLesson],
] as const)("%s — StudentPreviewBanner by role (#1660)", (_name, renderRoute) => {
  it("does not show the preview banner for a real STUDENT", () => {
    setRole("STUDENT");
    renderRoute();
    expect(screen.queryByTestId("student-preview-banner")).not.toBeInTheDocument();
  });

  it("does not show the preview banner for a real TA", () => {
    setRole("TA");
    renderRoute();
    expect(screen.queryByTestId("student-preview-banner")).not.toBeInTheDocument();
  });

  it("shows the preview banner for ADMIN", () => {
    setRole("ADMIN");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
    expect(screen.getByText(/previewing as a student/i)).toBeInTheDocument();
  });

  it("shows the preview banner for UNIT_ADMIN", () => {
    setRole("UNIT_ADMIN");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
  });

  it("shows the preview banner for INSTRUCTOR", () => {
    setRole("INSTRUCTOR");
    renderRoute();
    expect(screen.getByTestId("student-preview-banner")).toBeInTheDocument();
  });
});
