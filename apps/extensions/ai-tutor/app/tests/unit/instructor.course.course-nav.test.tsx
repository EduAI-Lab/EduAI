import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { CourseNavConfig } from "@eduai/ui";
import type { Route } from "../../routes/+types/instructor.course";

// #1648: the section comes from `?tab=` (picked in the shell's course menu),
// and the route instance is reused when only :courseId changes. If the new
// course's per-course `viewerRole` drops the staff sections, a stale
// `?tab=analytics` must land on Content rather than hide every panel. Uses the
// REAL getCourseDetailTabs so the section set actually tracks viewerRole.

let searchParams = new URLSearchParams();
let publishedNav: CourseNavConfig | undefined;

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
    useSearchParams: () => [searchParams, vi.fn()],
    useParams: () => ({ courseId: "42" }),
  };
});

vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/ShellCourseNavContext", () => ({
  useShellCourseNav: (config: CourseNavConfig | undefined) => {
    publishedNav = config;
  },
}));
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

import InstructorCourseModules, { shouldRevalidate } from "~/routes/instructor.course";

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

beforeEach(() => {
  searchParams = new URLSearchParams();
  publishedNav = undefined;
});

describe("instructor.course — course menu sections", () => {
  it("publishes the viewer's sections to the shell's course menu as ?tab= links", () => {
    searchParams = new URLSearchParams("tab=analytics");
    render(
      <MemoryRouter>
        <InstructorCourseModules {...props("INSTRUCTOR")} />
      </MemoryRouter>,
    );

    expect(publishedNav).toMatchObject({
      href: "/instructor/courses/42",
      code: "COSC 101",
      activeKey: "analytics",
    });
    expect(publishedNav?.items.map((item) => item.href)).toEqual([
      "/instructor/courses/42",
      "/instructor/courses/42?tab=submissions",
      "/instructor/courses/42?tab=feedback",
      "/instructor/courses/42?tab=analytics",
    ]);
    expect(screen.getByRole("region", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByTestId("analytics-panel")).toBeInTheDocument();
  });
});

describe("instructor.course — section clamp on per-course role change (#1648)", () => {
  it("lands a staff-only ?tab= on Content when the course drops that section", async () => {
    // Start on a course where the viewer is effectively staff (Analytics shown).
    searchParams = new URLSearchParams("tab=analytics");
    const { rerender } = render(
      <MemoryRouter>
        <InstructorCourseModules {...props("INSTRUCTOR")} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("analytics-panel")).toBeInTheDocument();

    // Switch to a course where this viewer is only a STUDENT — the staff
    // sections disappear while `?tab=analytics` is still in the URL.
    await act(async () => {
      rerender(
        <MemoryRouter>
          <InstructorCourseModules {...props("STUDENT")} />
        </MemoryRouter>,
      );
    });

    // Analytics and its panel are gone; Content is active and rendered.
    expect(publishedNav?.items.map((item) => item.key)).toEqual(["content"]);
    expect(publishedNav?.activeKey).toBe("content");
    expect(screen.queryByTestId("analytics-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Modules" })).toBeInTheDocument();
  });
});

describe("instructor.course — shouldRevalidate", () => {
  const check = (from: string, to: string, formMethod?: "POST") =>
    shouldRevalidate({
      currentUrl: new URL(`http://at.test${from}`),
      nextUrl: new URL(`http://at.test${to}`),
      formMethod,
      defaultShouldRevalidate: true,
    } as Parameters<typeof shouldRevalidate>[0]);

  it("skips the loader when only the section changes", () => {
    expect(check("/instructor/courses/42", "/instructor/courses/42?tab=feedback")).toBe(false);
    expect(
      check("/instructor/courses/42?page=2&tab=feedback", "/instructor/courses/42?page=2"),
    ).toBe(false);
  });

  it("reloads for a new page, search, course, or a form submission", () => {
    expect(check("/instructor/courses/42", "/instructor/courses/42?page=2")).toBe(true);
    expect(check("/instructor/courses/42", "/instructor/courses/7?tab=feedback")).toBe(true);
    expect(check("/instructor/courses/42", "/instructor/courses/42?tab=feedback", "POST")).toBe(
      true,
    );
  });
});
