/**
 * Unit tests for Core's header bug-report trigger + modal (#1752).
 *
 * Covers: the shared trigger, the "Include diagnostics" toggle (present and off
 * by default), diagnostics reaching the submit hook only after opt-in, the
 * submit hook's readable error surfacing in the dialog, the screenshot being
 * dropped when the dialog closes, and no toggle outside the capture provider.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({
  captureScreenshot: vi.fn(),
  getCapturedData: vi.fn(),
  clearScreenshot: vi.fn(),
}));
const submitBugReport = vi.hoisted(() => vi.fn());

vi.mock("@eduai/ui/bug-report-capture", () => ({
  useBugReportCapture: () => capture,
}));
vi.mock("~/hooks/api/use-submit-bug-report", () => ({
  useSubmitBugReport: () => ({ submitBugReport, isSubmitting: false, error: null }),
}));

import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog";
import { BugReportCaptureProvider } from "~/contexts/bug-report-capture";

function renderDialog() {
  return render(
    <BugReportCaptureProvider>
      <BugReportSubmitDialog />
    </BugReportCaptureProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capture.captureScreenshot.mockResolvedValue("data:image/jpeg;base64,abc");
  capture.getCapturedData.mockReturnValue({
    consoleLogs: "[]",
    networkLogs: "[]",
    screenshot: "data:image/jpeg;base64,abc",
  });
  submitBugReport.mockResolvedValue({ ok: true });
});

async function openAndFill() {
  renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
  fireEvent.change(await screen.findByTestId("bug-description"), {
    target: { value: "Steps to reproduce it" },
  });
  fireEvent.click(screen.getByTestId("bug-type"));
  fireEvent.click(await screen.findByText("Other"));
}

describe("BugReportSubmitDialog", () => {
  it("offers the Include diagnostics toggle, off by default", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    const toggle = await screen.findByRole("switch", { name: /include diagnostics/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(capture.captureScreenshot).not.toHaveBeenCalled();
  });

  it("submits without diagnostics when the reporter did not opt in", async () => {
    await openAndFill();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(submitBugReport).toHaveBeenCalled());
    const payload = submitBugReport.mock.calls[0][0];
    expect(payload).toEqual({
      description: "Steps to reproduce it",
      bugType: "OTHER",
      isAnonymous: false,
    });
  });

  it("forwards diagnostics after the reporter opts in", async () => {
    await openAndFill();
    fireEvent.click(screen.getByRole("switch", { name: /include diagnostics/i }));
    expect(capture.captureScreenshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(submitBugReport).toHaveBeenCalled());
    expect(submitBugReport.mock.calls[0][0]).toMatchObject({
      consoleLogs: "[]",
      networkLogs: "[]",
      screenshot: "data:image/jpeg;base64,abc",
      pageUrl: window.location.href,
      userAgent: navigator.userAgent,
    });
  });

  it("shows the submit hook's readable reason when the submit fails", async () => {
    const reason = "Some details were invalid. Please check your description and bug type.";
    submitBugReport.mockResolvedValue({ ok: false, error: reason });
    await openAndFill();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    expect(await screen.findByText(reason)).toBeInTheDocument();
  });

  it("offers no diagnostics toggle outside the capture provider", async () => {
    render(<BugReportSubmitDialog />);
    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    await screen.findByTestId("bug-description");
    expect(screen.queryByRole("switch", { name: /include diagnostics/i })).not.toBeInTheDocument();
  });

  it("drops the captured screenshot when the dialog closes", async () => {
    await openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(capture.clearScreenshot).toHaveBeenCalled();
  });
});
