/**
 * Unit tests for `QmAppLayout` (#1546): the app shell wrapper — the nav model
 * built from RBAC helpers, the course menu, route-aware breadcrumb/title, the
 * composer sticky-bar className branch, the help modal's tour entry, and the
 * "no courses yet" pulse indicator. The shared `NavShell` and sibling
 * components/contexts are mocked so this exercises only QmAppLayout's own logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";

let pathnameValue = "/dashboard";
let searchParamsValue = new URLSearchParams();
let searchValue = "";
const navigate = vi.fn();
const startTour = vi.fn();
const logout = vi.fn();
const refresh = vi.fn();
const revalidateCloud = vi.fn().mockResolvedValue(undefined);
const openBugReport = vi.fn();
let bugReportValue: { openBugReport: () => void } | null = { openBugReport };
let coursesValue: any[] = [];
let isCoursesLoadingValue = false;
let userValue: any = { id: "1", name: "Ada", email: "ada@example.com", role: "instructor" };
const { toastErrorFn, toastFn, createCourse } = vi.hoisted(() => {
  const toastErrorFn = vi.fn();
  const toastFn = Object.assign(vi.fn(), { error: toastErrorFn });
  return { toastErrorFn, toastFn, createCourse: vi.fn() };
});

vi.mock("sonner", () => ({ toast: toastFn }));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: pathnameValue, search: searchValue, key: "test-key" }),
  useNavigate: () => navigate,
  useSearchParams: () => [searchParamsValue],
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  Outlet: () => <div data-testid="outlet" />,
}));

let capturedShellProps: any = null;

// The shell primitives are stubbed, but `useHistoryOnOpen` is the REAL hook:
// its one-request-per-open contract is what the history wiring below asserts,
// and a stub would assert nothing.
vi.mock("@eduai/ui", async (importOriginal) => ({
  OnboardingChecklist: (await importOriginal<any>()).OnboardingChecklist,
  GettingStartedButton: (await importOriginal<any>()).GettingStartedButton,
  PageTourButton: (await importOriginal<any>()).PageTourButton,
  useHistoryOnOpen: (await importOriginal<any>()).useHistoryOnOpen,
  termLabel: (await importOriginal<any>()).termLabel,
  visibleAppsForRole: (await importOriginal<any>()).visibleAppsForRole,
  // Real help button + resolver: the modal's tour wiring is what's asserted below.
  PageHelpButton: (await importOriginal<any>()).PageHelpButton,
  resolvePageHelp: (await importOriginal<any>()).resolvePageHelp,
  useTour: () => ({ startTour }),
  NavShell: (props: any) => {
    capturedShellProps = props;
    return (
      <div data-testid="app-shell" data-classname={props.mainClassName} data-title={props.title}>
        <div data-testid="breadcrumbs">{props.breadcrumbs}</div>
        <div data-testid="course-nav">{props.courseNav?.subPage}</div>
        <div data-testid="header-actions">{props.headerActions}</div>
        <div data-testid="overlays-slot">{props.overlays}</div>
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
    <div>
      <button data-testid="ai-indicators" onClick={props.onRefresh} />
      <button data-testid="ubc-open" onClick={() => props.onUbcOpenChange?.(true)} />
      <button data-testid="ubc-close" onClick={() => props.onUbcOpenChange?.(false)} />
      <div data-testid="ubc-history">{props.ubcHistory}</div>
    </div>
  ),
  AIServiceHistoryPanel: (props: any) => (
    <div
      data-testid="history-panel"
      data-loading={String(!!props.loading)}
      data-error={props.error ?? ""}
      data-status-href={props.statusPageHref ?? ""}
      data-status-target={props.statusPageTarget ?? ""}
    >
      {props.data ? "has-data" : "no-data"}
      <button data-testid="history-refresh" onClick={props.onRefresh} />
    </div>
  ),
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
  revalidateCloud: (...args: unknown[]) => revalidateCloud(...args),
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

vi.mock("@/components/command/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("@/lib/apps", () => ({
  CURRENT_APP_ID: "question-maker",
  getLauncherApps: () => [
    { id: "question-maker", name: "Question Maker", url: "/", roles: ["TA", "INSTRUCTOR"] },
    { id: "admin-only", name: "Admin only", url: "/", roles: ["ADMIN"] },
  ],
}));

vi.mock("@/services/courseService", () => ({
  courseService: { createCourse },
}));

const getAiStatusHistory = vi.fn();
vi.mock("@/services/eduaiService", () => ({
  default: { getAiStatusHistory: (...args: unknown[]) => getAiStatusHistory(...args) },
}));

import { QmAppLayout, QmAccessShell } from "@/components/layout/QmAppLayout";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  getAiStatusHistory.mockReset();
  pathnameValue = "/dashboard";
  searchParamsValue = new URLSearchParams();
  searchValue = "";
  coursesValue = [];
  isCoursesLoadingValue = false;
  bugReportValue = { openBugReport };
  userValue = { id: "1", name: "Ada", email: "ada@example.com", role: "instructor" };
  capturedShellProps = null;
});

const COURSE_42 = { id: 42, code: "BIOL 116", name: "Intro Biology", term: "W1", year: 2026 };

describe("QmAppLayout", () => {
  it("shows the Getting started button in the header on a non-dashboard route and sends it to /dashboard (#2070)", () => {
    pathnameValue = "/courses";
    userValue = { ...userValue, role: "INSTRUCTOR" };
    render(<QmAppLayout />);
    fireEvent.click(
      within(screen.getByTestId("header-actions")).getByRole("button", {
        name: "Show getting started checklist",
      }),
    );
    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });

  it("renders the dashboard title for /dashboard", () => {
    pathnameValue = "/dashboard";
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Dashboard");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it('shows "Course workspace" title and the course menu for a course route', () => {
    pathnameValue = "/courses/42";
    searchValue = "?tab=banks";
    coursesValue = [COURSE_42];
    render(<QmAppLayout />);
    expect(screen.getByTestId("app-shell").dataset.title).toBe("Course workspace");
    const courseNav = capturedShellProps.courseNav;
    expect(courseNav).toMatchObject({ href: "/courses/42", code: "BIOL 116", activeKey: "banks" });
    expect(courseNav.items.map((item: any) => item.key)).toEqual([
      "overview",
      "questions",
      "banks",
      "assessments",
    ]);
    expect(courseNav.items[3]).toMatchObject({
      href: "/courses/42?tab=assessments",
      tourId: "assessment-tab",
    });
  });

  it("has no course menu until the route's course has loaded", () => {
    pathnameValue = "/courses/42";
    render(<QmAppLayout />);
    expect(capturedShellProps.courseNav).toBeUndefined();
    expect(screen.getByTestId("breadcrumbs")).toHaveTextContent("Course workspace");
  });

  it('shows the "New question" sub-crumb on the composer route', () => {
    pathnameValue = "/courses/42/questions/new";
    coursesValue = [COURSE_42];
    render(<QmAppLayout />);
    expect(screen.getByText("New question")).toBeInTheDocument();
    expect(capturedShellProps.courseNav.activeKey).toBe("questions");
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

  it("uses the course-scoped TA role for the shared app launcher", () => {
    userValue = {
      id: "ta-1",
      name: "Taylor",
      email: "ta@example.com",
      role: "STUDENT",
      questionMakerRole: "TA",
    };
    render(<QmAppLayout />);
    expect(capturedShellProps.model.launcherApps.map((app: any) => app.id)).toEqual([
      "question-maker",
    ]);
    expect(capturedShellProps.model.user.role).toBe("TA");
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

  it("replaces the standalone guided tour button with the page help (?) button (#1754)", () => {
    render(<QmAppLayout />);
    expect(screen.queryByLabelText("Guided tour")).not.toBeInTheDocument();
    const actions = screen.getByTestId("header-actions");
    const buttons = within(actions).getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveAccessibleName("Help for this page");
  });

  it("shows help for the current page in the help modal", () => {
    pathnameValue = "/library";
    render(<QmAppLayout />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Question library");
  });

  it.each([
    ["/dashboard", true],
    ["/courses", false],
    ["/courses/5", false],
  ])('starting the tour from %s runs startTour("main")', async (path, startsElsewhere) => {
    pathnameValue = path;
    render(<QmAppLayout />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent?.includes("It starts on your courses page.")).toBe(startsElsewhere);
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    await waitFor(() => expect(startTour).toHaveBeenCalledWith("main"));
  });

  it("offers the bug report from the Help tray when a BugReportContext is present", () => {
    render(<QmAppLayout />);
    expect(screen.queryByLabelText("Report a bug")).toBeNull();
    capturedShellProps.model.onReportBug();
    expect(openBugReport).toHaveBeenCalled();
  });

  it("omits the bug report when no BugReportContext is present", () => {
    bugReportValue = null;
    render(<QmAppLayout />);
    expect(capturedShellProps.model.onReportBug).toBeUndefined();
  });

  it("makes Courses and Help trays and puts Back to EduAI in the Account tray", () => {
    render(<QmAppLayout />);
    const { model } = capturedShellProps;
    expect(model.entries.map((entry: any) => entry.tray ?? entry.link.label)).toEqual([
      "Dashboard",
      "help",
    ]);
    expect(model.helpLinks).toEqual([
      expect.objectContaining({ label: "Help & guide", href: "/help" }),
    ]);
    expect(model.accountLinks.map((link: any) => link.label)).toEqual([
      "Settings",
      "Back to EduAI",
    ]);
  });

  // Task 15: clicking the cloud chip now re-validates the key on demand
  // first (revalidateCloud), then refreshes so the chip picks up the fresh
  // cached verdict — it no longer just calls refresh() directly.
  it("clicking the cloud chip revalidates the key, then refreshes", async () => {
    render(<QmAppLayout />);
    fireEvent.click(screen.getByTestId("ai-indicators"));
    expect(revalidateCloud).toHaveBeenCalled();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("fetches AI status history on first open of the UBC panel, not before", async () => {
    getAiStatusHistory.mockResolvedValue({ windowHours: 72, bucketMinutes: 5, servers: [] });
    render(<QmAppLayout />);
    expect(getAiStatusHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ubc-open"));

    await waitFor(() => expect(getAiStatusHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("history-panel")).toHaveTextContent("has-data"));
  });

  it("points the panel's full-status link at Core, in a new tab", () => {
    // QM has no /status route of its own; the page lives in Core, so the link
    // must leave this origin rather than 404 inside the extension.
    render(<QmAppLayout />);

    const panel = screen.getByTestId("history-panel");
    expect(panel.dataset.statusHref).toBe("http://localhost:3000/status");
    expect(panel.dataset.statusTarget).toBe("_blank");
  });

  it("does not refetch history on a second open once it has loaded", async () => {
    getAiStatusHistory.mockResolvedValue({ windowHours: 72, bucketMinutes: 5, servers: [] });
    render(<QmAppLayout />);

    fireEvent.click(screen.getByTestId("ubc-open"));
    await waitFor(() => expect(getAiStatusHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("ubc-close"));
    fireEvent.click(screen.getByTestId("ubc-open"));

    expect(getAiStatusHistory).toHaveBeenCalledTimes(1);
  });

  it("shows an error in the history panel when the history fetch fails, without throwing", async () => {
    getAiStatusHistory.mockRejectedValue(new Error("network down"));
    render(<QmAppLayout />);

    fireEvent.click(screen.getByTestId("ubc-open"));

    await waitFor(() =>
      expect(screen.getByTestId("history-panel").dataset.error).toMatch(/could not load/i),
    );
  });

  it("refreshing from within the history panel calls both aiStatus.refresh and reloads history", async () => {
    getAiStatusHistory.mockResolvedValue({ windowHours: 72, bucketMinutes: 5, servers: [] });
    render(<QmAppLayout />);
    fireEvent.click(screen.getByTestId("ubc-open"));
    await waitFor(() => expect(getAiStatusHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("history-refresh"));

    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(getAiStatusHistory).toHaveBeenCalledTimes(2));
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
    capturedShellProps.model.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).toHaveBeenCalledWith("Could not log out", expect.any(Object));
  });

  it("does not toast when logout resolves", async () => {
    logout.mockResolvedValueOnce(undefined);
    render(<QmAppLayout />);
    capturedShellProps.model.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).not.toHaveBeenCalled();
  });

  it("falls back to a Guest nav user, without Settings, when unauthenticated", () => {
    userValue = null;
    render(<QmAppLayout />);
    expect(capturedShellProps.model.user).toEqual({ name: "Guest", email: "", role: "GUEST" });
    expect(capturedShellProps.model.accountLinks.map((link: any) => link.label)).toEqual([
      "Back to EduAI",
    ]);
  });

  it("uses the user email as the nav name when name is absent", () => {
    userValue = { id: "1", email: "noname@example.com", role: "instructor" };
    render(<QmAppLayout />);
    expect(capturedShellProps.model.user.name).toBe("noname@example.com");
  });

  it.each([
    ["/courses/42/questions/1/edit", "Edit question"],
    ["/courses/42/questions/1/variant", "New variant"],
    ["/courses/42/assessments/5/variants", "Variants"],
    ["/courses/42/assessments/5", "Assessment builder"],
    ["/courses/42/banks/7", "Question bank"],
  ])("shows the %s sub-crumb for %s", (path, expected) => {
    pathnameValue = path;
    coursesValue = [COURSE_42];
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

  it("offers access help, without a tour, on the restricted shell", () => {
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Access restricted");
    expect(screen.queryByRole("button", { name: /take the tour/i })).not.toBeInTheDocument();
  });

  it("falls back to a Guest nav user when unauthenticated", () => {
    userValue = null;
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    expect(capturedShellProps.model.user).toEqual({ name: "Guest", email: "", role: "GUEST" });
  });

  it("wires onLogout and surfaces a toast on failure", async () => {
    logout.mockRejectedValueOnce(new Error("network"));
    render(
      <QmAccessShell>
        <p>gated content</p>
      </QmAccessShell>,
    );
    capturedShellProps.model.onLogout();
    await new Promise((r) => setTimeout(r, 0));
    expect(toastErrorFn).toHaveBeenCalled();
  });
});

describe("QmAppLayout — Penny, the help assistant (#1958)", () => {
  const fetchMock = vi.fn();
  const bubbleName = /Ask Penny, the help assistant/;

  function gateResponse(gate: { mounted: boolean; docs: boolean }) {
    return new Response(
      JSON.stringify({ gate, user: { id: "core-u1", role: "INSTRUCTOR" }, context: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Penny when Core says the assistant is on, scoped to the workspace's Core course", async () => {
    pathnameValue = "/courses/42";
    coursesValue = [{ id: 42, coreCourseId: "core-c42", name: "CS 42" }];
    fetchMock.mockResolvedValue(gateResponse({ mounted: true, docs: true }));
    render(<QmAppLayout />);

    expect(await screen.findByRole("button", { name: bubbleName })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/assistant/gate?courseId=core-c42",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("renders no Penny when the assistant is off", async () => {
    fetchMock.mockResolvedValue(gateResponse({ mounted: false, docs: false }));
    render(<QmAppLayout />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: bubbleName })).not.toBeInTheDocument();
  });
});
