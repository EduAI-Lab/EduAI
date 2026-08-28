/**
 * #1660: "Preview as student" entry point on the instructor course page —
 * the only route this issue's target roles (ADMIN, UNIT_ADMIN, INSTRUCTOR)
 * already share for viewing a course (its own clientLoader already allows
 * all three). TA is excluded — a TA has a real, non-preview /student view of
 * this same course, not someone else's.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.course";

const mockUser = vi.hoisted(() => ({
  current: { id: "u1", name: "Viewer", role: "INSTRUCTOR", authorizedUnits: [] as string[] },
}));
const mockNavigate = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({}),
    modulesForCourse: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 }),
  },
}));

vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser.current }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  // #1660 review (ariqmuldi, PR #1667): the entry-point button now reads
  // perms.canPreviewAsStudent (moved out of StudentPreviewBanner.tsx into
  // permissions.ts, the app's one RBAC source of truth) instead of
  // re-deriving isStudentPreviewRole(user?.role) inline — derive it here
  // from the same mockUser each test sets, rather than a static value, so
  // this mock still exercises the per-role behavior it did before.
  useAtPermissions: () => ({
    canPublishContent: true,
    canManageContent: true,
    canPreviewAsStudent: ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"].includes(mockUser.current.role),
  }),
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ courseId: "42" }),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock("~/lib/rbac/nav", () => ({
  getCourseDetailTabs: () => [{ id: "content", label: "Content" }],
}));
vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/hooks/useCourseTopics", () => ({
  useCourseTopics: () => ({ topics: [], total: 0, loading: false, refresh: vi.fn() }),
}));
vi.mock("~/components/courses/CourseTopicsHeroAction", () => ({
  CourseTopicsHeroAction: () => null,
}));
vi.mock("~/components/courses/CourseAnalyticsPanel", () => ({ CourseAnalyticsPanel: () => null }));
vi.mock("~/components/courses/CourseSubmissionsPanel", () => ({
  CourseSubmissionsPanel: () => null,
}));
vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  return {
    ...actual,
    PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

import InstructorCourseModules from "~/routes/instructor.course";

const course = { id: 42, title: "Test Course", code: "COSC 101", isPublished: true };

function renderPage() {
  const loaderData: Route.ComponentProps["loaderData"] = {
    course,
    modules: [],
    modulesTotal: 0,
    page: 1,
    pageSize: 25,
    search: "",
  };
  const props = { loaderData } as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

describe("instructor.course — Preview as student entry point (#1660)", () => {
  it("navigates to the student course view for INSTRUCTOR", () => {
    mockUser.current = { id: "u1", name: "Viewer", role: "INSTRUCTOR", authorizedUnits: [] };
    renderPage();
    screen.getByRole("button", { name: /preview as student/i }).click();
    expect(mockNavigate).toHaveBeenCalledWith("/student/courses/42");
  });

  it("shows the entry point for ADMIN", () => {
    mockUser.current = { id: "u1", name: "Viewer", role: "ADMIN", authorizedUnits: [] };
    renderPage();
    expect(screen.getByRole("button", { name: /preview as student/i })).toBeInTheDocument();
  });

  it("shows the entry point for UNIT_ADMIN", () => {
    mockUser.current = { id: "u1", name: "Viewer", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] };
    renderPage();
    expect(screen.getByRole("button", { name: /preview as student/i })).toBeInTheDocument();
  });

  it("hides the entry point for TA — they already have a real (non-preview) /student view", () => {
    mockUser.current = { id: "u1", name: "Viewer", role: "TA", authorizedUnits: [] };
    renderPage();
    expect(screen.queryByRole("button", { name: /preview as student/i })).not.toBeInTheDocument();
  });
});
