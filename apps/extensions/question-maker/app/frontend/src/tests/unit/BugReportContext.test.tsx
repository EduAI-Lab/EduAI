import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BugReportSubmitData } from "@eduai/ui";

const captureScreenshot = vi.hoisted(() => vi.fn());
const getCapturedData = vi.hoisted(() => vi.fn());
const clearScreenshot = vi.hoisted(() => vi.fn());
const submit = vi.hoisted(() => vi.fn());

vi.mock("@eduai/ui/bug-report-capture", () => ({
  useBugReportCapture: () => ({ captureScreenshot, getCapturedData, clearScreenshot }),
}));
vi.mock("../../services/bugReportApi", () => ({ bugReportApi: { submit } }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

const BASE_REPORT = { description: "A valid bug report", bugType: "OTHER", isAnonymous: false };
const OPTED_IN_REPORT = {
  ...BASE_REPORT,
  consoleLogs: "[]",
  networkLogs: "[]",
  screenshot: "data:image/jpeg;base64/CLEAN_PAGE",
  pageUrl: "http://localhost/courses/1",
  userAgent: "test-agent",
};

// The real dialog fills the diagnostics fields only when "Include diagnostics"
// is on; the two submit buttons stand in for the toggle being off and on.
vi.mock("@eduai/ui", () => ({
  BugReportDialog: ({
    open,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: BugReportSubmitData) => Promise<void>;
  }) =>
    open ? (
      <>
        <button onClick={() => void onSubmit(BASE_REPORT as BugReportSubmitData)}>
          submit report
        </button>
        <button onClick={() => void onSubmit(OPTED_IN_REPORT as BugReportSubmitData)}>
          submit report with diagnostics
        </button>
        <button onClick={() => onOpenChange(false)}>close report</button>
      </>
    ) : null,
}));

import { BugReportProvider, useBugReport } from "../../contexts/BugReportContext";

function Trigger() {
  const bugReport = useBugReport();
  return <button onClick={bugReport?.openBugReport}>open report</button>;
}

function renderProvider(children: ReactNode = <Trigger />) {
  return render(<BugReportProvider>{children}</BugReportProvider>);
}

describe("BugReportProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureScreenshot.mockResolvedValue(null);
    getCapturedData.mockReturnValue({
      consoleLogs: "[]",
      networkLogs: "[]",
      screenshot: "data:image/jpeg;base64/LEAKED",
    });
    submit.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("does not take a screenshot just because the modal opened", () => {
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "open report" }));

    expect(screen.getByRole("button", { name: "submit report" })).toBeInTheDocument();
    expect(captureScreenshot).not.toHaveBeenCalled();
  });

  it("does not attach diagnostics when the reporter left the toggle off", async () => {
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "open report" }));
    fireEvent.click(screen.getByRole("button", { name: "submit report" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    const payload = submit.mock.calls[0][0];
    for (const key of ["consoleLogs", "networkLogs", "screenshot", "pageUrl", "userAgent"]) {
      expect(payload[key] ?? null).toBeNull();
    }
    expect(getCapturedData).not.toHaveBeenCalled();
  });

  it("forwards the diagnostics the dialog attached after opt-in", async () => {
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "open report" }));
    fireEvent.click(screen.getByRole("button", { name: "submit report with diagnostics" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    expect(submit).toHaveBeenCalledWith(OPTED_IN_REPORT);
  });

  it("drops the captured screenshot when the dialog closes", () => {
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "open report" }));
    fireEvent.click(screen.getByRole("button", { name: "close report" }));

    expect(clearScreenshot).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "submit report" })).not.toBeInTheDocument();
  });
});
