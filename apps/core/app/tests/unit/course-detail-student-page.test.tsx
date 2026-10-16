/**
 * #1962: a student's course page never asks for the course's files. For a
 * student the page switches the materials hook off (the API refuses students
 * on every materials path anyway) and hands the student view no material or
 * upload props. Staff pages keep loading materials as before.
 *
 * Same harness as course-detail-upload-feedback.test.tsx: the route module
 * imports server-only code at the top level, so that is stubbed, and each role
 * view is a probe recording which props it was rendered with.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { CourseDetailManagerView } from "~/components/courses/course-detail-manager-view";
import type { CourseDetailTaView } from "~/components/courses/course-detail-ta-view";
import type { CourseDetailStudentView } from "~/components/courses/course-detail-student-view";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/prisma.server", () => ({ default: {} }));
vi.mock("~/lib/rbac/resolve-course-access.server", () => ({ resolveCourseAccess: vi.fn() }));

type PageAccess = "admin" | "unit" | "instructor" | "ta" | "student";

interface LoaderFixture {
  course: { id: string; name: string; code: string; department: string };
  user: { id: string; role: string };
  access: PageAccess;
  courseInstructors: never[];
}

const loaderData: LoaderFixture = {
  course: { id: "course-1", name: "Intro", code: "CS100", department: "CPSC" },
  user: { id: "user-1", role: "STUDENT" },
  access: "student",
  courseInstructors: [],
};

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return {
    ...actual,
    useLoaderData: () => loaderData,
    useRevalidator: () => ({ revalidate: vi.fn(), state: "idle" }),
    Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

/** Every call the page made to the materials hook, as `[courseId, enabled]`. */
const materialsHookCalls: Array<[string, boolean | undefined]> = [];

vi.mock("~/hooks/api/use-course-materials", () => ({
  useCourseMaterials: (courseId: string, enabled?: boolean) => {
    materialsHookCalls.push([courseId, enabled]);
    return {
      materials: [],
      uploadMaterial: vi.fn(),
      deleteMaterial: vi.fn(),
      reprocessMaterial: vi.fn(),
      hasMore: false,
      loadingMore: false,
      loadMore: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));
vi.mock("~/hooks/api/use-course-topics", () => ({
  useCourseTopics: () => ({ topics: [], createTopic: vi.fn(), deleteTopic: vi.fn() }),
}));
vi.mock("~/hooks/api/use-course-enrollments", () => ({
  useCourseEnrollments: () => ({
    enrollments: [],
    loading: false,
    error: null,
    total: 0,
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    enroll: vi.fn(),
    removeEnrollment: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("~/hooks/api/use-course-tas", () => ({
  useCourseTAs: () => ({ tas: [], addTA: vi.fn(), removeTA: vi.fn() }),
}));
vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/layout/course-switcher", () => ({ CourseSwitcher: () => null }));

/** Which role view rendered, and the names of the props it was handed. */
const renderedViews: Array<{ view: string; propNames: string[] }> = [];

type RoleViewProps =
  | ComponentProps<typeof CourseDetailManagerView>
  | ComponentProps<typeof CourseDetailTaView>
  | ComponentProps<typeof CourseDetailStudentView>;

/** Stand-in for a role view: records what it was handed and renders nothing. */
function recordView(view: string, props: RoleViewProps) {
  renderedViews.push({ view, propNames: Object.keys(props).sort() });
  return null;
}

vi.mock("~/components/courses/course-detail-manager-view", () => ({
  CourseDetailManagerView: (p: RoleViewProps) => recordView("manager", p),
}));
vi.mock("~/components/courses/course-detail-ta-view", () => ({
  CourseDetailTaView: (p: RoleViewProps) => recordView("ta", p),
}));
vi.mock("~/components/courses/course-detail-student-view", () => ({
  CourseDetailStudentView: (p: RoleViewProps) => recordView("student", p),
}));

import CourseDetailPage from "~/routes/courses.$courseId";

beforeEach(() => {
  materialsHookCalls.length = 0;
  renderedViews.length = 0;
});

describe("CourseDetailPage materials by role (#1962)", () => {
  it("never asks for materials on a student's course page", () => {
    loaderData.access = "student";
    render(<CourseDetailPage />);

    expect(materialsHookCalls.length).toBeGreaterThan(0);
    expect(materialsHookCalls.every(([, enabled]) => enabled === false)).toBe(true);
  });

  it("hands the student view only the course, its topics and its TAs", () => {
    loaderData.access = "student";
    render(<CourseDetailPage />);

    const student = renderedViews.find((r) => r.view === "student");
    expect(student?.propNames).toEqual(["course", "tas", "topics"]);
  });

  it.each(["admin", "unit", "instructor", "ta"] as const)(
    "still loads materials for %s",
    (access) => {
      loaderData.access = access;
      render(<CourseDetailPage />);

      expect(materialsHookCalls.every(([, enabled]) => enabled === true)).toBe(true);
      const staffView = renderedViews.find((r) => r.view !== "student");
      expect(staffView?.propNames).toContain("materials");
    },
  );
});
