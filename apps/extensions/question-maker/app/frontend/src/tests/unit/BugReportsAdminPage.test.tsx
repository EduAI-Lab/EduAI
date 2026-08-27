/**
 * Unit tests for BugReportsAdminPage (#1544): RBAC gate, data loading, and
 * wiring into the shared BugReportsAdminView. The shared view and rbac helper
 * are mocked so we exercise only this page's own logic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { navigateMock, useAuthMock, bugReportApi, canTriageBugReportsMock, toastFn } = vi.hoisted(
  () => {
    const toast = vi.fn() as any;
    toast.error = vi.fn();
    return {
      navigateMock: vi.fn(),
      useAuthMock: vi.fn(),
      bugReportApi: { list: vi.fn(), updateStatus: vi.fn(), get: vi.fn() },
      canTriageBugReportsMock: vi.fn(),
      toastFn: toast,
    };
  },
);

vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));
vi.mock("sonner", () => ({ toast: toastFn }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/services/bugReportApi", () => ({ bugReportApi }));
vi.mock("@/lib/rbac", () => ({ canTriageBugReports: (u: any) => canTriageBugReportsMock(u) }));
vi.mock("@eduai/ui", () => ({
  PageHeading: ({ heading, subheading }: any) => (
    <div>
      <h1>{heading}</h1>
      <p>{subheading}</p>
    </div>
  ),
  BugReportsAdminView: ({ reports, isLoading, title }: any) => (
    <div>
      <span>{title}</span>
      <span>{isLoading ? "loading" : `count:${reports.length}`}</span>
    </div>
  ),
}));

import { BugReportsAdminPage } from "@/pages/BugReportsAdminPage";

afterEach(cleanup);

describe("BugReportsAdminPage", () => {
  it("renders nothing while auth is loading", () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: true });
    canTriageBugReportsMock.mockReturnValue(false);
    const { container } = render(<BugReportsAdminPage />);
    expect(container).toBeEmptyDOMElement();
  });

  it("redirects unauthorized users to /home and renders nothing", async () => {
    useAuthMock.mockReturnValue({
      user: { id: 1, role: "STUDENT", authorizedUnits: [] },
      isLoading: false,
    });
    canTriageBugReportsMock.mockReturnValue(false);
    const { container } = render(<BugReportsAdminPage />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/home", { replace: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it("loads reports and renders the admin view for authorized users", async () => {
    useAuthMock.mockReturnValue({
      user: { id: 1, role: "ADMIN", authorizedUnits: [] },
      isLoading: false,
    });
    canTriageBugReportsMock.mockReturnValue(true);
    bugReportApi.list.mockResolvedValue([{ id: "a" }, { id: "b" }]);

    render(<BugReportsAdminPage />);

    expect(screen.getByText("Bug reports")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("count:2")).toBeInTheDocument());
    expect(bugReportApi.list).toHaveBeenCalledWith({ source: "QUESTION_MAKER" });
  });

  it("shows an error toast and navigates home when loading fails", async () => {
    useAuthMock.mockReturnValue({
      user: { id: 1, role: "ADMIN", authorizedUnits: [] },
      isLoading: false,
    });
    canTriageBugReportsMock.mockReturnValue(true);
    bugReportApi.list.mockRejectedValue(new Error("boom"));

    render(<BugReportsAdminPage />);

    await waitFor(() => expect(toastFn.error).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith("/home");
  });
});
