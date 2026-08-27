/**
 * Coverage for the shared authenticated-shell layout route (_app.tsx):
 * the pre-auth bare-Outlet branch, the bug-report open/submit flow, and
 * logout navigation. `AppShell` and friends are mocked to a thin pass-through
 * so the route's own handlers (not `@eduai/ui` internals) are what's tested.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router";

const mockNavigate = vi.fn();
vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockUser: { id: string; name: string; role: string; email?: string } | null = null;
const mockLogout = vi.fn().mockResolvedValue(undefined);
vi.mock("~/hooks/useLocalUser", () => ({
  useLocalUser: () => ({ user: mockUser, logout: mockLogout }),
}));

const mockCaptureScreenshot = vi.fn().mockResolvedValue(undefined);
const mockGetCapturedData = vi.fn().mockReturnValue({});
vi.mock("~/components/bug-report/useBugReport", () => ({
  useBugReport: () => ({
    captureScreenshot: mockCaptureScreenshot,
    getCapturedData: mockGetCapturedData,
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
vi.mock("~/components/TourButton", () => ({ default: () => <div data-testid="tour-button" /> }));

vi.mock("@eduai/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@eduai/ui")>();
  return {
    ...actual,
    useAiServiceStatus: (...args: unknown[]) => mockAiStatus(...args),
    AIServiceIndicators: () => <div data-testid="ai-indicators" />,
    ThemeToggle: () => <div data-testid="theme-toggle" />,
    CommandSearchButton: () => <div data-testid="command-search" />,
    BugReportDialog: ({
      open,
      onSubmit,
    }: {
      open: boolean;
      onSubmit: (data: Record<string, unknown>) => void;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <div data-testid="bug-report-dialog">
          <button
            type="button"
            onClick={() =>
              onSubmit({
                description: "Something broke",
                bugType: "BUG",
                isAnonymous: false,
              })
            }
          >
            Submit bug report
          </button>
        </div>
      ) : null,
    AppShell: ({
      sidebar,
      headerActions,
      commandPalette,
      children,
    }: {
      sidebar: { navUser: { onLogout: () => void } };
      headerActions: React.ReactNode;
      commandPalette: React.ReactNode;
      children: React.ReactNode;
    }) => (
      <div>
        <button type="button" onClick={() => void sidebar.navUser.onLogout()}>
          Log out
        </button>
        <div>{headerActions}</div>
        <div>{commandPalette}</div>
        <div>{children}</div>
      </div>
    ),
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
          bugType: "BUG",
          isAnonymous: false,
          context: { activityId: null },
        }),
      ),
    );
  });

  it("logging out calls logout then navigates home", async () => {
    wrap();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    });

    expect(mockLogout).toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
  });
});
