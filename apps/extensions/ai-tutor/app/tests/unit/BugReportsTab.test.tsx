import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BugReportsTab from "~/components/admin/BugReportsTab";
import type { AdminBugReportRow } from "~/lib/types";

const { mockUpdateAdminBugReportStatus, mockGetAdminBugReport, mockClipboardWriteText } =
  vi.hoisted(() => ({
    mockUpdateAdminBugReportStatus: vi.fn(),
    mockGetAdminBugReport: vi.fn(),
    mockClipboardWriteText: vi.fn(),
  }));

vi.mock("~/lib/api", () => ({
  default: {
    updateAdminBugReportStatus: mockUpdateAdminBugReportStatus,
    getAdminBugReport: mockGetAdminBugReport,
  },
}));

const baseReport: AdminBugReportRow = {
  id: "bug-1",
  description: "Student cannot submit answer on activity page",
  bugType: "FEATURE_NOT_WORKING",
  status: "unhandled",
  consoleLogs: JSON.stringify([
    {
      level: "error",
      message: "Boom",
      timestamp: "2026-03-10T08:00:00.000Z",
      stack: "line1\nline2",
    },
  ]),
  networkLogs: JSON.stringify([
    {
      method: "POST",
      url: "http://localhost:4000/api/submit",
      status: 500,
      durationMs: 215,
      timestamp: "2026-03-10T08:00:02.000Z",
      requestHeaders: { "content-type": "application/json" },
      responseHeaders: { "x-request-id": "abc" },
      requestBody: { answer: 2 },
      responseBody: { error: "Internal error" },
    },
  ]),
  screenshot: "data:image/png;base64,ZmFrZQ==",
  hasConsoleLogs: true,
  hasNetworkLogs: true,
  hasScreenshot: true,
  pageUrl: "http://localhost:5173/student/list/42?step=1",
  userAgent: "Mozilla/5.0",
  isAnonymous: false,
  userId: "u1",
  reporterName: "Ada Lovelace",
  reporterEmail: "ada@example.com",
  reporterRole: "STUDENT",
  user: {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "STUDENT",
  },
  createdAt: "2026-03-10T08:01:00.000Z",
  updatedAt: "2026-03-10T08:01:00.000Z",
  courseOfferingId: 1,
  moduleId: 2,
  lessonId: 3,
  activityId: 4,
  courseTitle: "Math 101",
  moduleTitle: "Week 1",
  lessonTitle: "Linear Equations",
  activityTitle: "Solve for x",
};

const anonymousReport: AdminBugReportRow = {
  ...baseReport,
  id: "bug-2",
  description: "Anonymous report example",
  isAnonymous: true,
  reporterName: "Anonymous",
  reporterEmail: null,
  reporterRole: "INSTRUCTOR",
  user: {
    id: "u2",
    name: null,
    email: null,
    role: "INSTRUCTOR",
  },
};

const anonymousReportWithPopulatedIdentityFields: AdminBugReportRow = {
  ...baseReport,
  id: "bug-3",
  description: "Anonymous report with populated identity fields",
  isAnonymous: true,
  reporterName: "Grace Hopper",
  reporterEmail: "grace@example.com",
  reporterRole: "INSTRUCTOR",
  user: {
    id: "u3",
    name: "Grace Hopper",
    email: "grace@example.com",
    role: "INSTRUCTOR",
  },
};

/** Shows the current query string, so tests can read `?report=`. */
function LocationProbe() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function renderTab(reports: AdminBugReportRow[], path = "/admin?tab=bug-reports") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BugReportsTab initialReports={reports} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Clicks a report's row and returns its side panel. */
async function openReport(description: string) {
  fireEvent.click(screen.getByRole("row", { name: `Open report: ${description}` }));
  return screen.findByRole("dialog", { name: "Report Description" });
}

/** Closes a viewer dialog by its own X (the panel behind it has one too). */
function closeViewer(title: string) {
  fireEvent.click(
    within(screen.getByRole("dialog", { name: title })).getByRole("button", { name: "Close" }),
  );
}

describe("BugReportsTab", () => {
  beforeEach(() => {
    mockUpdateAdminBugReportStatus.mockReset();
    mockGetAdminBugReport.mockReset();
    mockClipboardWriteText.mockReset();
    mockGetAdminBugReport.mockImplementation(async (id: string) => {
      if (id === anonymousReport.id) return anonymousReport;
      if (id === anonymousReportWithPopulatedIdentityFields.id) {
        return anonymousReportWithPopulatedIdentityFields;
      }
      return baseReport;
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: mockClipboardWriteText,
      },
    });
  });

  it("renders compact rows, with context and page moved into the report's panel", async () => {
    renderTab([baseReport, anonymousReport]);

    expect(screen.getByText(baseReport.description)).toBeInTheDocument();
    expect(screen.getByText(anonymousReport.description)).toBeInTheDocument();
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.queryByText("/student/list/42?step=1")).not.toBeInTheDocument();

    const panel = await openReport(baseReport.description);
    expect(
      within(panel).getByText("Math 101 / Week 1 / Linear Equations / Solve for x"),
    ).toBeInTheDocument();
    expect(within(panel).getByText(baseReport.pageUrl as string)).toBeInTheDocument();
  });

  it("keeps the open report in ?report= and opens it from the URL", async () => {
    renderTab([baseReport]);
    await openReport(baseReport.description);
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      `?tab=bug-reports&report=${baseReport.id}`,
    );
  });

  it("opens the report named in the URL on load", async () => {
    renderTab([baseReport], `/admin?tab=bug-reports&report=${baseReport.id}`);
    const panel = await screen.findByRole("dialog", { name: "Report Description" });
    expect(within(panel).getByText(baseReport.description)).toBeInTheDocument();
  });

  it("updates status after a successful API response", async () => {
    mockUpdateAdminBugReportStatus.mockResolvedValue({
      ...baseReport,
      status: "resolved",
    });

    renderTab([baseReport]);

    // The row's own status control: no need to open the report.
    const trigger = screen.getByLabelText(`Update status for report ${baseReport.id}`);
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));

    await waitFor(() => {
      expect(mockUpdateAdminBugReportStatus).toHaveBeenCalledWith(baseReport.id, {
        status: "resolved",
      });
    });

    expect(trigger).toHaveTextContent("Resolved");
  });

  it("shows the description and screenshot in the panel and opens console and network", async () => {
    renderTab([baseReport]);

    const panel = await openReport(baseReport.description);
    expect(within(panel).getByText(baseReport.description)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open in new tab" })).toBeInTheDocument();
    // This row already carries the blobs, so the shared view skips the detail
    // fetch (#979) — see the flag-only case below for the fetching path.
    expect(mockGetAdminBugReport).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: "Console" }));
    expect(await screen.findByRole("dialog", { name: "Console Logs" })).toBeInTheDocument();
    expect(screen.getByText("Show stack trace")).toBeInTheDocument();
    closeViewer("Console Logs");

    fireEvent.click(within(panel).getByRole("button", { name: "Network" }));
    expect(await screen.findByRole("dialog", { name: "Network Logs" })).toBeInTheDocument();
    expect(screen.getByText("Request")).toBeInTheDocument();
  });

  it("fetches the detail payload when the list row only carries has* flags", async () => {
    // The list endpoint omits the diagnostic bodies (#979); the row advertises
    // them through the flags and the viewer pulls them on open.
    const listRow: AdminBugReportRow = {
      ...baseReport,
      consoleLogs: null,
      networkLogs: null,
      screenshot: null,
    };
    mockGetAdminBugReport.mockResolvedValue(baseReport);

    renderTab([listRow]);

    // Opening the panel pulls the bodies, so the screenshot can show inline.
    const panel = await openReport(listRow.description);
    await waitFor(() => {
      expect(mockGetAdminBugReport).toHaveBeenCalledWith(baseReport.id);
    });
    expect(await within(panel).findByAltText("Bug report screenshot")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Console" }));
    expect(await screen.findByRole("dialog", { name: "Console Logs" })).toBeInTheDocument();
    expect(screen.getByText("Show stack trace")).toBeInTheDocument();
  });

  it("copies a full bug report template and shows temporary copied feedback", async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);
    vi.useFakeTimers();

    try {
      renderTab([baseReport]);
      fireEvent.click(screen.getByRole("row", { name: `Open report: ${baseReport.description}` }));

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
      const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
      expect(copiedText).toContain("Bug Report");
      expect(copiedText).toContain(`- Report ID: ${baseReport.id}`);
      expect(copiedText).toContain(`- Type: Feature not working`);
      expect(copiedText).toContain(`- Internal User ID: ${baseReport.userId}`);
      expect(copiedText).toContain(`- Page URL: ${baseReport.pageUrl}`);
      expect(copiedText).toContain("Description");
      expect(copiedText).toContain(baseReport.description);
      expect(copiedText).toContain("Raw Appendix");
      expect(copiedText).toContain('"consoleLogs"');
      expect(copiedText).toContain('"networkLogs"');
      expect(copiedText).toContain('"screenshot"');
      expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });

      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies masked anonymous reporter details while still including internal user id", async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    renderTab([anonymousReport]);
    const panel = await openReport(anonymousReport.description);

    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain("- Reporter: Anonymous");
    expect(copiedText).toContain(`- Internal User ID: ${anonymousReport.userId}`);
    expect(copiedText).toContain("- Anonymous: yes");
    expect(copiedText).not.toContain("ada@example.com");
  });

  it("does not leak identity fields when copying anonymous reports even if row includes them", async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    renderTab([anonymousReportWithPopulatedIdentityFields]);
    const panel = await openReport(anonymousReportWithPopulatedIdentityFields.description);

    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain("- Reporter: Anonymous");
    expect(copiedText).toContain(
      `- Internal User ID: ${anonymousReportWithPopulatedIdentityFields.userId}`,
    );
    expect(copiedText).toContain("- Anonymous: yes");
    expect(copiedText).not.toContain("Grace Hopper");
    expect(copiedText).not.toContain("grace@example.com");
    expect(copiedText).not.toContain('"reporterName"');
    expect(copiedText).not.toContain('"reporterEmail"');
  });
});
