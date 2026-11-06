/**
 * `BugReportsAdminView` with `layout="panel"` (Core): the compact columns, a
 * row opening the full report in a side panel (click or Enter), the row's
 * status control and the "…" menu's quick actions not opening it, the panel's
 * details and inline screenshot, and the open report kept by the owner
 * (`openReportId`, for `?report=`).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BugReportsAdminView } from "../bug-reports/bug-reports-admin-view";
import type { AdminBugReportRow } from "../bug-reports/types";

const SCREENSHOT = "data:image/png;base64,iVBORw0KGgo=";

function row(over: Partial<AdminBugReportRow> = {}): AdminBugReportRow {
  return {
    id: "r1",
    description: "Chat does not persist chatId",
    bugType: "FEATURE_NOT_WORKING",
    status: "unhandled",
    isAnonymous: false,
    userId: "u1",
    reporterName: "Alex Patel",
    reporterEmail: "alex@eduai.test",
    reporterRole: "INSTRUCTOR",
    source: "core",
    pageUrl: "https://eduai.test/courses/c1?tab=materials",
    hasScreenshot: true,
    createdAt: "2026-09-16T10:00:00.000Z",
    ...over,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof BugReportsAdminView>> = {}) {
  const onLoadDetail = vi.fn().mockResolvedValue({ screenshot: SCREENSHOT });
  const onUpdateStatus = vi.fn().mockResolvedValue(undefined);
  render(
    <BugReportsAdminView
      reports={[row()]}
      onUpdateStatus={onUpdateStatus}
      onLoadDetail={onLoadDetail}
      layout="panel"
      {...props}
    />,
  );
  return { onLoadDetail, onUpdateStatus };
}

const reportRow = () => screen.getByRole("row", { name: /Open report: Chat does not persist/ });

describe("BugReportsAdminView — panel layout", () => {
  it("shows only Status, Type, Description, Reporter (name only) and a short date", () => {
    renderPanel();
    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent?.trim());
    expect(headers).toEqual(["Status↕", "Type↕", "Description↕", "Reporter↕", "Date▼", "Actions"]);
    expect(within(reportRow()).getByText("Alex Patel")).toBeInTheDocument();
    expect(within(reportRow()).queryByText(/alex@eduai\.test/)).not.toBeInTheDocument();
    expect(within(reportRow()).getByText("Sep 16")).toBeInTheDocument();
  });

  it("opens the full report in a side panel when the row is clicked", async () => {
    const { onLoadDetail } = renderPanel();
    fireEvent.click(reportRow());

    const panel = await screen.findByRole("dialog", { name: "Report Description" });
    expect(within(panel).getByText("Chat does not persist chatId")).toBeInTheDocument();
    expect(within(panel).getByText("alex@eduai.test")).toBeInTheDocument();
    expect(within(panel).getByText("core")).toBeInTheDocument();
    expect(
      within(panel).getByText("https://eduai.test/courses/c1?tab=materials"),
    ).toBeInTheDocument();
    for (const name of ["Copy", "Console", "Network", "Screenshot"]) {
      expect(within(panel).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(panel).getByLabelText(/Update status for report r1/)).toBeInTheDocument();

    expect(onLoadDetail).toHaveBeenCalledWith("r1");
    expect(await within(panel).findByAltText("Bug report screenshot")).toHaveAttribute(
      "src",
      SCREENSHOT,
    );
  });

  it("opens the panel with Enter on a focused row and closes it on Escape", async () => {
    renderPanel();
    fireEvent.keyDown(reportRow(), { key: "Enter" });
    const panel = await screen.findByRole("dialog", { name: "Report Description" });

    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the '…' menu's quick actions from opening the panel", async () => {
    const { onUpdateStatus } = renderPanel();
    const trigger = screen.getByRole("button", { name: "Actions for report r1" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });

    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Resolved" }));

    expect(onUpdateStatus).toHaveBeenCalledWith("r1", "resolved");
    expect(screen.queryByRole("dialog", { name: "Report Description" })).not.toBeInTheDocument();
  });

  it("changes status from the row's own control without opening the panel", async () => {
    const { onUpdateStatus } = renderPanel();
    const trigger = within(reportRow()).getByLabelText(/Update status for report r1/);
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });

    fireEvent.click(await screen.findByRole("option", { name: "In progress" }));

    expect(onUpdateStatus).toHaveBeenCalledWith("r1", "in progress");
    expect(screen.queryByRole("dialog", { name: "Report Description" })).not.toBeInTheDocument();
    expect(await within(trigger).findByText("In progress")).toBeInTheDocument();
  });

  it("lets the owner hold the open report, and reports open and close to it", async () => {
    const onOpenReportChange = vi.fn();
    renderPanel({ openReportId: "r1", onOpenReportChange });

    const panel = await screen.findByRole("dialog", { name: "Report Description" });
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(onOpenReportChange).toHaveBeenCalledWith(null);
  });

  it("asks the owner to open a clicked report", () => {
    const onOpenReportChange = vi.fn();
    renderPanel({ openReportId: null, onOpenReportChange });
    fireEvent.click(reportRow());
    expect(onOpenReportChange).toHaveBeenCalledWith("r1");
  });
});
