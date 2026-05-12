import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BugReportsTab from '~/components/admin/BugReportsTab';
import type { AdminBugReportRow } from '~/lib/types';

const { mockUpdateAdminBugReportStatus, mockClipboardWriteText } = vi.hoisted(() => ({
  mockUpdateAdminBugReportStatus: vi.fn(),
  mockClipboardWriteText: vi.fn(),
}));

vi.mock('~/lib/api', () => ({
  default: {
    updateAdminBugReportStatus: mockUpdateAdminBugReportStatus,
  },
}));

const baseReport: AdminBugReportRow = {
  id: 'bug-1',
  description: 'Student cannot submit answer on activity page',
  status: 'unhandled',
  consoleLogs: JSON.stringify([
    {
      level: 'error',
      message: 'Boom',
      timestamp: '2026-03-10T08:00:00.000Z',
      stack: 'line1\nline2',
    },
  ]),
  networkLogs: JSON.stringify([
    {
      method: 'POST',
      url: 'http://localhost:4000/api/submit',
      status: 500,
      durationMs: 215,
      timestamp: '2026-03-10T08:00:02.000Z',
      requestHeaders: { 'content-type': 'application/json' },
      responseHeaders: { 'x-request-id': 'abc' },
      requestBody: { answer: 2 },
      responseBody: { error: 'Internal error' },
    },
  ]),
  screenshot: 'data:image/png;base64,ZmFrZQ==',
  pageUrl: 'http://localhost:5173/student/list/42?step=1',
  userAgent: 'Mozilla/5.0',
  isAnonymous: false,
  userId: 'u1',
  reporterName: 'Ada Lovelace',
  reporterEmail: 'ada@example.com',
  reporterRole: 'STUDENT',
  user: {
    id: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'STUDENT',
  },
  createdAt: '2026-03-10T08:01:00.000Z',
  updatedAt: '2026-03-10T08:01:00.000Z',
  courseOfferingId: 1,
  moduleId: 2,
  lessonId: 3,
  activityId: 4,
  courseTitle: 'Math 101',
  moduleTitle: 'Week 1',
  lessonTitle: 'Linear Equations',
  activityTitle: 'Solve for x',
};

const anonymousReport: AdminBugReportRow = {
  ...baseReport,
  id: 'bug-2',
  description: 'Anonymous report example',
  isAnonymous: true,
  reporterName: 'Anonymous',
  reporterEmail: null,
  reporterRole: 'PROFESSOR',
  user: {
    id: 'u2',
    name: null,
    email: null,
    role: 'PROFESSOR',
  },
};

const anonymousReportWithPopulatedIdentityFields: AdminBugReportRow = {
  ...baseReport,
  id: 'bug-3',
  description: 'Anonymous report with populated identity fields',
  isAnonymous: true,
  reporterName: 'Grace Hopper',
  reporterEmail: 'grace@example.com',
  reporterRole: 'PROFESSOR',
  user: {
    id: 'u3',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    role: 'PROFESSOR',
  },
};

describe('BugReportsTab', () => {
  beforeEach(() => {
    mockUpdateAdminBugReportStatus.mockReset();
    mockClipboardWriteText.mockReset();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockClipboardWriteText,
      },
    });
  });

  it('renders bug report rows and anonymous reporter label', () => {
    render(<BugReportsTab initialReports={[baseReport, anonymousReport]} />);

    expect(screen.getByText('Bug Reports')).toBeInTheDocument();
    expect(screen.getByText(baseReport.description)).toBeInTheDocument();
    expect(screen.getByText(anonymousReport.description)).toBeInTheDocument();
    expect(screen.getByText('Anonymous')).toBeInTheDocument();
    expect(screen.getAllByText('Math 101 / Week 1 / Linear Equations / Solve for x')).toHaveLength(
      2,
    );
    expect(screen.getAllByText('/student/list/42?step=1')).toHaveLength(2);
  });

  it('updates status after a successful API response', async () => {
    mockUpdateAdminBugReportStatus.mockResolvedValue({
      ...baseReport,
      status: 'resolved',
    });

    render(<BugReportsTab initialReports={[baseReport]} />);

    const select = screen.getByLabelText(`Update status for report ${baseReport.id}`);
    fireEvent.change(select, { target: { value: 'resolved' } });

    await waitFor(() => {
      expect(mockUpdateAdminBugReportStatus).toHaveBeenCalledWith(baseReport.id, {
        status: 'resolved',
      });
    });

    expect((select as HTMLSelectElement).value).toBe('resolved');
  });

  it('opens description, console, network, and screenshot viewers', async () => {
    render(<BugReportsTab initialReports={[baseReport]} />);

    fireEvent.click(screen.getByText(baseReport.description));
    expect(await screen.findByText('Report Description')).toBeInTheDocument();
    expect(screen.getByText(/Reported by/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(await screen.findByText('Console Logs')).toBeInTheDocument();
    expect(screen.getByText('Show stack trace')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Network' }));
    expect(await screen.findByText('Network Logs')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    expect(await screen.findByRole('link', { name: 'Open in new tab' })).toBeInTheDocument();
  });

  it('copies a full bug report template and shows temporary copied feedback', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);
    vi.useFakeTimers();

    try {
      render(<BugReportsTab initialReports={[baseReport]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
      const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
      expect(copiedText).toContain('Bug Report');
      expect(copiedText).toContain(`- Report ID: ${baseReport.id}`);
      expect(copiedText).toContain(`- Internal User ID: ${baseReport.userId}`);
      expect(copiedText).toContain(`- Page URL: ${baseReport.pageUrl}`);
      expect(copiedText).toContain('Description');
      expect(copiedText).toContain(baseReport.description);
      expect(copiedText).toContain('Raw Appendix');
      expect(copiedText).toContain('"consoleLogs"');
      expect(copiedText).toContain('"networkLogs"');
      expect(copiedText).toContain('"screenshot"');
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });

      expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('copies masked anonymous reporter details while still including internal user id', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    render(<BugReportsTab initialReports={[anonymousReport]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain('- Reporter: Anonymous');
    expect(copiedText).toContain(`- Internal User ID: ${anonymousReport.userId}`);
    expect(copiedText).toContain('- Anonymous: yes');
    expect(copiedText).not.toContain('ada@example.com');
  });

  it('does not leak identity fields when copying anonymous reports even if row includes them', async () => {
    mockClipboardWriteText.mockResolvedValue(undefined);

    render(<BugReportsTab initialReports={[anonymousReportWithPopulatedIdentityFields]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockClipboardWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockClipboardWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain('- Reporter: Anonymous');
    expect(copiedText).toContain(
      `- Internal User ID: ${anonymousReportWithPopulatedIdentityFields.userId}`,
    );
    expect(copiedText).toContain('- Anonymous: yes');
    expect(copiedText).not.toContain('Grace Hopper');
    expect(copiedText).not.toContain('grace@example.com');
    expect(copiedText).not.toContain('"reporterName"');
    expect(copiedText).not.toContain('"reporterEmail"');
  });
});
