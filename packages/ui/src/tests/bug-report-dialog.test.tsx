import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BugReportDialog } from "../bug-report-dialog";

describe("BugReportDialog", () => {
  it("does not render dialog content when closed", () => {
    render(<BugReportDialog open={false} onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Report a bug")).not.toBeInTheDocument();
  });

  it("renders the bug type select and description field when open", () => {
    render(<BugReportDialog open={true} onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText("Report a bug")).toBeInTheDocument();
    expect(screen.getByTestId("bug-type")).toBeInTheDocument();
    expect(screen.getByTestId("bug-description")).toBeInTheDocument();
  });

  it("blocks submit and shows validation errors when required fields are missing", async () => {
    const onSubmit = vi.fn();
    render(<BugReportDialog open={true} onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => {
      expect(screen.getByText("Please select a bug type")).toBeInTheDocument();
      expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the description, bug type, and anonymity flag", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(<BugReportDialog open={true} onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId("bug-description"), {
      target: { value: "Steps to reproduce the issue in detail." },
    });
    fireEvent.click(screen.getByTestId("bug-type"));
    fireEvent.click(await screen.findByText("Performance issue"));

    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Steps to reproduce the issue in detail.",
          bugType: "PERFORMANCE",
          isAnonymous: false,
        }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("attaches captured diagnostics when getCapturedData is provided", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const getCapturedData = vi.fn().mockReturnValue({
      consoleLogs: "[]",
      networkLogs: "[]",
      screenshot: null,
    });
    render(
      <BugReportDialog
        open={true}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        getCapturedData={getCapturedData}
      />,
    );

    fireEvent.change(screen.getByTestId("bug-description"), {
      target: { value: "Steps to reproduce the issue in detail." },
    });
    fireEvent.click(screen.getByTestId("bug-type"));
    fireEvent.click(await screen.findByText("Other"));

    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => {
      expect(getCapturedData).toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ consoleLogs: "[]", networkLogs: "[]", screenshot: null }),
      );
    });
  });
});
