/**
 * Unit tests for Core's root-level bug-report capture provider (#1752).
 *
 * Covers: the console buffer surviving a remount of the header dialog, which is
 * what a client-side navigation does, since every route renders its own
 * `CoreAppShell`. Uses the real capture hook; only html2canvas and the submit
 * request are stubbed.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const submitBugReport = vi.hoisted(() => vi.fn());

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => ({ toDataURL: () => "data:image/jpeg;base64,xyz" })),
}));
vi.mock("~/hooks/api/use-submit-bug-report", () => ({
  useSubmitBugReport: () => ({ submitBugReport, isSubmitting: false, error: null }),
}));

import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog";
import { BugReportCaptureProvider } from "~/contexts/bug-report-capture";

beforeEach(() => {
  vi.clearAllMocks();
  submitBugReport.mockResolvedValue({ ok: true });
});

describe("BugReportCaptureProvider", () => {
  it("keeps logs from the previous page when the header dialog remounts", async () => {
    const page = (key: string) => (
      <BugReportCaptureProvider>
        <BugReportSubmitDialog key={key} />
      </BugReportCaptureProvider>
    );
    const { rerender, unmount } = render(page("previous"));
    console.warn("request failed on the previous page");
    rerender(page("current"));

    fireEvent.click(screen.getByRole("button", { name: "Report a bug" }));
    fireEvent.change(await screen.findByTestId("bug-description"), {
      target: { value: "Steps to reproduce it" },
    });
    fireEvent.click(screen.getByTestId("bug-type"));
    fireEvent.click(await screen.findByText("Other"));
    fireEvent.click(screen.getByRole("switch", { name: /include diagnostics/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(submitBugReport).toHaveBeenCalled());
    const payload = submitBugReport.mock.calls[0][0];
    expect(payload.consoleLogs).toContain("request failed on the previous page");
    expect(payload.screenshot).toBe("data:image/jpeg;base64,xyz");
    unmount();
  });
});
