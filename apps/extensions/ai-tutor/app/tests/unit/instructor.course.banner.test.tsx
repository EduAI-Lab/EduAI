import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { Route } from "../../routes/+types/instructor.course";

const requestToggle = vi.fn();
const topicsState = { topics: [] as { id: number; name: string }[], total: 0 };

vi.mock("~/components/courses/useCoursePublishToggle", () => ({
  useCoursePublishToggle: () => ({ requestToggle, dialog: null }),
}));
vi.mock("~/lib/api", () => ({
  default: {
    courseById: vi.fn(),
    modulesForCourse: vi.fn(),
  },
}));
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({
    user: { id: "u1", name: "Instructor", role: "INSTRUCTOR", authorizedUnits: [] },
  }),
}));
vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ canManageContent: true, canPublishContent: true }),
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
vi.mock("~/lib/rbac/nav", () => ({
  getCourseDetailTabs: () => [{ id: "content", label: "Content" }],
}));
vi.mock("~/components/layout/ShellBreadcrumbContext", () => ({
  useShellBreadcrumbs: () => {},
  ShellBreadcrumbContext: {},
}));
vi.mock("~/components/layout/CourseSwitcher", () => ({ CourseSwitcher: () => null }));
vi.mock("~/hooks/useCourseTopics", () => ({
  useCourseTopics: () => ({ ...topicsState, loading: false, refresh: vi.fn() }),
}));
vi.mock("~/components/courses/CourseTopicsHeroAction", () => ({
  CourseTopicsHeroAction: () => null,
}));
vi.mock("~/components/courses/CourseAnalyticsPanel", () => ({ CourseAnalyticsPanel: () => null }));
vi.mock("~/components/courses/CourseSubmissionsPanel", () => ({
  CourseSubmissionsPanel: () => null,
}));

import InstructorCourseModules from "~/routes/instructor.course";

const draftCourse = { id: 42, title: "Test Course", code: "COSC 101", isPublished: false };
const draftModule = { id: 10, title: "Module 1", description: "", position: 0, isPublished: false };

function wrap(overrides: Partial<Route.ComponentProps["loaderData"]> = {}) {
  const props = {
    loaderData: {
      course: draftCourse,
      modules: [draftModule],
      modulesTotal: 1,
      moduleCounts: { all: 1, publishedOffPage: 0 },
      page: 1,
      pageSize: 25,
      search: "",
      ...overrides,
    },
  } as Route.ComponentProps;
  return render(
    <MemoryRouter>
      <InstructorCourseModules {...props} />
    </MemoryRouter>,
  );
}

const steps = () => screen.getByRole("region", { name: "Course setup" });

describe("instructor.course — banner and next steps", () => {
  beforeEach(() => {
    requestToggle.mockClear();
    topicsState.topics = [];
    topicsState.total = 0;
    window.localStorage.clear();
  });

  it("says how many topics the banner chips leave out", () => {
    topicsState.topics = [{ id: 1, name: "Graphs" }];
    topicsState.total = 4;
    wrap();
    expect(screen.getByText("Graphs")).toBeInTheDocument();
    expect(screen.getByText("+3 more")).toBeInTheDocument();
  });

  it("publishes the course from the banner menu", async () => {
    wrap();
    const trigger = screen.getByRole("button", { name: "COSC 101 course actions" });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: /publish course/i }));
    });
    expect(requestToggle).toHaveBeenCalledWith(draftCourse);
  });

  it("publishes the course from its last step once there is content", () => {
    wrap({ course: { ...draftCourse, contentCounts: { lessons: 1, activities: 1 } } });
    fireEvent.click(within(steps()).getByRole("button", { name: /^\d*publish for students/i }));
    expect(requestToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
  });

  it("keeps publishing as the last step until a lesson and an activity exist (#2170)", () => {
    wrap();
    expect(
      within(steps()).queryByRole("button", { name: /^\d*publish for students/i }),
    ).not.toBeInTheDocument();
    expect(within(steps()).getByText(/^publish for students/i)).toHaveTextContent(
      "Last step: add a module, a lesson and an activity first.",
    );
  });

  it("sends the Add a lesson step into the first module", () => {
    wrap();
    expect(within(steps()).getByRole("link", { name: /^\d*add a lesson/i })).toHaveAttribute(
      "href",
      "/instructor/module/10",
    );
  });

  it("opens the create dialog from the Add a module step", () => {
    wrap({ modules: [], modulesTotal: 0, moduleCounts: { all: 0, publishedOffPage: 0 } });
    fireEvent.click(within(steps()).getByRole("button", { name: /^\d*add a module/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("counts the whole course while a search narrows the list", () => {
    wrap({
      modulesTotal: 1,
      moduleCounts: { all: 12, publishedOffPage: 0 },
      search: "graphs",
    });
    expect(screen.getByRole("heading", { name: /modules/i, level: 2 })).toHaveTextContent(
      "Modules(12)",
    );
    expect(within(steps()).getByText(/^add a module/i)).toHaveTextContent("(done)");
  });

  it("marks publishing done when the published module is on another page", () => {
    wrap({
      course: { ...draftCourse, isPublished: true },
      moduleCounts: { all: 30, publishedOffPage: 1 },
    });
    expect(within(steps()).getByText(/^publish for students/i)).toHaveTextContent("(done)");
  });

  it("leaves publishing to do when no module anywhere is published", () => {
    wrap({ course: { ...draftCourse, isPublished: true } });
    expect(within(steps()).getByText(/^publish for students/i)).toHaveTextContent("(to do)");
  });
});
