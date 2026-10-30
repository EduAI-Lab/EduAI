/**
 * Coverage for the shared authenticated-shell layout route (_app.tsx):
 * the pre-auth bare-Outlet branch, the bug-report open/submit flow, and
 * logout navigation, and the nav model handed to the shell. `NavShell` and
 * friends are mocked to a thin pass-through so the route's own handlers (not
 * `@eduai/ui` internals) are what's tested.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { BugReportSubmitData, NavShellModel } from "@eduai/ui";

const mockNavigate = vi.fn();
vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return { ...actual, useMatches: () => [], useNavigate: () => mockNavigate };
});

let mockUser: { id: string; name: string; role: string; email?: string } | null = null;
const mockLogout = vi.fn().mockResolvedValue(undefined);
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser, logout: mockLogout }),
}));

const mockCaptureScreenshot = vi.fn().mockResolvedValue(undefined);
const mockGetCapturedData = vi.fn().mockReturnValue({});
const mockClearScreenshot = vi.fn();
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({
    captureScreenshot: mockCaptureScreenshot,
    getCapturedData: mockGetCapturedData,
    clearScreenshot: mockClearScreenshot,
    context: { activityId: null },
  }),
}));

const mockSubmitBugReport = vi.fn().mockResolvedValue(undefined);
const mockAiStatus = vi.fn().mockReturnValue({ cloud: "ok", ubc: "ok", refresh: vi.fn() });
vi.mock("~/lib/api", () => ({
  default: {
    aiStatus: vi.fn().mockResolvedValue({}),
    submitBugReport: (...args: unknown[]) => mockSubmitBugReport(...args),
  },
}));

vi.mock("~/lib/rbac/nav", () => ({
  getNavForUser: () => [{ key: "dashboard", title: "Dashboard", href: "/dashboard" }],
}));
vi.mock("~/lib/role-routing", () => ({ routeForRole: () => "/dashboard" }));
vi.mock("~/lib/apps", () => ({
  CURRENT_APP_ID: "ai-tutor",
  getLauncherApps: () => [],
}));
vi.mock("~/components/command/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
  AITUTOR_COMMAND_EVENT: "aitutor:command",
}));
vi.mock("~/components/layout/ShellBreadcrumbs", () => ({
  ShellBreadcrumbs: () => <div data-testid="breadcrumbs" />,
}));
const mockStartTour = vi.fn();
let capturedModel: NavShellModel | null = null;
let capturedHeadingInPage: boolean | undefined;

vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  return {
    ...actual,
    useTour: () => ({ ...actual.useTour(), startTour: mockStartTour }),
    useAiServiceStatus: (...args: unknown[]) => mockAiStatus(...args),
    // Renders `ubcHistory` so the REAL AIServiceHistoryPanel (spread in from
    // `actual` above) mounts — the link under test is its own output, not a stub's.
    AIServiceIndicators: (props: { ubcHistory?: React.ReactNode }) => (
      <div data-testid="ai-indicators">{props.ubcHistory}</div>
    ),
    ThemeToggle: () => <div data-testid="theme-toggle" />,
    CommandSearchButton: () => <div data-testid="command-search" />,
    BugReportDialog: ({
      open,
      onSubmit,
      onOpenChange,
    }: {
      open: boolean;
      onSubmit: (data: BugReportSubmitData) => void;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <div data-testid="bug-report-dialog">
          <button
            type="button"
            onClick={() =>
              onSubmit({
                description: "Something broke",
                bugType: "FEATURE_NOT_WORKING",
                isAnonymous: false,
              })
            }
          >
            Submit bug report
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            Close bug report
          </button>
        </div>
      ) : null,
    // Stands in for the rail's trays: the Account tray's links and Log out,
    // and the Help tray's Report a bug, all driven by the model under test.
    NavShell: ({
      model,
      headingInPage,
      headerActions,
      overlays,
      children,
    }: {
      model: NavShellModel;
      headingInPage?: boolean;
      headerActions: React.ReactNode;
      overlays: React.ReactNode;
      children: React.ReactNode;
    }) => {
      capturedModel = model;
      capturedHeadingInPage = headingInPage;
      return (
        <div>
          <button type="button" onClick={model.onLogout}>
            Log out
          </button>
          {model.onReportBug && (
            <button type="button" onClick={model.onReportBug}>
              Report a bug
            </button>
          )}
          {model.accountLinks.map((link) => (
            <a key={link.key} href={link.href}>
              {link.label}
            </a>
          ))}
          <div>{headerActions}</div>
          <div>{overlays}</div>
          <div>{children}</div>
        </div>
      );
    },
  };
});

import AppLayout from "~/routes/_app";

function wrap() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe("_app layout — pre-auth", () => {
  it("renders a bare outlet while there is no local user yet", () => {
    mockUser = null;
    wrap();

    // None of the authenticated shell chrome should be present.
    expect(screen.queryByText(/log out/i)).not.toBeInTheDocument();
  });
});

describe("_app layout — authenticated shell", () => {
  beforeEach(() => {
    mockUser = { id: "u1", name: "Ada", role: "INSTRUCTOR", email: "ada@example.com" };
    mockNavigate.mockClear();
    mockLogout.mockClear();
    mockCaptureScreenshot.mockClear();
    mockSubmitBugReport.mockClear();
    mockClearScreenshot.mockClear();
  });

  it("renders the page help (?) button with the dashboard's help, and no tour for an instructor", async () => {
    wrap();

    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Dashboard");
    expect(screen.queryByRole("button", { name: /take the tour/i })).not.toBeInTheDocument();
  });

  it("offers a student the learner tour from the help modal", async () => {
    mockUser = { id: "u2", name: "Sam", role: "STUDENT" };
    mockStartTour.mockClear();
    wrap();

    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    fireEvent.click(await screen.findByRole("button", { name: /take the tour/i }));

    await waitFor(() => expect(mockStartTour).toHaveBeenCalledWith("student-journey"));
  });

  it("opens the bug report dialog", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    });

    await waitFor(() => expect(screen.getByTestId("bug-report-dialog")).toBeInTheDocument());
  });

  it("submits the bug report with context merged in", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /submit bug report/i }));
    });

    await waitFor(() =>
      expect(mockSubmitBugReport).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Something broke",
          bugType: "FEATURE_NOT_WORKING",
          isAnonymous: false,
          context: { activityId: null },
        }),
      ),
    );
  });

  it("sends no diagnostics when the reporter did not opt in", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /submit bug report/i }));
    });

    await waitFor(() => expect(mockSubmitBugReport).toHaveBeenCalled());
    const payload = mockSubmitBugReport.mock.calls[0][0];
    for (const key of ["consoleLogs", "networkLogs", "screenshot", "pageUrl", "userAgent"]) {
      expect(payload[key] ?? null).toBeNull();
    }
  });

  it("drops the captured screenshot when the dialog closes", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /close bug report/i }));
    });

    expect(mockClearScreenshot).toHaveBeenCalled();
    expect(screen.queryByTestId("bug-report-dialog")).not.toBeInTheDocument();
  });

  it("logging out calls logout then navigates home", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    });

    expect(mockLogout).toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });

  it("tells the shell its pages draw their own h1, so the header adds no second one", () => {
    wrap();
    expect(capturedHeadingInPage).toBe(true);
  });

  it("makes Courses and Help trays, keeping other entries as links", () => {
    wrap();

    const entries = capturedModel?.entries.map((entry) =>
      entry.kind === "link" ? entry.link.label : entry.kind === "tray" ? `tray:${entry.tray}` : "",
    );
    expect(entries).toEqual(["Dashboard", "tray:help"]);
    expect(capturedModel?.helpLinks.map((link) => link.href)).toEqual(["/help"]);
  });

  it("offers a Back to EduAI account link to Core's dashboard, like Question Maker", () => {
    mockUser = { id: "u1", name: "Ada", role: "STUDENT" };
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Back to EduAI" })).toHaveAttribute(
      "href",
      "http://localhost:3000/dashboard",
    );
  });

  it("sends the user to Core for the full status page, in a new tab", () => {
    mockUser = { id: "u1", name: "Ada", role: "STUDENT" };
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /view full status/i });
    // AI Tutor has no /status route of its own; the page lives in Core.
    expect(link).toHaveAttribute("href", "http://localhost:3000/status");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("_app layout — Penny, the help assistant (#1958)", () => {
  const fetchMock = vi.fn();
  const bubbleName = /Ask Penny, the help assistant/;

  function gateResponse(gate: { mounted: boolean; docs: boolean }) {
    return new Response(
      JSON.stringify({ gate, user: { id: "core-u1", role: "INSTRUCTOR" }, context: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    mockUser = { id: "u1", name: "Ada", role: "INSTRUCTOR", email: "ada@example.com" };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Penny when Core says the assistant is on, asking Core about the page's course", async () => {
    fetchMock.mockResolvedValue(gateResponse({ mounted: true, docs: true }));
    renderAt("/dashboard?coreCourseId=core-c1");

    expect(await screen.findByRole("button", { name: bubbleName })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/assistant/gate?courseId=core-c1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("renders no Penny when the assistant is off", async () => {
    fetchMock.mockResolvedValue(gateResponse({ mounted: false, docs: false }));
    renderAt("/dashboard");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: bubbleName })).not.toBeInTheDocument();
  });

  it("opens Penny from the header on a lesson, clear of the lesson's own chat", async () => {
    fetchMock.mockResolvedValue(gateResponse({ mounted: true, docs: true }));
    renderAt("/student/lesson/7");

    const button = await screen.findByRole("button", { name: bubbleName });
    expect(button).toHaveTextContent("Ask Penny");
  });
});
