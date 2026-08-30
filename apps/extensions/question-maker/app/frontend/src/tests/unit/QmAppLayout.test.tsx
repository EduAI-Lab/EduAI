/**
 * Unit tests for `QmAppLayout` (#1546): the app shell wrapper — nav building
 * from RBAC helpers, route-aware breadcrumb/title, the composer sticky-bar
 * className branch, the guided-tour click handler, and the "no courses yet"
 * pulse indicator. Every `@eduai/ui` shell primitive and sibling
 * component/context is mocked so this exercises only QmAppLayout's own logic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

let pathnameValue = "/dashboard";
let searchParamsValue = new URLSearchParams();
const navigate = vi.fn();
const startTour = vi.fn();
const logout = vi.fn();
const refresh = vi.fn();
const openBugReport = vi.fn();
let bugReportValue: { openBugReport: () => void } | null = { openBugReport };
let coursesValue: any[] = [];
let isCoursesLoadingValue = false;
let guidedTourHandlerValue: (() => void) | null = null;
let userValue: any = { id: "1", name: "Ada", email: "ada@example.com", role: "instructor" };
const { toastErrorFn, toastFn, createCourse } = vi.hoisted(() => {
  const toastErrorFn = vi.fn();
  const toastFn = Object.assign(vi.fn(), { error: toastErrorFn });
  return { toastErrorFn, toastFn, createCourse: vi.fn() };
});

vi.mock("sonner", () => ({ toast: toastFn }));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: pathnameValue }),
  useNavigate: () => navigate,
  useSearchParams: () => [searchParamsValue],
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  Outlet: () => <div data-testid="outlet" />,
}));

let capturedAppShellProps: any = null;

vi.mock("@eduai/ui", () => ({
  AppShell: (props: any) => {
    capturedAppShellProps = props;
    return (
      <div data-testid="app-shell" data-classname={props.mainClassName} data-title={props.title}>
        <div data-testid="breadcrumbs">{props.breadcrumbs}</div>
        <div data-testid="header-actions">{props.headerActions}</div>
        <div data-testid="command-palette-slot">{props.commandPalette}</div>
        {props.children}
      </div>
    );
  },
  ThemeToggle: () => <div data-testid="theme-toggle" />,
  Breadcrumb: ({ children }: any) => <nav>{children}</nav>,
  BreadcrumbList: ({ children }: any) => <ol>{children}</ol>,
  BreadcrumbItem: ({ children }: any) => <li>{children}</li>,
  BreadcrumbPage: ({ children }: any) => <span>{children}</span>,
  BreadcrumbLink: ({ children }: any) => <span>{children}</span>,
  BreadcrumbSeparator: () => <span>/</span>,
  Button: ({ children, onClick, "aria-label": ariaLabel }: any) => (
    <button aria-label={ariaLabel} onClick={onClick}>
      {children}
    </button>
  ),
  CommandSearchButton: () => <div data-testid="command-search-button" />,
  AIServiceIndicators: (props: any) => (
    <button data-testid="ai-indicators" onClick={props.onRefresh} />
  ),
  NavSecondary: () => null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: userValue,
    logout,
  }),
}));

vi.mock("@/components/layout/QmLayoutContext", async () => {
  const actual = await vi.importActual<any>("@/components/layout/QmLayoutContext");
  return {
    ...actual,
    useQmLayout: () => ({
      profileOpen: false,
      closeProfile: vi.fn(),
      guidedTourHandler: guidedTourHandlerValue,
    }),
  };
});

vi.mock("@/components/profile/ProfileCoursesDialog", () => ({
  ProfileCoursesDialog: () => <div data-testid="profile-dialog" />,
}));

vi.mock("@/hooks/useCourses", () => ({
  useCourses: () => ({
    courses: coursesValue,
    isLoading: isCoursesLoadingValue,
    fetchCourses: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAiServicesStatus", () => ({
  useAiServicesStatus: () => ({ cloud: { state: "online" }, ubc: { state: "online" }, refresh }),
}));

vi.mock("@/contexts/GuidedTourContext", () => ({
  useGuidedTour: () => ({ startTour }),
}));

vi.mock("@/contexts/BugReportContext", () => ({
  useBugReport: () => bugReportValue,
}));

vi.mock("@/lib/rbac/nav", () => ({
  getNavForUser: (user: any) =>
    user ? [{ key: "dashboard", title: "Dashboard", href: "/dashboard" }] : [],
  getNavSecondaryForUser: (user: any) =>
    user ? [{ key: "help", title: "Help", href: "/help" }] : [],
  getFooterNavForUser: (_user: any) => [
    { key: "back-to-eduai", title: "Back to EduAI", href: "/dashboard" },
  ],
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/layout/CourseSwitcher", () => ({
  CourseSwitcher: ({ courseId }: any) => <div data-testid="course-switcher">{courseId}</div>,
}));

vi.mock("@/components/command/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("@/lib/apps", () => ({
  CURRENT_APP_ID: "question-maker",
  getLauncherApps: () => [],
}));

vi.mock("@/services/courseService", () => ({
  courseService: { createCourse },
}));

import { QmAppLayout, QmAccessShell } from "@/components/layout/QmAppLayout";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathnameValue = "/dashboard";
  searchParamsValue = new URLSearchParams();
  coursesValue = [];
  isCoursesLoadingValue = false;
  guidedTourHandlerValue = null;
  bugReportValue = { openBugReport };
  userValue = { id: "1", name: "Ada", email: "ada@example.com", role: "instructor" };
  capturedAppShellProps = null;
});

describe("QmAppLayout", () => {
  it("renders the dashboard title for /dashboard", () => {
    pathnameValue = "/dashboard";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Dashboard");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it('shows "Course workspace" title and a course switcher for a course route', () => {
    pathnameValue = "/courses/42";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Course workspace");
    expect(screen.getByTestId("course-switcher")).toHaveTextContent("42");
  });

  it('shows the "New question" sub-crumb on the composer route', () => {
    pathnameValue = "/courses/42/questions/new";
    render(<QmAppLayout />);
    expect(screen.getByText("New question")).toBeInTheDocument();
  });

  it("applies the min-w-0 flex-1 mainClassName on composer routes", () => {
    pathnameValue = "/courses/42/questions/new";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.classname).toBe("min-w-0 flex-1");
  });

  it("leaves mainClassName undefined off the composer route", () => {
    pathnameValue = "/dashboard";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.classname).toBeUndefined();
  });

  it('falls back to "Question Maker" for an unmapped path', () => {
    pathnameValue = "/some/unknown/path";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Question Maker");
  });

  it("shows the pulsing indicator only when the user has no courses yet", () => {
    coursesValue = [];
    isCoursesLoadingValue = false;
    const { container, rerender } = render(<QmAppLayout />);
    expect(container.querySelector(".animate-ping")).toBeTruthy();

    cleanup();
    coursesValue = [{ id: 1 }];
    render(<QmAppLayout />);
  });

  it("does not show the pulsing indicator while courses are loading", () => {
    coursesValue = [];
    isCoursesLoadingValue = true;
    const { container } = render(<QmAppLayout />);
    expect(container.querySelector(".animate-ping")).toBeFalsy();
  });

  it("clicking the guided tour button calls the registered handler when present", () => {
    guidedTourHandlerValue = vi.fn();
    render(<QmAppLayout />);
    fireEvent.click(screen.getByLabelText("Guided tour"));
    expect(guidedTourHandlerValue).toHaveBeenCalled();
    expect(startTour).not.toHaveBeenCalled();
  });

  it('clicking the guided tour button falls back to startTour("main") when no handler is registered', () => {
    render(<QmAppLayout />);
    fireEvent.click(screen.getByLabelText("Guided tour"));
    expect(startTour).toHaveBeenCalledWith("main");
  });

  it("renders the bug report button when a BugReportContext is present, and calls it on click", () => {
    render(<QmAppLayout />);
    const btn = screen.getByLabelText("Report a bug");
    fireEvent.click(btn);
    expect(openBugReport).toHaveBeenCalled();
  });

  it("omits the bug report button when no BugReportContext is present", () => {
    bugReportValue = null;
    render(<QmAppLayout />);
    expect(screen.queryByLabelText("Report a bug")).toBeNull();
  });

  it("refreshing AI status calls refresh()", () => {
    render(<QmAppLayout />);
    fireEvent.click(screen.getByTestId("ai-indicators"));
    expect(refresh).toHaveBeenCalled();
  });

  it("opens a Core course that has not been mirrored yet", async () => {
    searchParamsValue = new URLSearchParams("coreCourseId=core-new");
    createCourse.mockResolvedValueOnce({ id: 42, coreCourseId: "core-new" });

    render(<QmAppLayout />);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/courses/42?tab=overview&coreCourseId=core-new", {
        replace: true,
      }),
    );
  });
});

describe("QmAppLayout additional coverage", () => {
  it("shows a toast error when logout rejects", async () => {
    logout.mockRejectedValueOnce(new Error("network"));
    render(<QmAppLayout />);
    capturedAppShellProps.sidebar.navUser.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).toHaveBeenCalledWith("Could not log out", expect.any(Object));
  });

  it("does not toast when logout resolves", async () => {
    logout.mockResolvedValueOnce(undefined);
    render(<QmAppLayout />);
    capturedAppShellProps.sidebar.navUser.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).not.toHaveBeenCalled();
  });

  it("falls back to Guest sidebar user when unauthenticated", () => {
    userValue = null;
    render(<QmAppLayout />);
    expect(capturedAppShellProps.sidebar.user).toEqual({ name: "Guest", email: "", role: "GUEST" });
    expect(capturedAppShellProps.sidebar.navUser).toBeUndefined();
  });

  it("uses the user email as sidebar name when name is absent", () => {
    userValue = { id: "1", email: "noname@example.com", role: "instructor" };
    render(<QmAppLayout />);
    expect(capturedAppShellProps.sidebar.user.name).toBe("noname@example.com");
  });

  it.each([
    ["/courses/42/questions/1/edit", "Edit question"],
    ["/courses/42/questions/1/variant", "New variant"],
    ["/courses/42/assessments/5/variants", "Variants"],
    ["/courses/42/assessments/5", "Assessment builder"],
    ["/courses/42/banks/7", "Question bank"],
  ])("shows the %s sub-crumb for %s", (path, expected) => {
    pathnameValue = path;
    render(<QmAppLayout />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows no sub-crumb for a bare course workspace route", () => {
    pathnameValue = "/courses/42";
    render(<QmAppLayout />);
    expect(screen.queryByText("Assessment builder")).toBeNull();
  });
});

describe("QmAccessShell", () => {
  it("renders children inside the minimal shell for an authenticated user", () => {
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    expect(screen.getByText("gated content")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Question Maker");
  });

  it("falls back to a Guest sidebar user when unauthenticated", () => {
    userValue = null;
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    expect(capturedAppShellProps.sidebar.user).toEqual({ name: "Guest", email: "", role: "GUEST" });
    expect(capturedAppShellProps.sidebar.navUser).toBeUndefined();
  });

  it("wires onLogout and surfaces a toast on failure", async () => {
    logout.mockRejectedValueOnce(new Error("network"));
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    capturedAppShellProps.sidebar.navUser.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).toHaveBeenCalled();
  });
});
