import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.course";

// #1648: when CourseSwitcher changes only :courseId the route instance is
// reused, so `activeTab` survives the switch. If the new course's per-course
// `viewerRole` drops the staff tabs, a stale `analytics`/`feedback` value has no
// matching Radix trigger and every tab panel hides — the page renders blank.
// This exercises the render-time clamp back to `content`. Uses the REAL
// getCourseDetailTabs so the tab set actually tracks viewerRole.

vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn().mockResolvedValue({}),
    modulesForCourse: vi.fn().mockResolvedValue([]),
  },
}));

// A global-effective TA: the per-course viewerRole (loader data) is what gates
// the tabs, not this global role.
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Aya", role: "TA", authorizedUnits: [] },
  }),
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canManageContent: false, canPublishContent: false }),
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useNavigation: () => ({ state: "idle" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useParams: () => ({ courseId: "42" }),
  };
});

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

vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/courses/CourseAnalyticsPanel", () => ({
  CourseAnalyticsPanel: () => <div data-testid="analytics-panel">analytics</div>,
}));
vi.mock("~/components/courses/CourseFeedbackPanel", () => ({
  CourseFeedbackPanel: () => <div data-testid="feedback-panel">feedback</div>,
}));
vi.mock("~/components/courses/CourseSubmissionsPanel", () => ({
  CourseSubmissionsPanel: () => <div data-testid="submissions-panel">submissions</div>,
}));

import InstructorCourseModules from "~/routes/instructor.course";

const baseCourse = { id: 42, title: "Test Course", code: "COSC 101", isPublished: true };

function props(viewerRole: string): Route.ComponentProps {
  return {
    loaderData: {
      course: { ...baseCourse, viewerRole },
      modules: [],
      modulesTotal: 0,
      page: 1,
      pageSize: 25,
      search: "",
    },
  } as unknown as Route.ComponentProps;
}

describe("instructor.course — activeTab clamp on per-course role change (#1648)", () => {
  it("clamps back to Content when a role change drops the active staff tab", async () => {
    // Start on a course where the viewer is effectively staff (Analytics shown).
    const { rerender } = render(
      <MemoryRouter>
        <InstructorCourseModules {...props("INSTRUCTOR")} />
      </MemoryRouter>,
    );

    // Move the active tab onto Analytics. Radix Tabs activates via roving
    // focus, which happy-dom doesn't drive from a bare click — focus first.
    await act(async () => {
      const analyticsTab = screen.getByRole("tab", { name: "Analytics" });
      fireEvent.focus(analyticsTab);
      fireEvent.click(analyticsTab);
    });
    expect(screen.getByTestId("analytics-panel")).toBeInTheDocument();

    // Switch to a course where this viewer is only a STUDENT — the staff tabs
    // disappear. Without the clamp, activeTab stays "analytics" and the whole
    // tab area renders blank.
    await act(async () => {
      rerender(
        <MemoryRouter>
          <InstructorCourseModules {...props("STUDENT")} />
        </MemoryRouter>,
      );
    });

    // Analytics tab and its panel are gone; Content is active and rendered.
    expect(screen.queryByRole("tab", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("analytics-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Modules" })).toBeInTheDocument();
  });
});
